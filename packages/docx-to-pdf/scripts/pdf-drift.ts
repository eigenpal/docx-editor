/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Where does our layout first leave the reference, and by how much?
 *
 *   bun packages/docx-to-pdf/scripts/pdf-drift.ts <doc.docx> --ref <reference.pdf>
 *       [--page N] [--threshold-units 0.5] [--all] [--json] [--no-system-fonts]
 *
 * Our lines come from Core's layout records put through the writer's grid rules (see
 * `lib/layout-lines.ts`); the reference's come from its PDF text, one line per baseline. Lines pair by page and text. For every page the
 * report names the first paired line whose baseline or start differs by more than the
 * threshold, gives both positions in points and 0.24pt device units, and prints the trend of
 * baseline deltas down the page as runs, so a local slip and an accumulated drift read
 * differently. `--all` lists every paired line. A page-count mismatch is printed first, and
 * pages after the mismatch are not compared.
 */
/* eslint-disable no-console -- a command-line report; stdout is its output. */
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { collectLines, normalizeLineText, unitsOf, type LaidOutLine } from './lib/layout-lines.ts';

export interface ReferenceLine {
  readonly page: number;
  readonly text: string;
  readonly baseline: number;
  readonly x: number;
  readonly right: number;
}

/** One text line per baseline from a PDF's text content, in points from the page top. */
export async function readReferenceLines(
  bytes: Uint8Array
): Promise<{ pageCount: number; lines: ReferenceLine[] }> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const lines: ReferenceLine[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const byBaseline = new Map<
        number,
        { items: { x: number; width: number; str: string }[]; baseline: number }
      >();
      for (const item of content.items) {
        if (!('str' in item) || item.str.length === 0) continue;
        const [a, b, , , x, y] = item.transform as [number, number, number, number, number, number];
        // Vertical text, rotated text and the like are a different problem; only upright
        // runs are paired.
        if (Math.abs(b) > 1e-6 || a <= 0) continue;
        const baseline = Math.round((height - y) * 100) / 100;
        let group = byBaseline.get(baseline);
        if (!group) {
          group = { items: [], baseline };
          byBaseline.set(baseline, group);
        }
        group.items.push({ x, width: item.width, str: item.str });
      }
      for (const group of byBaseline.values()) {
        group.items.sort((left, right) => left.x - right.x);
        let text = '';
        let pen: number | null = null;
        for (const piece of group.items) {
          // A gap wider than a thin space between two pieces is a space the extractor did
          // not emit.
          if (
            pen !== null &&
            piece.x - pen > 1 &&
            !text.endsWith(' ') &&
            !piece.str.startsWith(' ')
          )
            text += ' ';
          text += piece.str;
          pen = piece.x + piece.width;
        }
        const visible = group.items.filter((piece) => piece.str.trim().length > 0);
        if (visible.length === 0) continue;
        lines.push({
          page: index,
          text,
          baseline: group.baseline,
          x: Math.min(...visible.map((piece) => piece.x)),
          right: Math.max(...visible.map((piece) => piece.x + piece.width)),
        });
      }
    }
    lines.sort((a, b) => a.page - b.page || a.baseline - b.baseline || a.x - b.x);
    return { pageCount: pdf.numPages, lines };
  } finally {
    await pdf.destroy();
  }
}

export interface PairedLine {
  readonly ours: LaidOutLine;
  readonly ref: ReferenceLine;
  /** Positive: ours is lower on the page than the reference. */
  readonly dyPt: number;
  readonly dxPt: number;
  readonly dRightPt: number;
}

/**
 * Pair our lines with reference lines by page and text, in reading order. Equal normalized
 * text wins; a 24-character prefix is accepted when the exporters broke words differently.
 * Each reference line pairs at most once.
 */
export function pairLines(
  ours: readonly LaidOutLine[],
  refs: readonly ReferenceLine[]
): { paired: PairedLine[]; unpairedOurs: LaidOutLine[]; unpairedRefs: ReferenceLine[] } {
  const taken = new Set<ReferenceLine>();
  const paired: PairedLine[] = [];
  const unpairedOurs: LaidOutLine[] = [];
  for (const line of ours) {
    const text = normalizeLineText(line.text);
    if (!text) continue;
    const candidates = refs.filter((ref) => ref.page === line.page && !taken.has(ref));
    // Among lines with the same text (table cells repeat), the nearest baseline is the twin.
    const nearest = (pool: readonly ReferenceLine[]): ReferenceLine | undefined =>
      pool.reduce<ReferenceLine | undefined>(
        (best, ref) =>
          best === undefined ||
          Math.abs(ref.baseline - line.painted) < Math.abs(best.baseline - line.painted)
            ? ref
            : best,
        undefined
      );
    const match =
      nearest(candidates.filter((ref) => normalizeLineText(ref.text) === text)) ??
      nearest(
        candidates.filter((ref) => {
          const other = normalizeLineText(ref.text);
          const length = Math.min(24, text.length, other.length);
          return length >= 8 && other.slice(0, length) === text.slice(0, length);
        })
      );
    if (!match) {
      unpairedOurs.push(line);
      continue;
    }
    taken.add(match);
    paired.push({
      ours: line,
      ref: match,
      dyPt: line.painted - match.baseline,
      dxPt: line.x - match.x,
      dRightPt: line.right - match.right,
    });
  }
  return { paired, unpairedOurs, unpairedRefs: refs.filter((ref) => !taken.has(ref)) };
}

/** Runs of equal rounded deltas: `L0..L3 0u | L4..L11 +1u`. */
export function trend(deltasUnits: readonly number[]): string {
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= deltasUnits.length; i++) {
    if (
      i === deltasUnits.length ||
      Math.round(deltasUnits[i]!) !== Math.round(deltasUnits[start]!)
    ) {
      const value = Math.round(deltasUnits[start]!);
      runs.push(`L${start}..L${i - 1} ${value > 0 ? '+' : ''}${value}u`);
      start = i;
    }
  }
  return runs.join(' | ');
}

const pt = (value: number): string => value.toFixed(2);
const units = (value: number): string => {
  const u = unitsOf(value);
  return `${u > 0 ? '+' : ''}${u.toFixed(2)}u`;
};

async function main(argv: readonly string[]): Promise<void> {
  let file: string | undefined;
  let ref: string | undefined;
  let page: number | undefined;
  let threshold = 0.5;
  let all = false;
  let json = false;
  let useSystemFonts = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--ref') ref = argv[++i];
    else if (arg === '--page') page = Number(argv[++i]);
    else if (arg === '--threshold-units') threshold = Number(argv[++i]);
    else if (arg === '--all') all = true;
    else if (arg === '--json') json = true;
    else if (arg === '--no-system-fonts') useSystemFonts = false;
    else file = arg;
  }
  if (!file || !ref) {
    console.error(
      'usage: bun packages/docx-to-pdf/scripts/pdf-drift.ts <doc.docx> --ref <reference.pdf> [--page N] [--threshold-units 0.5] [--all] [--json] [--no-system-fonts]'
    );
    process.exitCode = 2;
    return;
  }
  const [ours, reference] = await Promise.all([
    collectLines(new Uint8Array(await readFile(file)), { useSystemFonts }),
    readReferenceLines(new Uint8Array(await readFile(ref))),
  ]);
  const pages = Math.min(ours.pageCount, reference.pageCount);
  const report: Record<string, unknown>[] = [];
  if (ours.pageCount !== reference.pageCount)
    console.log(
      `PAGE COUNT ours ${ours.pageCount} reference ${reference.pageCount}: only the first ${pages} pages are compared`
    );
  console.log(`threshold ${threshold}u; 1u = 0.24pt; dy > 0 means ours sits lower on the page`);
  for (let index = 1; index <= pages; index++) {
    if (page !== undefined && index !== page) continue;
    const { paired, unpairedOurs, unpairedRefs } = pairLines(
      ours.lines.filter((line) => line.page === index && line.story !== 'textbox'),
      reference.lines.filter((line) => line.page === index)
    );
    const deltas = paired.map((pair) => unitsOf(pair.dyPt));
    const first = paired.find(
      (pair) => Math.abs(unitsOf(pair.dyPt)) > threshold || Math.abs(unitsOf(pair.dxPt)) > threshold
    );
    const over = paired.filter((pair) => Math.abs(unitsOf(pair.dyPt)) > threshold).length;
    report.push({
      page: index,
      paired: paired.length,
      unpairedOurs: unpairedOurs.map((l) => l.text.slice(0, 40)),
      unpairedRefs: unpairedRefs.map((l) => l.text.slice(0, 40)),
      linesOverThreshold: over,
      first: first && {
        text: first.ours.text.slice(0, 60),
        lineIndex: paired.indexOf(first),
        oursBaseline: first.ours.painted,
        oursLayoutBaseline: first.ours.baseline,
        refBaseline: first.ref.baseline,
        dyPt: first.dyPt,
        dxPt: first.dxPt,
        dRightPt: first.dRightPt,
      },
      trend: trend(deltas),
    });
    if (json) continue;
    const head =
      `p${index}  paired ${paired.length}  over ${over}` +
      (unpairedOurs.length ? `  ours-only ${unpairedOurs.length}` : '') +
      (unpairedRefs.length ? `  ref-only ${unpairedRefs.length}` : '');
    console.log(head);
    if (first) {
      const at = paired.indexOf(first);
      console.log(
        `   first L${at} ${JSON.stringify(first.ours.text.slice(0, 48))}\n` +
          `      base ours ${pt(first.ours.painted)} (${unitsOf(first.ours.painted).toFixed(2)}u, layout ${pt(first.ours.baseline)})  ref ${pt(first.ref.baseline)} (${unitsOf(first.ref.baseline).toFixed(2)}u)  dy ${units(first.dyPt)}\n` +
          `      x    ours ${pt(first.ours.x)}  ref ${pt(first.ref.x)}  dx ${units(first.dxPt)}`
      );
    }
    if (paired.length) console.log(`   trend ${trend(deltas)}`);
    for (const line of unpairedOurs.slice(0, 3))
      console.log(
        `   ours-only ${JSON.stringify(line.text.slice(0, 48))} base ${pt(line.baseline)}`
      );
    for (const line of unpairedRefs.slice(0, 3))
      console.log(
        `   ref-only  ${JSON.stringify(line.text.slice(0, 48))} base ${pt(line.baseline)}`
      );
    if (all)
      for (const [i, pair] of paired.entries())
        console.log(
          `   L${String(i).padStart(2)} dy ${units(pair.dyPt).padStart(8)} dx ${units(pair.dxPt).padStart(8)}  ${JSON.stringify(pair.ours.text.slice(0, 44))}`
        );
  }
  if (json)
    console.log(
      JSON.stringify(
        { pageCount: { ours: ours.pageCount, reference: reference.pageCount }, pages: report },
        null,
        1
      )
    );
}

if (import.meta.main) await main(process.argv.slice(2));

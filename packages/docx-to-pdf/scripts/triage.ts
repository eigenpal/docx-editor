/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Triage a folder of DOCX files: which convert strictly, and for the rest, what stands in
 * the way, grouped so the answer is one screen, not a diagnostic per page.
 *
 *   bun packages/docx-to-pdf/scripts/triage.ts [<dir-or-file>...] [--out report.json]
 *       [--baseline previous.json] [--run-dir dir] [--dpi 80] [--timeout ms] [--no-system-fonts]
 *
 * With no input it reads `packages/docx-to-pdf/.local-validation/inbox/`, a gitignored folder
 * to drop documents into. For every document: strict export first; a refused document is
 * exported again in best effort so its pages, font resolution and full diagnostics are
 * known. Every run writes `<run-dir>/<name>.pdf` for each document and, when Poppler's
 * `pdftoppm` is installed, a PNG of its first page and of the first page carrying each
 * diagnostic code, so a suspected paint problem is a picture away. The run directory
 * defaults to `packages/docx-to-pdf/.local-validation/triage/<timestamp>/`, also gitignored.
 *
 * Each refusal is summarised by code with its count, the pages it touches, up to three
 * distinct messages, the font families no admitted face covers, and a hint at the usual
 * cause. Phase timings (open, layout, paint, save) show where a slow document spends its
 * time. `--baseline` names a previous report and prints what got worse and what got better.
 */
/* eslint-disable no-console -- a command-line report; stdout is its output. */
import { readdir, readFile, lstat, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { exportPdf, PdfFidelityError } from '../src/index.ts';
import type { PdfDiagnostic, PdfExportResult } from '../src/types.ts';

export interface DiagnosticGroup {
  readonly code: string;
  readonly severity: PdfDiagnostic['severity'];
  readonly count: number;
  /** One-based page numbers, at most eight, in order. */
  readonly pages: readonly number[];
  readonly messages: readonly string[];
}

export interface FontGap {
  readonly family: string;
  readonly coverage: string;
  /** Faces that resolved neither directly nor through a substitution. */
  readonly missing: readonly string[];
}

export interface TriageRow {
  readonly name: string;
  readonly status: 'strict' | 'best-effort' | 'error';
  readonly pages?: number;
  readonly ms: number;
  readonly timings?: PdfExportResult['timings'];
  readonly error?: string;
  readonly groups: readonly DiagnosticGroup[];
  readonly fonts: readonly FontGap[];
  /** Files this run wrote for the document: its PDF and the rendered pages. */
  readonly artifacts?: readonly string[];
}

/** The usual cause behind a code, for the reader who has not seen it before. */
export const HINTS: Readonly<Record<string, string>> = {
  'unshaped-text':
    'The family in the message has no admitted face. Supply it through `fonts`, or teach the installed or packaged resolver its file (font-provisioning.ts).',
  'missing-glyph':
    'No admitted face has a glyph for a character in that family; a fallback face for its script is missing.',
  drawing: 'The drawing kind or image format in the message is not painted (charts, TIFF, EMF).',
  textbox: 'A textbox story Core did not lay out; the reason is in the message.',
  'equation-fallback': 'Core laid an equation out as fallback text; a Core layout gap.',
  'cell-text-direction': 'A cell text direction other than btLr.',
  'underline-metrics': 'The face has no post metrics; the underline used a default (information).',
  'image-effects': 'Brightness, contrast, grayscale or bilevel adjustments are not encoded.',
  'run-border-style': 'A character border style outside single, thick, dashed, dotted, double.',
  'paragraph-border-style': 'A paragraph border style the writer does not draw.',
};

/** The demo's upload limit; a larger document is skipped rather than read. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** A numeric flag within its bounds, or the default when it is missing or out of range. */
export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Diagnostics grouped by code and message: one line per distinct problem. */
export function groupDiagnostics(diagnostics: readonly PdfDiagnostic[]): DiagnosticGroup[] {
  const byCode = new Map<
    string,
    {
      severity: PdfDiagnostic['severity'];
      count: number;
      pages: Set<number>;
      messages: Set<string>;
    }
  >();
  for (const diagnostic of diagnostics) {
    let group = byCode.get(diagnostic.code);
    if (!group) {
      group = { severity: diagnostic.severity, count: 0, pages: new Set(), messages: new Set() };
      byCode.set(diagnostic.code, group);
    }
    group.count += 1;
    if (diagnostic.pageIndex !== undefined) group.pages.add(diagnostic.pageIndex + 1);
    group.messages.add(diagnostic.message);
  }
  return [...byCode]
    .map(([code, group]) => ({
      code,
      severity: group.severity,
      count: group.count,
      pages: [...group.pages].sort((a, b) => a - b).slice(0, 8),
      messages: [...group.messages].slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Families the document names that no admitted face covers in full. */
export function fontGaps(resolution: PdfExportResult['fontResolution'] | undefined): FontGap[] {
  if (!resolution) return [];
  return resolution.families
    .filter((family) => family.coverage !== 'complete')
    .map((family) => ({
      family: family.family,
      coverage: family.coverage,
      missing: (['400/normal', '700/normal', '400/italic', '700/italic'] as const).filter(
        (face) =>
          !family.faces.some(
            (resolved) => `${resolved.weight}/${resolved.style}` === face && resolved.via
          )
      ),
    }));
}

/** What changed between two reports: documents that now do worse, and documents that do better. */
export function compareReports(
  baseline: readonly TriageRow[],
  current: readonly TriageRow[]
): { worse: string[]; better: string[] } {
  const rank = { strict: 2, 'best-effort': 1, error: 0 } as const;
  const before = new Map(baseline.map((row) => [row.name, row]));
  const worse: string[] = [];
  const better: string[] = [];
  for (const row of current) {
    const old = before.get(row.name);
    if (!old) continue;
    // A baseline written by an older or hand-rolled script may lack groups or use other
    // status words; it still compares, as an unknown status and no codes.
    const codes = (r: TriageRow) => new Set((r.groups ?? []).map((g) => g.code));
    const status = (r: TriageRow) => rank[r.status] ?? 0;
    const added = [...codes(row)].filter((code) => !codes(old).has(code));
    const removed = [...codes(old)].filter((code) => !codes(row).has(code));
    if (status(row) < status(old) || added.length)
      worse.push(
        `${row.name}: ${old.status} → ${row.status}${added.length ? ` +${added.join(',')}` : ''}`
      );
    else if (status(row) > status(old) || removed.length)
      better.push(
        `${row.name}: ${old.status} → ${row.status}${removed.length ? ` -${removed.join(',')}` : ''}`
      );
  }
  return { worse, better };
}

/** Rasterize one-based `pages` of `pdf` beside it with Poppler; returns the PNG paths. */
function renderPages(pdf: string, pages: readonly number[], dpi: number): string[] {
  const out: string[] = [];
  for (const page of pages) {
    const stem = pdf.replace(/\.pdf$/, `-p${page}`);
    const result = spawnSync(
      'pdftoppm',
      ['-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', '-png', pdf, stem],
      { stdio: 'ignore' }
    );
    if (result.error || result.status !== 0) return out;
    out.push(`${stem}.png`);
  }
  return out;
}

/** Page 1 and the first page of every diagnostic that is not mere information. */
function pagesWorthSeeing(groups: readonly DiagnosticGroup[]): number[] {
  const pages = new Set<number>([1]);
  for (const group of groups)
    if (group.severity !== 'information' && group.pages[0] !== undefined) pages.add(group.pages[0]);
  return [...pages].sort((a, b) => a - b).slice(0, 12);
}

async function keep(
  result: PdfExportResult,
  name: string,
  groups: readonly DiagnosticGroup[],
  options: { runDir: string; dpi: number }
): Promise<string[]> {
  const pdf = join(options.runDir, `${name}.pdf`);
  await writeFile(pdf, result.bytes);
  return [pdf, ...renderPages(pdf, pagesWorthSeeing(groups), options.dpi)];
}

async function triageOne(
  path: string,
  name: string,
  options: { timeoutMs: number; useSystemFonts: boolean; runDir: string; dpi: number }
): Promise<TriageRow> {
  const bytes = new Uint8Array(await readFile(path));
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const shared = { timeoutMs: options.timeoutMs, useSystemFonts: options.useSystemFonts };
  try {
    const strict = await exportPdf(bytes, { ...shared, fidelityPolicy: 'strict' });
    const groups = groupDiagnostics(strict.diagnostics);
    return {
      name,
      status: 'strict',
      pages: strict.pageCount,
      ms: ms(),
      timings: strict.timings,
      groups,
      fonts: fontGaps(strict.fontResolution),
      artifacts: await keep(strict, name, groups, options),
    };
  } catch (error) {
    if (!(error instanceof PdfFidelityError)) {
      return {
        name,
        status: 'error',
        ms: ms(),
        error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : 'Error',
        groups: [],
        fonts: [],
      };
    }
    try {
      const lenient = await exportPdf(bytes, { ...shared, fidelityPolicy: 'best-effort' });
      const groups = groupDiagnostics(lenient.diagnostics);
      return {
        name,
        status: 'best-effort',
        pages: lenient.pageCount,
        ms: ms(),
        timings: lenient.timings,
        groups,
        fonts: fontGaps(lenient.fontResolution),
        artifacts: await keep(lenient, name, groups, options),
      };
    } catch (second) {
      return {
        name,
        status: 'error',
        ms: ms(),
        error:
          second instanceof Error ? `${second.name}: ${second.message.slice(0, 160)}` : 'Error',
        groups: groupDiagnostics(error.diagnostics),
        fonts: [],
      };
    }
  }
}

function printRow(row: TriageRow): void {
  const pages = row.pages === undefined ? '-' : String(row.pages);
  const t = row.timings;
  const phases = t
    ? ` open ${t.openMs} layout ${t.layoutMs} paint ${t.paintMs} save ${t.saveMs}`
    : '';
  console.log(
    `${row.status === 'strict' ? 'OK  ' : row.status === 'error' ? 'ERR ' : 'BEST'} ${row.name.padEnd(48).slice(0, 48)} ${pages.padStart(4)}pp ${String(row.ms).padStart(6)}ms${phases}`
  );
  const pngs = (row.artifacts ?? []).filter((file) => file.endsWith('.png'));
  if (pngs.length && row.status !== 'strict')
    console.log(`      rendered ${pngs.map((file) => basename(file)).join(' ')}`);
  if (row.error) console.log(`      ${row.error}`);
  for (const group of row.groups) {
    if (group.severity === 'information' && row.status === 'strict') continue;
    const pages = group.pages.length ? ` pages ${group.pages.join(',')}` : '';
    console.log(`      ${group.count}× ${group.severity}:${group.code}${pages}`);
    for (const message of group.messages) console.log(`         ${message}`);
    const hint = HINTS[group.code];
    if (hint) console.log(`         → ${hint}`);
  }
  for (const gap of row.fonts)
    console.log(
      `      font ${gap.family}: ${gap.coverage}, missing ${gap.missing.join(' ') || '-'}`
    );
}

async function main(argv: readonly string[]): Promise<void> {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const inputs: string[] = [];
  let out: string | undefined;
  let baseline: string | undefined;
  let runDir: string | undefined;
  let dpi = 80;
  let timeoutMs = 120_000;
  let useSystemFonts = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--out') out = argv[++i];
    else if (arg === '--baseline') baseline = argv[++i];
    else if (arg === '--run-dir') runDir = argv[++i];
    else if (arg === '--dpi') dpi = clamp(Number(argv[++i]), 24, 300, 80);
    else if (arg === '--timeout') timeoutMs = clamp(Number(argv[++i]), 1_000, 600_000, 120_000);
    else if (arg === '--no-system-fonts') useSystemFonts = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: bun packages/docx-to-pdf/scripts/triage.ts [<dir-or-file>...] [--out report.json] [--baseline previous.json] [--run-dir dir] [--dpi 80] [--timeout ms] [--no-system-fonts]'
      );
      return;
    } else inputs.push(arg);
  }
  if (inputs.length === 0) inputs.push(join(packageRoot, '.local-validation/inbox'));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  runDir ??= join(packageRoot, '.local-validation/triage', stamp);
  await mkdir(runDir, { recursive: true });
  out ??= join(runDir, 'report.json');
  const poppler = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  if (poppler.error) console.log('pdftoppm not found: PDFs are written, pages are not rendered');
  const files: { path: string; name: string }[] = [];
  for (const input of inputs) {
    const path = resolve(input);
    const info = await lstat(path).catch(() => null);
    if (!info) {
      console.error(`${path} does not exist; drop documents into ${inputs[0]} or name a folder`);
      process.exitCode = 2;
      return;
    }
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        if (!entry.toLowerCase().endsWith('.docx') || entry.startsWith('~$')) continue;
        const file = join(path, entry);
        const detail = await lstat(file);
        // Symbolic links are not followed: the folder is the boundary of what this reads.
        if (detail.isSymbolicLink() || !detail.isFile()) continue;
        if (detail.size > MAX_DOCUMENT_BYTES) {
          console.log(
            `skip ${entry}: ${Math.round(detail.size / 1048576)} MiB is over the 20 MiB limit`
          );
          continue;
        }
        files.push({ path: file, name: entry });
      }
    } else if (!info.isSymbolicLink()) files.push({ path, name: basename(path) });
  }
  // Two folders can hold the same file name; the second of a name gets a hash suffix so
  // neither's PDF, pages or report row overwrites the other's.
  const seen = new Map<string, number>();
  for (const [index, file] of files.entries()) {
    const count = seen.get(file.name) ?? 0;
    seen.set(file.name, count + 1);
    if (count > 0)
      files[index] = {
        ...file,
        name: `${file.name}-${createHash('sha256').update(file.path).digest('hex').slice(0, 8)}`,
      };
  }
  const rows: TriageRow[] = [];
  for (const file of files) {
    const row = await triageOne(file.path, file.name, { timeoutMs, useSystemFonts, runDir, dpi });
    rows.push(row);
    printRow(row);
  }
  const counts = { strict: 0, 'best-effort': 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  const causes = new Map<string, number>();
  for (const row of rows)
    if (row.status !== 'strict')
      for (const group of row.groups)
        if (group.severity !== 'information')
          causes.set(group.code, (causes.get(group.code) ?? 0) + 1);
  console.log(
    `\n${rows.length} documents: ${counts.strict} strict, ${counts['best-effort']} best effort, ${counts.error} errors`
  );
  for (const [code, count] of [...causes].sort((a, b) => b[1] - a[1]))
    console.log(`   ${String(count).padStart(3)} documents  ${code}`);
  await writeFile(out, JSON.stringify(rows, null, 1) + '\n');
  const previous = baseline
    ? await readFile(baseline, 'utf8').then(
        (text) => JSON.parse(text) as TriageRow[],
        () => null
      )
    : null;
  if (baseline && !previous)
    console.log(`\nBaseline ${baseline} could not be read; no comparison.`);
  if (previous) {
    const { worse, better } = compareReports(previous, rows);
    console.log(`\nAgainst ${baseline}: ${worse.length} worse, ${better.length} better`);
    for (const line of worse) console.log(`   worse  ${line}`);
    for (const line of better) console.log(`   better ${line}`);
    if (worse.length) process.exitCode = 1;
  }
  console.log(`\nPDFs, rendered pages and ${basename(out)} are in ${runDir}`);
}

if (import.meta.main) await main(process.argv.slice(2));

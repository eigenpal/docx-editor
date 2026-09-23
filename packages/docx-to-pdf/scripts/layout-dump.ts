/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Print what layout published for the lines of a document, matched by text.
 *
 *   bun packages/docx-to-pdf/scripts/layout-dump.ts <doc.docx> [--grep <text>] [--page N]
 *       [--json] [--no-system-fonts]
 *
 * Every line: page, top, baseline, height and leading in points, with the baseline also in
 * 0.24pt device units, then each span's start, width, family, size, raise and the face that
 * shaped it. `--grep` keeps the lines whose text contains the given text (case-insensitive)
 * and their paragraphs' other lines; `--page` keeps one page. `base` is layout's baseline
 * and `painted` the one the PDF carries after the writer's grid rules.
 */
/* eslint-disable no-console -- a command-line report; stdout is its output. */
import { readFile } from 'node:fs/promises';
import { collectLines, unitsOf, type LaidOutLine } from './lib/layout-lines.ts';

export function selectLines(
  lines: readonly LaidOutLine[],
  grep: string | undefined,
  page: number | undefined
): readonly LaidOutLine[] {
  let kept = page === undefined ? lines : lines.filter((line) => line.page === page);
  if (grep) {
    const needle = grep.toLowerCase();
    const paragraphs = new Set(
      kept.filter((line) => line.text.toLowerCase().includes(needle)).map((l) => l.paragraphId)
    );
    kept = kept.filter((line) => paragraphs.has(line.paragraphId));
  }
  return kept;
}

const pt = (value: number): string => value.toFixed(3);
const units = (value: number): string => unitsOf(value).toFixed(2) + 'u';

export function formatLine(line: LaidOutLine): string {
  const head =
    `p${line.page} ${line.story} ¶${line.paragraphId.slice(0, 12)} L${line.lineIndex}  ` +
    `top ${pt(line.top)}  base ${pt(line.baseline)} → painted ${pt(line.painted)} (${units(line.painted)})  ` +
    `h ${pt(line.height)}  lead ${pt(line.leading)}  x ${pt(line.x)}..${pt(line.right)}`;
  const spans = line.spans.map(
    (span) =>
      `      ${JSON.stringify(span.text).slice(0, 40).padEnd(42)} x ${pt(span.x)} w ${pt(span.width)}  ` +
      `${span.family ?? 'default'} ${span.sizePt}pt` +
      (span.raisePt ? ` raise ${pt(span.raisePt)}` : '') +
      (span.face && span.face !== span.family ? ` → ${span.face}` : '') +
      (span.face === null ? ' (unshaped)' : '')
  );
  return [head, ...spans].join('\n');
}

async function main(argv: readonly string[]): Promise<void> {
  let file: string | undefined;
  let grep: string | undefined;
  let page: number | undefined;
  let json = false;
  let useSystemFonts = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--grep') grep = argv[++i];
    else if (arg === '--page') page = Number(argv[++i]);
    else if (arg === '--json') json = true;
    else if (arg === '--no-system-fonts') useSystemFonts = false;
    else file = arg;
  }
  if (!file) {
    console.error(
      'usage: bun packages/docx-to-pdf/scripts/layout-dump.ts <doc.docx> [--grep <text>] [--page N] [--json] [--no-system-fonts]'
    );
    process.exitCode = 2;
    return;
  }
  const document = await collectLines(new Uint8Array(await readFile(file)), { useSystemFonts });
  const lines = selectLines(document.lines, grep, page);
  if (json) {
    console.log(JSON.stringify({ pageCount: document.pageCount, lines }, null, 1));
    return;
  }
  console.log(
    `${document.pageCount} pages, ${lines.length} of ${document.lines.length} lines shown; 1u = 0.24pt`
  );
  for (const line of lines) console.log(formatLine(line));
}

if (import.meta.main) await main(process.argv.slice(2));

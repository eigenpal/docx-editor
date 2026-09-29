/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { exportPdf } from '../../src/index.ts';
import { openExportSession } from '../../src/open-session.ts';
import { docx } from '../../test/fixture.ts';
import { SETTINGS } from './trace.ts';
import { summarizePages } from './layout-summary.ts';
import { recordLayoutText } from './layout-text.ts';

// A right-to-left run takes its complex-script face. Noto Sans Arabic has no Hebrew, so the
// Hebrew letters depend on a Hebrew face in the evaluation fallback list. The second
// paragraph reaches the symbol, math, CJK and emoji fallbacks as well. U+1FA75 is only in the
// monochrome emoji face, so it reaches the last fallback.
const HEBREW = 'אבגד הוזח טיכל';
const MIXED = '⚀ 𝔸 漢字 😀 \u{1FA75}';
const run = (text: string, rtl: boolean) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Noto Sans Arabic"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const input = docx(
  `<w:p><w:pPr><w:bidi/></w:pPr>${run(HEBREW, true)}</w:p><w:p>${run(MIXED, false)}</w:p>`
);
const hebrewLetters = (text: string) => text.match(/[\u05d0-\u05ea]/g)?.length ?? 0;
const missingGlyphs = (diagnostics: readonly { code: string }[]) =>
  diagnostics.filter((entry) => entry.code === 'missing-glyph');

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'eval-export-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** Runs the evaluation export entry as the evaluator does, in its own process. */
function runExportEntry() {
  const source = join(folder, 'input.docx');
  const output = join(folder, 'output.pdf');
  writeFileSync(source, input);
  const child = Bun.spawnSync(
    [
      process.execPath,
      '--tsconfig-override',
      'packages/docx-to-pdf/tsconfig.json',
      'packages/docx-to-pdf/scripts/evaluation/export.ts',
      source,
      output,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' }
  );
  if (child.exitCode !== 0) throw new Error(child.stderr.toString() || child.stdout.toString());
  const report = JSON.parse(child.stdout.toString()) as {
    status: string;
    diagnostics: { code: string }[];
  };
  return { report, bytes: new Uint8Array(readFileSync(output)) };
}

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await pdf.destroy();
  }
}

// The export entry's options, other than the font profile that trace shares.
const exportOptions = {
  fidelityPolicy: 'best-effort',
  comments: false,
  timeoutMs: 60_000,
} as const;

test('the evaluation export draws Hebrew in a complex-script run', async () => {
  const { report, bytes } = runExportEntry();
  expect(report.status).toBe('exported');
  expect(missingGlyphs(report.diagnostics)).toEqual([]);
  expect(hebrewLetters(await pdfText(bytes))).toBe(hebrewLetters(HEBREW));
  // Trace opens its session with the same font profile, so the two commands lay out the
  // same text in the same faces.
  const traced = await exportPdf(input, { ...exportOptions, ...SETTINGS });
  expect(traced.bytes).toEqual(bytes);
});

test('trace settings shape the Hebrew run in the Times New Roman stand-in', async () => {
  const opened = await openExportSession(input, SETTINGS);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const families = new Set<string>();
    forEachSemanticSpan(layout, (visit) => {
      if (!hebrewLetters(visit.span.text)) return;
      const shaped = opened.session.shapeLaidOutText(visit.span);
      if (!shaped) throw new Error('The Hebrew span was not shaped');
      expect(shaped.run.glyphs.some((glyph) => glyph.id === 0)).toBe(false);
      for (const font of shaped.fonts ?? [shaped.font]) families.add(font.family);
    });
    expect([...families]).toEqual(['Liberation Serif']);
  } finally {
    opened.session.dispose();
  }
});

test('a caller list without a Hebrew face replaces the defaults and reports the loss', async () => {
  // The profile before the correction. It proves that the fixture reaches the Hebrew fallback.
  const glyphFallbacks = SETTINGS.glyphFallbacks.filter(
    (face) => face.family !== 'Times New Roman'
  );
  const result = await exportPdf(input, { ...exportOptions, ...SETTINGS, glyphFallbacks });
  expect(missingGlyphs(result.diagnostics).length).toBeGreaterThan(0);
  expect(hebrewLetters(await pdfText(result.bytes))).toBe(0);
});

test('the fast summary uses the export font profile for mixed scripts', async () => {
  const summary = await summarizePages(input);
  const opened = await openExportSession(input, SETTINGS);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    expect(summary.pageCount).toBe(layout.pages.length);
    expect(summary.text).toEqual(recordLayoutText(layout));
    expect(summary.fontResolution).toEqual(opened.session.fontResolution);
  } finally {
    opened.session.dispose();
  }
});

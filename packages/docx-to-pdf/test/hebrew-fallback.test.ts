/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { exportPdf } from '../src/index.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

// Hebrew in a run whose face has no Hebrew. A host with the real `Segoe UI Symbol` resolves
// the first fallback to it, and it has no Hebrew either. A symbol face registered under that
// name reproduces such a host without depending on the machine's fonts.
const symbolFace = createFontSource(
  new Uint8Array(readFileSync(new URL('../assets/NotoSansSymbols2-Regular.ttf', import.meta.url))),
  { family: 'Segoe UI Symbol', weight: 400, style: 'normal' }
);
if ('failure' in symbolFace) throw new Error(JSON.stringify(symbolFace.failure));
const fonts = { sources: [symbolFace.source] };
const HEBREW = 'שלום עולם';
const input = docx(
  `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans Arabic" w:hAnsi="Noto Sans Arabic" w:cs="Noto Sans Arabic"/><w:rtl/></w:rPr><w:t>${HEBREW}</w:t></w:r></w:p>`
);

test('Hebrew in a face without Hebrew falls back to the Times New Roman-compatible face', async () => {
  const opened = await openExportSession(input, { fonts, useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const shaped: string[] = [];
    forEachSemanticSpan(layout, (visit) => {
      if (!/[֐-׿]/.test(visit.span.text)) return;
      const run = opened.session.shapeLaidOutText(visit.span);
      if (!run) throw new Error('The Hebrew span was not shaped');
      expect(run.run.glyphs.some((glyph) => glyph.id === 0)).toBe(false);
      shaped.push(run.font.family);
    });
    expect(shaped.length).toBeGreaterThan(0);
    expect(new Set(shaped)).toEqual(new Set(['Liberation Serif']));
  } finally {
    opened.session.dispose();
  }
});

test('the exported Hebrew is drawn, not dropped', async () => {
  const result = await exportPdf(input, { fonts, useSystemFonts: false });
  expect(result.diagnostics.filter((entry) => entry.code === 'missing-glyph')).toEqual([]);
});

test('without system fonts, the default fallbacks draw Hebrew in the Times New Roman stand-in', async () => {
  // No `Segoe UI Symbol` here: its stand-in is a symbol face and must not take the Hebrew.
  const opened = await openExportSession(input, { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const shaped = new Set<string>();
    forEachSemanticSpan(layout, (visit) => {
      if (!/[֐-׿]/.test(visit.span.text)) return;
      const run = opened.session.shapeLaidOutText(visit.span);
      for (const font of run?.fonts ?? (run ? [run.font] : [])) shaped.add(font.family);
    });
    expect([...shaped]).toEqual(['Liberation Serif']);
  } finally {
    opened.session.dispose();
  }
});

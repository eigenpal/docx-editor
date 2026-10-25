/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

// A checkbox symbol right after an Arabic word, in one run, in a face that has the letters but
// not the symbol. The symbol falls back on its own; the word keeps its face and its joins.

const WORD = 'سیمرغ';
const run = (text: string) =>
  `<w:r><w:rPr><w:rFonts w:cs="Noto Sans Arabic"/><w:rtl/><w:lang w:bidi="fa-IR"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const input = docx(`<w:p><w:pPr><w:bidi/></w:pPr>${run(`${WORD}☐ `)}</w:p>`);
const glyphFallbacks = ['Noto Sans Symbols 2', 'Noto Sans Arabic'].map((family) => ({
  family,
  weight: 400,
  style: 'normal' as const,
}));

test('a symbol after an Arabic word falls back alone and the word keeps its face', async () => {
  const opened = await openExportSession(input, { useSystemFonts: false, glyphFallbacks });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    let checked = 0;
    forEachSemanticSpan(layout, (visit) => {
      if (!visit.span.text.includes(WORD)) return;
      const shaped = opened.session.shapeLaidOutText(visit.span);
      if (!shaped) throw new Error('The span was not shaped');
      expect(shaped.run.glyphs.some((glyph) => glyph.id === 0)).toBe(false);
      const faces = new Set(shaped.run.fontSpans.map((span) => span.font.family));
      expect(faces.has('Noto Sans Arabic')).toBe(true);
      expect(faces.has('Noto Sans Symbols 2')).toBe(true);
      checked += 1;
    });
    expect(checked).toBe(1);
  } finally {
    opened.session.dispose?.();
  }
});

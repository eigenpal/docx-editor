/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { forEachSemanticSpan, linesOf } from '@docx-editor.dev/core/layout';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

// Hebrew in a run whose face (Noto Sans Arabic) has no Hebrew letters. The letters, and the
// spaces between them, come from the Times New Roman stand-in, and so does the line height.
// Punctuation the Arabic face has keeps that face, and so does an empty paragraph's mark.
const FACE =
  '<w:rFonts w:ascii="Noto Sans Arabic" w:hAnsi="Noto Sans Arabic" w:cs="Noto Sans Arabic"/><w:rtl/>';
const paragraph = (text: string) =>
  `<w:p><w:pPr><w:bidi/><w:spacing w:after="0"/><w:rPr>${FACE}</w:rPr></w:pPr>` +
  (text ? `<w:r><w:rPr>${FACE}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p>';
const CASES = ['הקדמה', 'הקדמה הקדמה', 'הקדמה!', ''];

test('a Hebrew line in an Arabic face takes the height of the face that draws it', async () => {
  const opened = await openExportSession(docx(CASES.map(paragraph).join('')), {
    useSystemFonts: false,
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const heights = linesOf(layout).map((line) => line.box.height);
    const [hebrew, words, punctuated, empty] = heights;
    expect(words).toBeCloseTo(hebrew!, 3);
    expect(punctuated).toBeCloseTo(empty!, 3);
    expect(hebrew!).toBeLessThan(empty! * 0.75);
    const faces = new Set<string>();
    forEachSemanticSpan(layout, (visit) => {
      if (!/[א-ת]/.test(visit.span.text) || visit.span.text.includes('!')) return;
      const run = opened.session.shapeLaidOutText(visit.span);
      for (const font of run?.fonts ?? (run ? [run.font] : [])) faces.add(font.family);
    });
    expect([...faces]).toEqual(['Liberation Serif']);
  } finally {
    opened.session.dispose();
  }
});

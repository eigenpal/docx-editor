/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { exportPdf } from '../src/index.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

// Arabic in a Latin run face: Arial resolves to Liberation Sans, which has no Arabic, so the
// whole run takes a glyph fallback. The packaged math face maps the basic Arabic letters but
// has no joining lookups, and it precedes the Arabic face in the fallback order.
const WORD = 'الحقيقي';
const input = docx(
  `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl/></w:rPr><w:t>${WORD}</w:t></w:r></w:p>`
);

test('a fallback Arabic run is shaped with joining forms in a face that declares Arabic', async () => {
  // No system fonts: an installed Arial with Arabic glyphs would hide the fallback.
  const opened = await openExportSession(input, { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const spans: Parameters<Parameters<typeof forEachSemanticSpan>[1]>[0]['span'][] = [];
    forEachSemanticSpan(layout, (visit) => spans.push(visit.span));
    const span = spans.find((candidate) => candidate.text === WORD);
    if (!span) throw new Error('The Arabic span was not laid out');
    const shaped = opened.session.shapeLaidOutText(span);
    if (!shaped) throw new Error('The Arabic span was not shaped');
    expect(shaped.font.family).toBe('Noto Sans Arabic');
    const glyphsAt = (offset: number) =>
      shaped.run.glyphs.filter((glyph) => glyph.cluster === offset).map((glyph) => glyph.id);
    // U+064A YEH is medial at offset 4 and final at offset 6; U+0642 QAF is medial at both
    // 3 and 5. An unjoined run draws the same isolated glyph for every YEH.
    expect(glyphsAt(4)).not.toEqual(glyphsAt(6));
    expect(glyphsAt(3)).toEqual(glyphsAt(5));
  } finally {
    opened.session.dispose();
  }
});

test('joined Arabic extracts as logical words without control characters', async () => {
  // "Test": TEH and BEH draw their dots as separate glyphs in the packaged Arabic face.
  const word = 'اختبار';
  const result = await exportPdf(
    docx(
      `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl/></w:rPr><w:t>${word} ${WORD}</w:t></w:r></w:p>`
    ),
    { useSystemFonts: false }
  );
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toBe(`${word} ${WORD}`);
  } finally {
    await pdf.destroy();
  }
});

test('a word split into two colored runs joins across the split, in layout and paint', async () => {
  // "المستفيد" (the beneficiary), with its last two letters in red. FEH and YEH meet at the
  // run boundary and must keep their medial forms, as in the one-run control paragraph.
  const run = (text: string, color = '') =>
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${color}<w:rtl/></w:rPr><w:t>${text}</w:t></w:r>`;
  const opened = await openExportSession(
    docx(
      `<w:p><w:pPr><w:bidi/></w:pPr>${run('المستف')}${run('يد', '<w:color w:val="C00000"/>')}</w:p>` +
        `<w:p><w:pPr><w:bidi/></w:pPr>${run('المستفيد')}</w:p>`
    ),
    { useSystemFonts: false }
  );
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const visits: Parameters<Parameters<typeof forEachSemanticSpan>[1]>[0][] = [];
    forEachSemanticSpan(layout, (visit) => visits.push(visit));
    const glyphs = (text: string) => {
      const visit = visits.find((candidate) => candidate.span.text === text);
      if (!visit) throw new Error(`No span for ${text}`);
      const shaped = opened.session.shapeLaidOutText(visit.span);
      if (!shaped) throw new Error(`No shaping for ${text}`);
      // Logical order, whatever the run direction put first.
      return {
        ids: [...shaped.run.glyphs].sort((a, b) => a.cluster - b.cluster).map((g) => g.id),
        width: visit.span.box.width,
      };
    };
    const first = glyphs('المستف');
    const second = glyphs('يد');
    const whole = glyphs('المستفيد');
    expect([...first.ids, ...second.ids]).toEqual(whole.ids);
    // Layout measured the joined forms, so the split word is as wide as the whole one.
    expect(first.width + second.width).toBeCloseTo(whole.width, 3);
  } finally {
    opened.session.dispose();
  }
});

test('only the edge word of a run reads the neighbouring run', async () => {
  // "كتاب بيت كلب" with the first two letters in red. Tracked changes split words like this.
  // The later words follow a space, so they must shape and measure as in one run.
  const run = (text: string, color = '') =>
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${color}<w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const opened = await openExportSession(
    docx(
      `<w:p><w:pPr><w:bidi/></w:pPr>${run('كت', '<w:color w:val="C00000"/>')}${run('اب بيت كلب')}</w:p>` +
        `<w:p><w:pPr><w:bidi/></w:pPr>${run('كتاب بيت كلب')}</w:p>`
    ),
    { useSystemFonts: false }
  );
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const byParagraph = new Map<
      object,
      Parameters<Parameters<typeof forEachSemanticSpan>[1]>[0][]
    >();
    forEachSemanticSpan(layout, (visit) => {
      const list = byParagraph.get(visit.paragraph) ?? [];
      list.push(visit);
      byParagraph.set(visit.paragraph, list);
    });
    const [split, whole] = [...byParagraph.values()].map((visits) => {
      const logical = [...visits].sort((a, b) => a.span.range.start - b.span.range.start);
      const ids: number[] = [];
      let width = 0;
      const widthOf = new Map<string, number>();
      for (const visit of logical) {
        const shaped = opened.session.shapeLaidOutText(visit.span);
        if (!shaped) throw new Error(`No shaping for ${visit.span.text}`);
        for (const glyph of [...shaped.run.glyphs].sort((a, b) => a.cluster - b.cluster))
          ids.push(glyph.id);
        width += visit.span.box.width;
        widthOf.set(visit.span.text, visit.span.box.width);
      }
      return { ids, width, widthOf, text: logical.map((visit) => visit.span.text).join('') };
    });
    expect(split!.text).toBe(whole!.text);
    // Same contextual forms everywhere, the joined edge word included.
    expect(split!.ids).toEqual(whole!.ids);
    // The words after the edge word measure exactly as in one run.
    for (const word of ['بيت ', 'كلب'])
      expect(split!.widthOf.get(word)).toBeCloseTo(whole!.widthOf.get(word)!, 6);
    // Context changes forms, not positioning: a kern or cursive offset between the two
    // separately shaped halves of the edge word is not applied, so allow that much.
    expect(Math.abs(split!.width - whole!.width)).toBeLessThan(0.25);
  } finally {
    opened.session.dispose();
  }
});

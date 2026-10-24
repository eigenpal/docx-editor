// A tab whose next default stop lies past the right edge opens the next line in body text,
// even with nothing after it, and reaches the first stop there. A custom stop ahead is still
// clamped to the edge.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const tabs = (count: number) => `<w:r>${'<w:tab/>'.repeat(count)}</w:r>`;

/** One paragraph 400pt wide; default stops every 36pt, so eleven fit on a line. */
function layout(content: string, pPr = '') {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

const tabCounts = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) => line.spans.filter((span) => span.text === '\t').length);

test('tabs past the last default stop wrap, with or without text after them', () => {
  expect(tabCounts(layout(tabs(11)))).toEqual([11]);
  expect(tabCounts(layout(tabs(12)))).toEqual([11, 1]);
  expect(tabCounts(layout(tabs(25)))).toEqual([11, 11, 3]);
  expect(tabCounts(layout(run('Text') + tabs(14)))).toEqual([11, 3]);
});

test('the wrapped tab reaches the first stop on the next line', () => {
  const lines = linesOf(layout(run('Text') + tabs(14) + run('End')));
  expect(lines).toHaveLength(2);
  const end = lines[1]!.spans.find((span) => span.text === 'End')!;
  expect(end.box.x).toBeCloseTo(108, 5);
});

test('a custom stop past the edge is clamped on the same line', () => {
  const result = layout(
    run('Text') + tabs(1),
    '<w:tabs><w:tab w:val="left" w:pos="9000"/></w:tabs>'
  );
  expect(tabCounts(result)).toEqual([1]);
  const tab = linesOf(result)[0]!.spans.find((span) => span.text === '\t')!;
  expect(tab.box.x + tab.box.width).toBeCloseTo(400, 5);
});

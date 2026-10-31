// A header or footer keeps its last paragraph's automatic space after: the story reserves
// it, so the body starts below it (header) or ends above it (footer). A table cell drops the
// automatic space after its own last paragraph.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutHeaderFooterStory } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
const EXPLICIT = '<w:spacing w:before="0" w:after="280"/>';
const NONE = '<w:spacing w:before="0" w:after="0"/>';
/** Automatic space before, but no space after. */
const AUTO_BEFORE = '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="0"/>';

const paragraph = (text: string, spacing: string) =>
  `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function flowHeight(kind: 'hdr' | 'ftr', content: string): number {
  const name = kind === 'hdr' ? '/word/header1.xml' : '/word/footer1.xml';
  const result = readOoxmlPart(`<w:${kind} xmlns:w="${W}">${content}</w:${kind}>`, {
    name,
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return layoutHeaderFooterStory(result.part, 468, measurer, name).flowHeight;
}

const lines = (spacing: string) =>
  paragraph('First', spacing) + paragraph('Second', spacing) + paragraph('Third', spacing);

for (const kind of ['hdr', 'ftr'] as const) {
  test(`a ${kind} story reserves its last paragraph's automatic space after`, () => {
    const auto = flowHeight(kind, lines(AUTO));
    // The same 14pt as an authored space after.
    expect(auto).toBeCloseTo(flowHeight(kind, lines(EXPLICIT)), 3);
    // Only the last paragraph differs: it adds its automatic 14pt below the last line.
    const tail =
      paragraph('First', AUTO) + paragraph('Second', AUTO) + paragraph('Third', AUTO_BEFORE);
    expect(auto).toBeCloseTo(flowHeight(kind, tail) + 14, 3);
  });

  test(`a ${kind} story keeps the automatic space after a content control at its end`, () => {
    const wrapped = `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${lines(AUTO)}</w:sdtContent></w:sdt>`;
    expect(flowHeight(kind, wrapped)).toBeCloseTo(flowHeight(kind, lines(AUTO)), 3);
  });
}

test('a table cell in a header still drops its last paragraph automatic space after', () => {
  const table = (spacing: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${paragraph('Cell', spacing)}</w:tc></w:tr></w:tbl>`;
  // The story ends with an unspaced paragraph so that only the cell edge differs.
  const after = paragraph('Below', NONE);
  expect(flowHeight('hdr', table(AUTO) + after)).toBeCloseTo(
    flowHeight('hdr', table(NONE) + after),
    3
  );
});

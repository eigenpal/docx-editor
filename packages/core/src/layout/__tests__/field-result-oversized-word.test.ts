import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { caretAt, hitTestSemantic } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const field = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(result) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function layout(content: string, table = false) {
  const paragraph = `<w:p>${content}</w:p>`;
  const body = table
    ? '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
      '<w:left w:w="0"/><w:right w:w="0"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${paragraph}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('next')}</w:p></w:tc>` +
      '</w:tr></w:tbl>'
    : paragraph;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    geometry: { width: 120, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

const lineTexts = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) => line.spans.map((span) => span.text).join(''));

test('an oversized HYPERLINK field result wraps at the measure', () => {
  const result = layout(field(`HYPERLINK "https://example.org/" \\h`, TOKEN));
  expect(lineTexts(result)).toEqual(['ABCDEFGHIJKLMNOPQRST', 'UVWXY']);
  for (const line of linesOf(result)) {
    for (const span of line.spans) {
      expect(span.projected).toBe(true);
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(120 + 0.01);
    }
  }
});

test('an oversized field result wraps inside a fixed table cell', () => {
  const result = layout(field(`HYPERLINK "https://example.org/" \\h`, TOKEN), true);
  const cell = lineTexts(result).filter((text) => text !== 'next');
  expect(cell).toEqual(['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXY']);
});

test('every chopped field fragment publishes the whole field range', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const spans = linesOf(result)
    .flatMap((line) => line.spans)
    .filter((span) => span.projected);
  expect(spans.length).toBeGreaterThan(1);
  for (const span of spans) expect(span.range).toEqual(spans[0]!.range);
  expect(spans.map((span) => span.text).join('')).toBe(TOKEN + TOKEN);
  expect(lineTexts(result)[0]).toBe('ab ');
});

test('the caret after a chopped field follows its last fragment', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  const { paragraphId, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const after = caretAt(result, { paragraphId, offset: end });
  const last = fragments.at(-1)!;
  const tail = last.spans.filter((span) => span.projected).at(-1)!;
  expect(after?.y).toBe(last.box.y);
  expect(after?.x).toBe(tail.box.x + tail.box.width);
});

test('a click on a later fragment resolves to the field', () => {
  const result = layout(run('ab ') + field('HYPERLINK "https://example.org/"', TOKEN + TOKEN));
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  const { start, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const second = fragments[1]!;
  const hit = hitTestSemantic(result, { x: 30, y: second.box.y + 6 });
  expect([start, end]).toContain(hit!.position.offset);
});

test('a form control stays whole', () => {
  const dropdown =
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Dropdown1"/>' +
    `<w:ddList><w:listEntry w:val="${TOKEN}"/></w:ddList></w:ffData></w:fldChar></w:r>` +
    '<w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const spans = linesOf(layout(dropdown)).flatMap((line) => line.spans);
  expect(spans.filter((span) => span.fieldAtom?.formControl).map((span) => span.text)).toEqual([
    TOKEN,
  ]);
});

test('other cached field results chop the same way', () => {
  expect(lineTexts(layout(field('REF bookmark \\h', TOKEN)))).toEqual([
    'ABCDEFGHIJKLMNOPQRST',
    'UVWXY',
  ]);
});

test('a field result with spaces still wraps at its spaces', () => {
  expect(
    lineTexts(layout(field('HYPERLINK "https://example.org/"', 'ABCDEFGHIJ KLMNOPQRST')))
  ).toEqual(['ABCDEFGHIJ ', 'KLMNOPQRST']);
});

test('the caret after a field split at its spaces follows its last line', () => {
  const result = layout(
    run('ab ') + field('HYPERLINK "https://example.org/"', 'ABCDEFGHIJ KLMNOPQRST UVW')
  );
  const fragments = linesOf(result).filter((line) => line.spans.some((span) => span.projected));
  expect(fragments).toHaveLength(2);
  const { paragraphId, end } = fragments[0]!.spans.find((span) => span.projected)!.range;
  const tail = fragments[1]!.spans.filter((span) => span.projected).at(-1)!;
  const after = caretAt(result, { paragraphId, offset: end });
  expect(after?.y).toBe(fragments[1]!.box.y);
  expect(after?.x).toBe(tail.box.x + tail.box.width);
});

test('a field result in an East Asian paragraph chops at its own text', () => {
  const result = layout(run('中文') + field('HYPERLINK "https://example.org/"', TOKEN));
  const fragments = linesOf(result)
    .flatMap((line) => line.spans)
    .filter((span) => span.projected);
  expect(fragments.map((span) => span.text).join('')).toBe(TOKEN);
  expect(fragments.length).toBeGreaterThan(1);
  for (const span of fragments) expect(span.box.x + span.box.width).toBeLessThanOrEqual(120.01);
});

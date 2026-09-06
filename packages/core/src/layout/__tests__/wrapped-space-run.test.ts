import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { spanOffsetX } from '../semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, bold = false) =>
  `<w:r><w:rPr><w:sz w:val="22"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const measurer = createFixedMeasurer(10, 12);
function layout(body: string, width = 25) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const original = serializeOoxmlPart(parsed.part);
  const result = layoutSemanticDocument(parsed.part, 1, {
    measurer,
    geometry: { width, height: 300, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  expect(serializeOoxmlPart(parsed.part)).toBe(original);
  return linesOf(result);
}
const texts = (lines: ReturnType<typeof layout>) =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

describe('separate whitespace runs at a soft-wrap margin', () => {
  test('retains the separator on its old line without indenting the next word', () => {
    const lines = layout(run('AB') + run(' ', true) + run('CD'));
    expect(texts(lines)).toEqual(['AB ', 'CD']);
    const space = lines[0]!.spans.at(-1)!;
    expect(space.range).toMatchObject({ start: 2, end: 3 });
    expect(space.box.width).toBe(5);
    expect(spanOffsetX(space, 3, measurer)).toBe(25);
    expect(lines[1]!.spans[0]!.box.x).toBe(0);
  });
  test('keeps long and producer-split space runs in the same line', () => {
    const spaces = run('  ', true) + run('  ');
    expect(texts(layout(run('AB') + spaces + run('CD', true)))).toEqual(['AB    ', 'CD']);
  });
  test('ordinary spaces that fit retain their measured advance', () => {
    const lines = layout(run('A') + run(' ', true) + run('B'), 40);
    expect(texts(lines)).toEqual(['A B']);
    expect(lines[0]!.spans[1]!.box.width).toBe(10);
  });
  test('does not drop an authored paragraph indent made from spaces', () => {
    const lines = layout(run(' ', true) + run('A'));
    expect(texts(lines)).toEqual([' A']);
    expect(lines[0]!.spans.at(-1)!.box.x).toBe(10);
  });
  test('does not collapse leading spaces after a hard break', () => {
    const lines = layout(run('AB') + '<w:r><w:br/></w:r>' + run(' ', true) + run('C'));
    expect(texts(lines)).toEqual(['AB\n', ' C']);
    expect(lines[1]!.spans.at(-1)!.box.x).toBe(10);
  });
  test('keeps nonbreaking spaces non-collapsible', () => {
    const lines = layout(run('AB') + run('\u00a0', true) + run('C'));
    expect(
      lines.flatMap((line) => line.spans).find((span) => span.text === '\u00a0')!.box.width
    ).toBe(10);
  });
});

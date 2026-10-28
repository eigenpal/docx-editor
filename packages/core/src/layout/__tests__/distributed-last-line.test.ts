import { expect, test } from 'bun:test';
import { serializeOoxmlPart, type OoxmlProperty } from '../../store/index.ts';
import { boxLineSetsLikeLastLine, setsLikeLastLine } from '../paragraph-alignment.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord, type StyleSpanRecord } from '../semantic-records.ts';
import { loadBody, layoutUnderFloat, squareWrapZone } from './float-over-table-harness.ts';

const measurer = createFixedMeasurer(10, 14);
const geometry = {
  width: 120,
  height: 400,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const jc = (val: string) => ({ localName: 'jc', attributes: { val } }) as OoxmlProperty;
const paragraph = (alignment: string, text: string) =>
  `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

function layout(body: string) {
  const source = loadBody(body);
  const before = serializeOoxmlPart(source);
  const result = layoutSemanticDocument(source, 0, { measurer, geometry });
  expect(serializeOoxmlPart(source)).toBe(before);
  return linesOf(result);
}

function end(spans: readonly StyleSpanRecord[]) {
  const span = spans.filter((s) => s.text.trim().length > 0).at(-1)!;
  return span.box.x + measurer.measure(span.text.trimEnd(), span.style);
}

for (const text of ['aa bb cc dd ee ff gg hh ii', '甲乙丙丁戊己庚辛壬癸子丑寅']) {
  test(`distributed body paragraphs stretch their final line: ${text}`, () => {
    const distributed = layout(paragraph('distribute', text));
    const justified = layout(paragraph('both', text));
    expect(distributed.length).toBeGreaterThan(1);
    expect(distributed.map((line) => line.spans.map((s) => s.text).join(''))).toEqual(
      justified.map((line) => line.spans.map((s) => s.text).join(''))
    );
    for (const line of distributed) expect(end(line.spans)).toBeCloseTo(100, 7);
    expect(end(justified.at(-1)!.spans)).toBeLessThan(100);
  });
}

test('distributed paragraphs stretch the final line in a table cell', () => {
  const lines = layout(
    `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph('distribute', 'aa bb cc dd ee ff gg hh ii')}</w:tc></w:tr></w:tbl>`
  );
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) expect(end(line.spans)).toBeCloseTo(100, 7);
});

function parts(line: LineRecord) {
  const result: StyleSpanRecord[][] = [];
  for (const span of line.spans) {
    if (result.length === 0 || (span.wrapAdvanceBefore ?? 0) > 0.001) result.push([]);
    result.at(-1)!.push(span);
  }
  return result;
}

test('the final distributed line fills each passage beside a float', () => {
  const source = loadBody(paragraph('distribute', 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn'));
  const before = serializeOoxmlPart(source);
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone = squareWrapZone({
    anchorParagraphId: target.id,
    top: 0,
    height: 70,
    left: 60,
    width: 40,
  });
  const lines = linesOf(layoutUnderFloat(source, new Map([[0, [zone]]])));
  const last = lines.at(-1)!;
  const passages = parts(last);
  expect(passages).toHaveLength(2);
  const fixed = createFixedMeasurer();
  for (const [index, spans] of passages.entries()) {
    const span = spans.filter((s) => s.text.trim().length > 0).at(-1)!;
    const right = span.box.x + fixed.measure(span.text.trimEnd(), span.style);
    expect(right).toBeCloseTo(index === 0 ? 60 : 180, 7);
  }
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('last-line classification preserves distribution and normal justification', () => {
  for (const closing of [
    {},
    { pageBreakAfter: true },
    { columnBreakAfter: true },
    { manualBreakAfter: true as const },
  ]) {
    for (const isLast of [false, true]) {
      expect(setsLikeLastLine([jc('distribute')], closing, isLast)).toBe(false);
      expect(boxLineSetsLikeLastLine([jc('distribute')], closing, isLast)).toBe(false);
    }
  }
  expect(setsLikeLastLine([jc('both')], {}, true)).toBe(true);
  expect(boxLineSetsLikeLastLine([jc('both')], {}, true)).toBe(true);
  expect(setsLikeLastLine([jc('both')], { pageBreakAfter: true }, false)).toBe(true);
  expect(setsLikeLastLine([jc('both')], { manualBreakAfter: true }, false)).toBe(false);
  expect(
    setsLikeLastLine([jc('both')], { manualBreakAfter: true }, false, {
      unstretchedManualBreakLines: true,
    })
  ).toBe(true);
  // The last authored alignment wins.
  expect(setsLikeLastLine([jc('distribute'), jc('both')], {}, true)).toBe(true);
});

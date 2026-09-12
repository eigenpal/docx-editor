import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { paragraphAlignment } from '../paragraph-flow.ts';
import { spanOffsetX, hitTestPage, lineEndOffset } from '../semantic-hit-test.ts';
import { paragraphIsRtl, reorderBidiSpans } from '../rtl-paragraph.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}
const measurer = createFixedMeasurer(6, 14);
function layout(text: string, pPr = '', table = false, width = 120, rPr = '') {
  const paragraph = `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body>${table ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>` : paragraph}<w:sectPr><w:pgSz w:w="${width * 20 + 600}" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`
    ),
    0,
    {
      measurer,
      styleCascade: buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:bidi/></w:pPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      ),
    }
  );
}

test('inherited bidi gives logical start alignment and permits an explicit off override', () => {
  expect(paragraphIsRtl([{ localName: 'bidi' }])).toBe(true);
  expect(
    paragraphIsRtl([{ localName: 'bidi' }, { localName: 'bidi', attributes: { val: 'off' } }])
  ).toBe(false);
  expect(paragraphAlignment([{ localName: 'bidi' }])).toBe('right');
  expect(
    paragraphAlignment([{ localName: 'jc', attributes: { val: 'start' } }, { localName: 'bidi' }])
  ).toBe('right');
  expect(
    paragraphAlignment([{ localName: 'bidi' }, { localName: 'jc', attributes: { val: 'end' } }])
  ).toBe('left');
  expect(
    paragraphAlignment([{ localName: 'bidi' }, { localName: 'jc', attributes: { val: 'left' } }])
  ).toBe('left');
  expect(linesOf(layout('abc', '<w:bidi w:val="0"/>'))[0]!.contentX).toBe(0);
});

test.each([false, true])(
  'RTL words use descending positions in body/table=%s without reversing text or numbers',
  (table) => {
    const lines = linesOf(layout('مرحبا عالم 123', '', table));
    const line = lines.find((l) => l.spans.some((s) => s.text.includes('مرحبا')))!;
    const first = line.spans.find((s) => s.text.includes('مرحبا'))!;
    const last = line.spans.find((s) => s.text.includes('123'))!;
    expect(first.box.x).toBeGreaterThan(last.box.x);
    expect(first.style.shaping?.direction).toBe('rtl');
    expect(last.style.shaping?.direction).toBe('ltr');
    expect(line.spans.map((s) => s.text).join('')).toBe('مرحبا عالم 123');
    expect(spanOffsetX(first, first.range.start, measurer)).toBe(first.box.x + first.box.width);
    expect(spanOffsetX(first, first.range.end, measurer)).toBeCloseTo(first.box.x);
  }
);

test('wrapping retains logical offsets and right-aligned final line', () => {
  const text = 'مرحبا عالم '.repeat(12).trim();
  const lines = linesOf(layout(text));
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.flatMap((l) => l.spans.map((s) => s.text)).join('')).toBe(text);
  const last = lines.at(-1)!;
  expect(Math.max(...last.spans.map((s) => s.box.x + s.box.width))).toBeCloseTo(120);
  for (const line of lines) {
    const positions = line.spans.filter((s) => s.box.width > 0).map((s) => s.box.x);
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
  }
});

test('paint keeps DOM text in logical order and places bidi runs at published geometry', () => {
  const result = layout('مرحبا عالم 123');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const line = linesOf(result)[0]!;
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(elements.map((el) => el.textContent).join('')).toBe('مرحبا عالم 123');
  let advance = 0;
  for (const [index, span] of line.spans.entries()) {
    const el = elements[index]!;
    expect(el.style.direction).toBe(span.style.shaping?.direction ?? 'ltr');
    expect(parseFloat(el.style.left) + advance + line.contentX).toBeCloseTo(span.box.x);
    advance += span.box.width;
  }
});

test('wrapped Latin trailing spaces reset to the RTL paragraph level', () => {
  const lines = linesOf(layout('אבג abc def ghi jkl mno pqr stu'));
  for (const line of lines.slice(0, -1)) {
    const last = line.spans.at(-1)!;
    expect(last.text.trim()).toBe('');
    expect(last.style.shaping?.direction).toBe('rtl');
    expect(last.box.x).toBe(line.contentX);
  }
});

test('first-line indent applies at the RTL start edge', () => {
  const line = linesOf(layout('مرحبا عالم', '<w:ind w:firstLine="240"/>'))[0]!;
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(108);
});

test('the final justified RTL line aligns to the right', () => {
  const line = linesOf(layout('مرحبا', '<w:jc w:val="both"/>'))[0]!;
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(120);
});

test('RTL words cannot consume the fixed gap around a floating object', () => {
  const source = linesOf(layout('مرحبا'))[0]!.spans[0]!;
  const spans = [
    { ...source, text: 'A', box: { ...source.box, x: 0, width: 30 } },
    { ...source, text: 'B', box: { ...source.box, x: 30, width: 20 } },
    { ...source, text: 'C', box: { ...source.box, x: 100, width: 20 }, wrapAdvanceBefore: 50 },
  ];
  const reordered = reorderBidiSpans(spans);
  for (const span of reordered) {
    expect(span.box.x + span.box.width <= 50 || span.box.x >= 100).toBe(true);
  }
  expect(reordered.map((span) => span.box.width)).toEqual([30, 20, 20]);
});

test('clicking beyond a wrapped RTL line stays before its trailing space', () => {
  const result = layout('مرحبا عالم '.repeat(12));
  const line = linesOf(result)[0]!;
  const hit = hitTestPage(
    result,
    0,
    { x: line.contentX - 20, y: line.box.y + line.box.height / 2 },
    { measurer }
  );
  expect(hit?.lineId).toBe(line.id);
  expect(hit?.position.offset).toBe(lineEndOffset(result, line));
  expect(hit?.position.offset).toBeLessThan(line.range.end);
});

test('bidi itemization does not add breaks at nonbreaking spaces', () => {
  const lines = linesOf(layout('אב אבג\u00a0דהו', '', false, 50));
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'אב ',
    'אבג\u00a0דהו',
  ]);
});

test('logical RTL indents apply to the inherited leading and trailing sides', () => {
  const result = layout('مرحبا', '<w:ind w:start="720" w:end="240"/>');
  const line = linesOf(result)[0]!;
  expect(line.box.x).toBe(12);
  expect(line.box.width).toBe(72);
  expect(Math.max(...line.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(84);
  const physical = linesOf(layout('مرحبا', '<w:ind w:left="240" w:right="480"/>'))[0]!;
  expect(physical.box.x).toBe(12);
  expect(Math.max(...physical.spans.map((span) => span.box.x + span.box.width))).toBeCloseTo(96);
});

test('justified RTL spans stretch authored spaces in the native text band', () => {
  const result = layout('مرحبا عالم '.repeat(8), '<w:jc w:val="both"/>');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const line = linesOf(result)[0]!;
  const elements = Array.from(
    host.querySelectorAll<HTMLElement>('.docx-line')
  )[0]!.querySelectorAll<HTMLElement>('.layout-run-text');
  expect(line.spans.some((span) => (span.style.shaping?.wordSpacingPt ?? 0) > 0)).toBe(true);
  for (const [index, span] of line.spans.entries()) {
    if (!span.style.shaping?.wordSpacingPt) continue;
    expect(parseFloat(elements[index]!.style.wordSpacing)).toBeCloseTo(
      span.style.shaping.wordSpacingPt
    );
  }
});

test('scaled RTL ink preserves the published outer band width', () => {
  const result = layout('مرحبا', '', false, 120, '<w:w w:val="200"/>');
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const span = linesOf(result)[0]!.spans[0]!;
  const outer = host.querySelector<HTMLElement>('.layout-run-text')!;
  expect(outer.style.transform).toBe('');
  expect(parseFloat(outer.style.width)).toBeCloseTo(span.box.width);
  const ink = outer.querySelector<HTMLElement>('[data-docx-clipped-fill]')!;
  expect(ink.style.transform).toBe('scaleX(2)');
  expect(ink.style.transformOrigin).toBe('right');
  expect(parseFloat(ink.style.width) * 2).toBeCloseTo(span.box.width);
});

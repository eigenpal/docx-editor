import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { continuedCellLines, type CellBreakMemo } from '../cell-continuation-lines.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord, TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function cellTable(content: string, twips: number, paragraphProps = '', header = false) {
  const headerRow = header
    ? '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr>' +
      `<w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>head</w:t></w:r></w:p></w:tc></w:tr>`
    : '';
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>${headerRow}<w:tr><w:tc><w:tcPr>` +
    `<w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p>${paragraphProps}${content}</w:p></w:tc></w:tr></w:tbl>`
  );
}

function layout(body: string, height: number, measurer: TextMeasurer = createFixedMeasurer()) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer,
    geometry: { width: 400, height, margin: { top: 20, bottom: 20, left: 20, right: 20 } },
  });
}

/** Every body-row cell line's model range and x, in page order; repeated header rows skipped. */
function cellLines(result: ReturnType<typeof layout>): string[] {
  return result.pages.flatMap((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((table) =>
        table.rows.flatMap((row) =>
          row.cells.flatMap((cell) =>
            cell.blocks.flatMap((block) =>
              block.kind === 'paragraph'
                ? block.lines
                    .filter((line) => !line.spans.some((span) => span.text === 'head'))
                    .map(
                      (line) =>
                        `${line.range.start}-${line.range.end}@${(line.spans[0]?.box.x ?? 0).toFixed(2)}`
                    )
                : []
            )
          )
        )
      )
  );
}

const alternatingRuns = (count: number) =>
  '<w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:t>1</w:t></w:r>'.repeat(count / 2);

for (const header of [false, true]) {
  test(`a cell paragraph split across pages costs time linear in its length${header ? ' under a repeated header row' : ''}`, () => {
    const calls = (count: number) => {
      const base = createFixedMeasurer();
      let made = 0;
      const measurer: TextMeasurer = {
        ...base,
        lineMetrics: (...args: Parameters<TextMeasurer['lineMetrics']>) => {
          made += 1;
          return base.lineMetrics(...args);
        },
      };
      const result = layout(cellTable(alternatingRuns(count), 400, '', header), 400, measurer);
      expect(result.pages.length).toBeGreaterThan(count / 100);
      return made;
    };
    // Re-breaking the remainder on each page made this ratio about 11.
    expect(calls(1600) / calls(400)).toBeLessThan(4.5);
  });
}

const words = Array.from({ length: 120 }, (_, index) => `w${index % 7}x${'a'.repeat(index % 5)}`);
const plain = `<w:r><w:t xml:space="preserve">${words.join(' ')}</w:t></w:r>`;
const cases: Record<string, string> = {
  plain: '',
  'hanging indent': '<w:pPr><w:ind w:left="400" w:hanging="400"/></w:pPr>',
  'first-line indent': '<w:pPr><w:ind w:firstLine="600"/></w:pPr>',
  'right-to-left': '<w:pPr><w:bidi/><w:ind w:start="300" w:hanging="300"/></w:pPr>',
};
for (const [name, props] of Object.entries(cases))
  for (const header of [false, true])
    test(`a continued ${name} cell paragraph keeps the lines of its whole break${header ? ' under a repeated header row' : ''}`, () => {
      const split = layout(cellTable(plain, 1600, props, header), 200);
      const whole = layout(cellTable(plain, 1600, props, header), 4000);
      expect(split.pages.length).toBeGreaterThan(2);
      expect(whole.pages).toHaveLength(1);
      expect(cellLines(split)).toEqual(cellLines(whole));
    });

test('a continuation picks its line by index, not by the first line with its start', () => {
  const line = (start: number, end: number) => ({ start, end }) as unknown as PendingLine;
  // A layout-owned piece wrapped over three lines: the last two start at its end.
  const whole = [line(0, 5), line(5, 9), line(9, 9), line(9, 12)];
  const paragraph = { kind: 'paragraph' } as unknown as OoxmlNode;
  const memo: CellBreakMemo = new WeakMap([[paragraph, { key: 'k', lines: whole }]]);
  const scope = { memo, pageZones: false, inlineDrawingLayout: undefined };
  const rest = () => [line(9, 12)];
  expect(continuedCellLines(paragraph, 9, 3, scope, () => 'k', rest)).toEqual({
    lines: whole,
    from: 3,
  });
  // A stale cursor, or another key, breaks the remainder instead.
  expect(continuedCellLines(paragraph, 9, 1, scope, () => 'k', rest).from).toBe(0);
  expect(continuedCellLines(paragraph, 9, 3, scope, () => 'other', rest).from).toBe(0);
});

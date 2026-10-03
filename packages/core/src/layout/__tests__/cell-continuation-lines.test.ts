import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord, TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function cellTable(content: string, twips: number) {
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid><w:tr><w:tc><w:tcPr>` +
    `<w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p>${content}</w:p></w:tc></w:tr></w:tbl>`
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

/** Every cell line's model range, in page order. */
function cellLineRanges(result: ReturnType<typeof layout>): string[] {
  return result.pages.flatMap((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((table) =>
        table.rows.flatMap((row) =>
          row.cells.flatMap((cell) =>
            cell.blocks.flatMap((block) =>
              block.kind === 'paragraph'
                ? block.lines.map((line) => `${line.range.start}-${line.range.end}`)
                : []
            )
          )
        )
      )
  );
}

const alternatingRuns = (count: number) =>
  '<w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:t>1</w:t></w:r>'.repeat(count / 2);

test('a cell paragraph split across pages costs time linear in its length', () => {
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
    const result = layout(cellTable(alternatingRuns(count), 400), 400, measurer);
    expect(result.pages.length).toBeGreaterThan(count / 100);
    return made;
  };
  // Re-breaking the remainder on each page made this ratio about 11.
  expect(calls(1600) / calls(400)).toBeLessThan(4.5);
});

test('a continued cell paragraph keeps the lines of its whole break', () => {
  const words = Array.from({ length: 120 }, (_, index) => `w${index % 7}x${'a'.repeat(index % 5)}`);
  const content = `<w:r><w:t xml:space="preserve">${words.join(' ')}</w:t></w:r>`;
  const split = layout(cellTable(content, 1600), 200);
  const whole = layout(cellTable(content, 1600), 4000);
  expect(split.pages.length).toBeGreaterThan(2);
  expect(whole.pages).toHaveLength(1);
  expect(cellLineRanges(split)).toEqual(cellLineRanges(whole));
});

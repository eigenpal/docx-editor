import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  LineRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

// Fixed measurer at the 10pt default: 5.4545pt per character, 12.7273pt per line. Cells keep
// the default 5.4pt left and right margins and no top or bottom margin.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINE = (14 * 10) / 11;

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const layout = (bodyXml: string): SemanticLayout =>
  layoutSemanticDocument(loadPart(bodyXml), 0, { measurer: createFixedMeasurer() });

const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
const paragraph = (text: string, runProperties = ''): string =>
  `<w:p><w:pPr><w:rPr>${runProperties}</w:rPr></w:pPr>` +
  (text ? `<w:r><w:rPr>${runProperties}</w:rPr><w:t>${text}</w:t></w:r>` : '') +
  '</w:p>';
const turned = (content: string, extra = ''): string =>
  `<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/>${extra}<w:textDirection w:val="btLr"/></w:tcPr>${content}</w:tc>`;
const plain = (content: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const row = (cells: string, height?: string, header = false): string =>
  '<w:tr>' +
  (height || header
    ? `<w:trPr>${header ? '<w:tblHeader/>' : ''}${height ? `<w:trHeight ${height}/>` : ''}</w:trPr>`
    : '') +
  cells +
  '</w:tr>';
const table = (rows: string, columns = 2): string =>
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
  '<w:gridCol w:w="1440"/>'.repeat(columns) +
  `</w:tblGrid>${rows}</w:tbl>`;
const filler = (count: number): string =>
  Array.from({ length: count }, (_, index) => paragraph(`filler ${index}`)).join('');

function tables(result: SemanticLayout): TableFragmentRecord[] {
  return result.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

function rowsOf(result: SemanticLayout): TableRowFragmentRecord[] {
  return tables(result).flatMap((fragment) => fragment.rows);
}

function linesOf(cell: TableCellFragmentRecord): LineRecord[] {
  return cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
}

function textOf(cell: TableCellFragmentRecord): string {
  return linesOf(cell)
    .map((line) => line.spans.map((span) => span.text).join(''))
    .join('|');
}

const wordCount = (cell: TableCellFragmentRecord): number =>
  textOf(cell).match(/word/g)?.length ?? 0;

/** Longest laid line, measured along the row, from the start of its first span. */
function longestLine(cell: TableCellFragmentRecord): number {
  let longest = 0;
  for (const line of linesOf(cell)) {
    const first = line.spans[0];
    const last = line.spans.at(-1);
    if (first && last) longest = Math.max(longest, last.box.x + last.box.width - first.box.x);
  }
  return longest;
}

describe('bottom-to-top cell text and row height', () => {
  test('wraps long text at an authored minimum instead of growing the row', () => {
    const result = layout(
      table(row(turned(paragraph(words(40))) + plain(paragraph('x')), 'w:val="2000"'))
    );
    expect(result.pages).toHaveLength(1);
    const [only, ...others] = rowsOf(result);
    expect(others).toHaveLength(0);
    expect(only!.box.height).toBeCloseTo(100, 3);
    const cell = only!.cells[0]!;
    expect(longestLine(cell)).toBeLessThanOrEqual(100 + 0.001);
    // Only the lines the cell width holds are laid; the rest is clipped, not continued.
    const lines = linesOf(cell);
    expect(wordCount(cell)).toBeGreaterThan(0);
    expect(wordCount(cell)).toBeLessThan(40);
    for (const line of lines) {
      expect(line.box.y + line.box.height).toBeLessThanOrEqual(cell.box.y + cell.box.width + 0.001);
    }
    expect(only!.isContinuation).toBeUndefined();
  });

  test('keeps short text on one line at the authored minimum', () => {
    const result = layout(
      table(row(turned(paragraph('short label')) + plain(paragraph('x')), 'w:val="2000"'))
    );
    const [only] = rowsOf(result);
    expect(only!.box.height).toBeCloseTo(100, 3);
    expect(linesOf(only!.cells[0]!)).toHaveLength(1);
    expect(textOf(only!.cells[0]!)).toBe('short label');
  });

  test('wraps at the height a taller horizontal neighbour gives the row', () => {
    const neighbour = Array.from({ length: 10 }, (_, index) => paragraph(`n${index}`)).join('');
    const result = layout(
      table(row(turned(paragraph(words(12))) + plain(neighbour), 'w:val="1000"'))
    );
    const [only] = rowsOf(result);
    expect(only!.box.height).toBeCloseTo(10 * LINE, 3);
    const longest = longestLine(only!.cells[0]!);
    expect(longest).toBeGreaterThan(50);
    expect(longest).toBeLessThanOrEqual(10 * LINE + 0.001);
    expect(wordCount(only!.cells[0]!)).toBe(12);
  });

  test('does not size a row without a height rule', () => {
    const turnedRow = layout(table(row(turned(paragraph(words(40))) + plain(paragraph('x')))));
    const control = layout(table(row(plain(paragraph('y')) + plain(paragraph('x')))));
    expect(rowsOf(turnedRow)).toHaveLength(1);
    expect(rowsOf(turnedRow)[0]!.box.height).toBeCloseTo(rowsOf(control)[0]!.box.height, 3);
    expect(longestLine(rowsOf(turnedRow)[0]!.cells[0]!)).toBeLessThanOrEqual(LINE + 0.001);
  });

  test('gives an exact row the same wrapped lines as an equal minimum', () => {
    const lines = (height: string): string[] => {
      const result = layout(
        table(row(turned(paragraph(words(40))) + plain(paragraph('x')), height))
      );
      const [only, ...others] = rowsOf(result);
      expect(others).toHaveLength(0);
      expect(only!.box.height).toBeCloseTo(100, 3);
      return linesOf(only!.cells[0]!).map((line) => line.spans.map((s) => s.text).join(''));
    };
    expect(lines('w:val="2000" w:hRule="exact"')).toEqual(lines('w:val="2000" w:hRule="atLeast"'));
  });

  test('sizes a row of only turned cells from their end-of-cell marks', () => {
    const large = '<w:sz w:val="40"/>';
    const result = layout(
      table(row(turned(paragraph(words(4), large)) + turned(paragraph('', large))))
    );
    expect(rowsOf(result)[0]!.box.height).toBeCloseTo(2 * LINE, 3);
  });

  test('pads an authored minimum with the turned cell margins', () => {
    const margins =
      '<w:tcMar><w:top w:w="360" w:type="dxa"/><w:bottom w:w="180" w:type="dxa"/></w:tcMar>';
    const result = layout(
      table(row(turned(paragraph(words(12)), margins) + plain(paragraph('x')), 'w:val="2000"'))
    );
    const [only] = rowsOf(result);
    expect(only!.box.height).toBeCloseTo(127, 3);
    expect(longestLine(only!.cells[0]!)).toBeLessThanOrEqual(100 + 0.001);
  });

  test('wraps a merged turned head along its whole span without growing the rows', () => {
    const result = layout(
      table(
        row(
          turned(paragraph(words(12)), '<w:vMerge w:val="restart"/>') + plain(paragraph('a')),
          'w:val="1000"'
        ) + row(turned(paragraph(''), '<w:vMerge/>') + plain(paragraph('b')), 'w:val="1000"')
      )
    );
    const rows = rowsOf(result);
    expect(rows.map((placed) => placed.box.height)).toEqual([50, 50]);
    const longest = longestLine(rows[0]!.cells[0]!);
    expect(longest).toBeGreaterThan(50);
    expect(longest).toBeLessThanOrEqual(100 + 0.001);
  });

  test('moves a minimum-height row with turned text whole past a page end', () => {
    const result = layout(
      filler(48) + table(row(turned(paragraph(words(12))) + plain(paragraph('x')), 'w:val="2000"'))
    );
    expect(result.pages).toHaveLength(2);
    expect(tables(result)).toHaveLength(1);
    expect(result.pages[1]!.fragments[0]!.kind).toBe('table');
    const [only] = rowsOf(result);
    expect(only!.box.height).toBeCloseTo(100, 3);
    expect(wordCount(only!.cells[0]!)).toBe(12);
  });

  test('splits an auto row past a page end and keeps turned text in its first part', () => {
    const neighbour = Array.from({ length: 12 }, (_, index) => paragraph(`n${index}`)).join('');
    const result = layout(filler(45) + table(row(turned(paragraph(words(6))) + plain(neighbour))));
    const rows = rowsOf(result);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.isContinuation).toBe(true);
    expect(wordCount(rows[0]!.cells[0]!)).toBe(6);
    expect(rows[1]!.cells[0]!.blocks).toHaveLength(0);
    expect(longestLine(rows[0]!.cells[0]!)).toBeLessThanOrEqual(rows[0]!.box.height + 0.001);
  });

  test('repeats a turned header row at the same height on every page', () => {
    const body = Array.from({ length: 60 }, (_, index) =>
      row(plain(paragraph(`r${index}`)) + plain(paragraph('c')))
    ).join('');
    const result = layout(
      table(row(turned(paragraph(words(12))) + plain(paragraph('h')), 'w:val="2000"', true) + body)
    );
    const headers = rowsOf(result).filter((placed) => placed.isHeaderRow);
    expect(tables(result).length).toBeGreaterThan(1);
    expect(headers.length).toBe(tables(result).length);
    for (const header of headers) {
      expect(header.box.height).toBeCloseTo(100, 3);
      expect(textOf(header.cells[0]!)).toBe(textOf(headers[0]!.cells[0]!));
    }
  });

  test('still grows a horizontal row past its minimum', () => {
    const neighbour = Array.from({ length: 10 }, (_, index) => paragraph(`n${index}`)).join('');
    const result = layout(table(row(plain(paragraph('a')) + plain(neighbour), 'w:val="1000"')));
    expect(rowsOf(result)[0]!.box.height).toBeCloseTo(10 * LINE, 3);
  });
});

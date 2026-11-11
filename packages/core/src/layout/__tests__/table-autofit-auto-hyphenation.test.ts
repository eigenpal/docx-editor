// With `w:autoHyphenation`, Word hyphenates a long word inside its autofit column. The column
// keeps its preferred width and does not take room from the other columns. The table below
// states 25, 100, 205 and 138pt columns in a 468pt text column. The fixed measurer gives 6pt
// to each character, so the 60-letter word needs 360pt when it stays whole.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { withHyphenationCuts } from '../auto-hyphenation.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const GRID = [500, 2000, 4100, 2760];
const LONG_WORD = 'abcdefghij'.repeat(6);
const STATED_WIDTHS = [25, 100, 205, 138];

function part(xml: string, name: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function settings(children: string) {
  return part(`<w:settings xmlns:w="${W}">${children}</w:settings>`, '/word/settings.xml');
}

function columnWidths(
  settingsChildren: string | null,
  longText = LONG_WORD,
  longCellParagraphProperties = ''
): number[] {
  const texts = ['1', 'Fields', longText, 'Short note'];
  const cells = texts
    .map((text, index) => {
      const pPr = index === 2 ? longCellParagraphProperties : '';
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${GRID[index]}" w:type="dxa"/></w:tcPr>` +
        `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
      );
    })
    .join('');
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
    '<w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid>${GRID.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    `<w:tr>${cells}</w:tr></w:tbl><w:p/>${LETTER}</w:body></w:document>`;
  const settingsRoot = settingsChildren === null ? null : settings(settingsChildren).root;
  const layout = layoutSemanticDocument(part(xml, '/word/document.xml'), 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode: 15,
    styleCascade: buildStyleCascadeTable(null, undefined, settingsRoot),
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const edges = table.columnEdges;
  return edges.slice(1).map((edge, index) => edge - edges[index]!);
}

function expectStatedWidths(columns: readonly number[]): void {
  expect(columns).toHaveLength(STATED_WIDTHS.length);
  for (const [index, width] of STATED_WIDTHS.entries())
    expect(columns[index]!).toBeCloseTo(width, 1);
}

test('automatic hyphenation keeps a long word inside its preferred column', () => {
  expectStatedWidths(columnWidths('<w:autoHyphenation/>'));
  expectStatedWidths(columnWidths('<w:autoHyphenation w:val="true"/>'));
});

test('without automatic hyphenation a long word widens its column', () => {
  expect(columnWidths(null)[2]!).toBeGreaterThan(360);
  expect(columnWidths('<w:autoHyphenation w:val="0"/>')[2]!).toBeGreaterThan(360);
});

test('a paragraph that suppresses automatic hyphens keeps its long word whole', () => {
  const columns = columnWidths(
    '<w:autoHyphenation/>',
    LONG_WORD,
    '<w:pPr><w:suppressAutoHyphens/></w:pPr>'
  );
  expect(columns[2]!).toBeGreaterThan(360);
});

test('automatic hyphenation does not break a run of digits', () => {
  expect(columnWidths('<w:autoHyphenation/>', '1234567890'.repeat(6))[2]!).toBeGreaterThan(360);
});

test('hyphenation cuts fall between letters and keep the existing breaks', () => {
  expect(withHyphenationCuts('ab cd', [3, 5])).toEqual([1, 3, 4, 5]);
  expect(withHyphenationCuts('a1b', [3])).toEqual([3]);
  expect(withHyphenationCuts('ée', [3])).toEqual([3]);
  expect(withHyphenationCuts('аб', [2])).toEqual([1, 2]);
  expect(withHyphenationCuts('אב', [2])).toEqual([2]);
});

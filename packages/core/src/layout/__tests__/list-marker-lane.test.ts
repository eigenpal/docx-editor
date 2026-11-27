// A right-to-left paragraph (`w:bidi`, 17.3.1.6) sizes its list marker from the complex-script
// lane (`w:szCs`, 17.3.2.39; `w:bCs`), not `w:sz` (17.3.2.38). `w:cs` (17.3.2.7) on the marker
// selects that lane too. `w:rtl` (17.3.2.30) on the mark or the level does not.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { paragraphFragmentsOf, type ListMarkerRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}

const SIZES = '<w:sz w:val="44"/><w:szCs w:val="28"/>';
const level = (id: number, rPr: string, fmt = 'decimal', text = '%1.') =>
  `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
  `<w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr>${rPr}</w:rPr></w:lvl></w:abstractNum>` +
  `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`;
const numberingIndex = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}">${level(1, SIZES)}${level(2, `${SIZES}<w:rtl/>`)}` +
      `${level(3, `${SIZES}<w:cs/>`)}${level(4, '<w:b/>')}${level(5, '<w:bCs/>')}` +
      `${level(6, '<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>', 'bullet', '')}` +
      `${level(7, `${SIZES}<w:cs w:val="0"/>`)}${level(8, '<w:i/>')}${level(9, '<w:iCs/>')}</w:numbering>`
  ).root
);

const styleCascade = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Rtl"><w:name w:val="Rtl"/><w:pPr><w:bidi/></w:pPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>' +
      '<w:style w:type="table" w:styleId="Probe"><w:name w:val="Probe"/><w:basedOn w:val="TableNormal"/>' +
      '<w:rPr><w:color w:val="3366FF"/></w:rPr></w:style></w:styles>'
  ).root,
  undefined,
  part(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  ).root
);

interface Probe {
  readonly numId: number;
  readonly pPr?: string;
  readonly table?: boolean;
}

function marker({ numId, pPr = '', table = false }: Probe): ListMarkerRecord {
  const props = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>${pPr}`;
  const paragraph = `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>Item text</w:t></w:r></w:p>`;
  const body = table
    ? '<w:tbl><w:tblPr><w:tblStyle w:val="Probe"/><w:tblW w:w="5000" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
      `<w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`
    : paragraph;
  const layout = layoutSemanticDocument(
    part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    0,
    { measurer: createFixedMeasurer(6, 14), numberingIndex, styleCascade }
  );
  return [...paragraphFragmentsOf(layout.pages[0]!)].find((entry) => entry.marker)!
    .marker as ListMarkerRecord;
}

const BIDI = '<w:bidi/>';

describe('the script lane of a list marker', () => {
  test('a left-to-right paragraph sizes the marker from w:sz', () => {
    expect(marker({ numId: 1 }).style.fontSizePt).toBe(22);
  });

  test('a right-to-left paragraph sizes the marker from w:szCs', () => {
    expect(marker({ numId: 1, pPr: BIDI }).style.fontSizePt).toBe(14);
    // Inherited from the paragraph style, and inside a table cell with a table style.
    expect(marker({ numId: 1, pPr: '<w:pStyle w:val="Rtl"/>' }).style.fontSizePt).toBe(14);
    expect(marker({ numId: 1, pPr: BIDI, table: true }).style.fontSizePt).toBe(14);
    expect(marker({ numId: 1, table: true }).style.fontSizePt).toBe(22);
  });

  test('an unstated w:szCs takes the complex-script default size', () => {
    expect(marker({ numId: 4, pPr: BIDI }).style.fontSizePt).toBe(10);
  });

  test('w:rtl on the paragraph mark or the level does not change the lane', () => {
    expect(marker({ numId: 1, pPr: '<w:rPr><w:rtl/></w:rPr>' }).style.fontSizePt).toBe(22);
    expect(marker({ numId: 2 }).style.fontSizePt).toBe(22);
    expect(marker({ numId: 2, pPr: BIDI }).style.fontSizePt).toBe(14);
  });

  test('w:cs on the level selects the complex-script lane, and w:cs off does not undo w:bidi', () => {
    expect(marker({ numId: 3 }).style.fontSizePt).toBe(14);
    expect(marker({ numId: 7, pPr: BIDI }).style.fontSizePt).toBe(14);
  });

  test('a right-to-left paragraph takes w:bCs and w:iCs for the marker, not w:b and w:i', () => {
    expect(marker({ numId: 4, pPr: BIDI }).style.bold).toBe(false);
    expect(marker({ numId: 5, pPr: BIDI }).style.bold).toBe(true);
    expect(marker({ numId: 4 }).style.bold).toBe(true);
    expect(marker({ numId: 5 }).style.bold).toBe(false);
    expect(marker({ numId: 8, pPr: BIDI }).style.italic).toBe(false);
    expect(marker({ numId: 9, pPr: BIDI }).style.italic).toBe(true);
  });

  test('a symbol bullet keeps its face in a right-to-left paragraph', () => {
    expect(marker({ numId: 6, pPr: BIDI }).style.fontFamily).toBe(
      marker({ numId: 6 }).style.fontFamily
    );
  });
});

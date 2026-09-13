import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument, createFixedMeasurer } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(6, 14);
function fixture(rtl: boolean, table: boolean, suffix: string, marker = '%1.') {
  const numberingIndex = buildNumberingIndex(
    part(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${marker}"/><w:lvlJc w:val="${rtl ? 'right' : 'left'}"/><w:suff w:val="${suffix}"/><w:pPr><w:ind w:${rtl ? 'right' : 'left'}="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    ).root
  );
  const paragraph = `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>مرحبا عالم مرحبا عالم مرحبا عالم</w:t></w:r></w:p>`;
  const body = table
    ? `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
    : paragraph;
  const doc = layoutSemanticDocument(
    part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    0,
    {
      measurer,
      numberingIndex,
      geometry: { width: 200, height: 300, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
  );
  return [...paragraphFragmentsOf(doc.pages[0]!)][0]!;
}
for (const table of [false, true])
  for (const suffix of ['tab', 'space', 'nothing']) {
    test(`RTL list marker and ${suffix} suffix stay beside text (table=${table})`, () => {
      const ltr = fixture(false, table, suffix),
        rtl = fixture(true, table, suffix);
      const left = ltr.marker!,
        right = rtl.marker!;
      expect(right.text).toBe(left.text);
      expect(right.ordinal).toBe(left.ordinal);
      const leftText = Math.min(...ltr.lines[0]!.spans.map((span) => span.box.x));
      const rightText = Math.max(...rtl.lines[0]!.spans.map((span) => span.box.x + span.box.width));
      const gap = right.box.x - rightText;
      expect(gap).toBeGreaterThanOrEqual(-0.001);
      expect(gap).toBeCloseTo(leftText - left.box.x - left.box.width, 5);
      if (suffix === 'nothing') expect(gap).toBeCloseTo(0, 5);
      if (suffix === 'space') expect(gap).toBeCloseTo(measurer.measure(' ', right.style), 5);
      expect(rtl.lines.length).toBeGreaterThan(1);
    });
    test(`RTL overflowing marker retains suffix spacing (table=${table}, suffix=${suffix})`, () => {
      const ltr = fixture(false, table, suffix, '(%1.%1.%1.)'),
        rtl = fixture(true, table, suffix, '(%1.%1.%1.)');
      const a = ltr.marker!,
        b = rtl.marker!;
      const leftText = Math.min(...ltr.lines[0]!.spans.map((span) => span.box.x));
      const rightText = Math.max(...rtl.lines[0]!.spans.map((span) => span.box.x + span.box.width));
      expect(b.box.x - rightText).toBeCloseTo(leftText - a.box.x - a.box.width, 5);
      expect(b.box.x).toBeGreaterThanOrEqual(rightText - 0.001);
    });
  }

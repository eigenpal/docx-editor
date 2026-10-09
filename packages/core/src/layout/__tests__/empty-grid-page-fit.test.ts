import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const mark =
  '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="36"/></w:rPr>';
const paragraph = (text = '', properties = '') =>
  '<w:p><w:pPr>' +
  (properties.includes('<w:spacing') ? '' : '<w:spacing w:before="0" w:after="0"/>') +
  properties +
  mark +
  '</w:pPr>' +
  (text ? '<w:r>' + mark + '<w:t>' + text + '</w:t></w:r>' : '') +
  '</w:p>';
const table = (text: string) =>
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="3600"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid><w:tr><w:tc>' +
  paragraph(text) +
  '</w:tc></w:tr></w:tbl>';
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
function layout(height: number, properties = '', grid = true) {
  const document = part(
    '<w:document xmlns:w="' +
      W +
      '"><w:body>' +
      table('FIRST CONTROL') +
      paragraph('', properties).repeat(6) +
      table('SECOND CONTROL') +
      paragraph('', properties) +
      '<w:sectPr>' +
      (grid ? '<w:docGrid w:type="lines" w:linePitch="312"/>' : '') +
      '</w:sectPr></w:body></w:document>',
    '/word/document.xml'
  );
  const styles = part(
    '<w:styles xmlns:w="' +
      W +
      '"><w:docDefaults><w:rPrDefault>' +
      mark +
      '</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
    '/word/styles.xml'
  );
  const before = serializeOoxmlPart(document);
  const result = layoutSemanticDocument(document, 0, {
    geometry: {
      width: 240,
      height: height + 40,
      margin: { left: 20, right: 20, top: 20, bottom: 20 },
    },
    styleCascade: buildStyleCascadeTable(styles.root),
    measurer: {
      measure: (text) => text.length * 5,
      lineMetrics: () => ({ height: 20.699, baseline: 16.04 }),
    },
  });
  expect(serializeOoxmlPart(document)).toBe(before);
  return result;
}
for (const [height, y] of [
  [180, 31.2],
  [190, 31.2],
  [200, 31.2],
  [203, 0],
  [205, 0],
  [207, 0],
  [210, 0],
  [218.4, 0],
]) {
  test('empty grid line page edge ' + height, () => {
    const result = layout(height!);
    expect(result.pages.length).toBe(2);
    const second = result.pages[1]!.fragments.find((f) => f.kind === 'table')!;
    expect(second.box.y).toBeCloseTo(y!, 3);
    for (const page of result.pages)
      for (const fragment of page.fragments)
        if (fragment.kind === 'paragraph')
          for (const line of fragment.lines) expect(line.box.height).toBeCloseTo(31.2, 3);
  });
}
for (const properties of [
  '<w:spacing w:line="624" w:lineRule="exact"/>',
  '<w:spacing w:line="624" w:lineRule="atLeast"/>',
  '<w:snapToGrid w:val="0"/><w:spacing w:line="624" w:lineRule="exact"/>',
]) {
  test('authored line spacing retains its full fit budget ' + properties, () => {
    const result = layout(203, properties);
    const second = result.pages[1]!.fragments.find((f) => f.kind === 'table')!;
    expect(second.box.y).toBeCloseTo(31.2, 3);
  });
}

import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
} from '../style-cascade.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function cascade(defaults: string, extra = '') {
  const parsed = readOoxmlPart(`<w:styles xmlns:w="${W}">${defaults}${extra}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const table = buildStyleCascadeTable(parsed.part.root);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return table;
}

test('missing run defaults receive application kerning, explicit empty defaults suppress it', () => {
  const missingPart = buildStyleCascadeTable(null);
  expect(missingPart.docDefaultsRun).toEqual(cascade('').docDefaultsRun);
  expect(isRunKerningEnabled(resolveRunStyle(missingPart.docDefaultsRun))).toBe(true);
  for (const xml of ['', '<w:docDefaults/>', '<w:docDefaults><w:pPrDefault/></w:docDefaults>']) {
    const table = cascade(xml);
    expect(table.docDefaultsRun).toEqual([{ localName: 'kern', attributes: { val: '2' } }]);
    expect(isRunKerningEnabled(resolveRunStyle(table.docDefaultsRun))).toBe(true);
  }
  for (const xml of ['<w:rPrDefault/>', '<w:rPrDefault><w:rPr/></w:rPrDefault>']) {
    const table = cascade(`<w:docDefaults>${xml}</w:docDefaults>`);
    expect(table.docDefaultsRun).toEqual([]);
    expect(isRunKerningEnabled(resolveRunStyle(table.docDefaultsRun))).toBe(false);
    expect(table.cacheToken).not.toBe(cascade('').cacheToken);
  }
});

test('authored defaults, paragraph/character styles and direct zero retain kerning precedence', () => {
  const style =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:kern w:val="28"/></w:rPr></w:style>';
  const character =
    '<w:style w:type="character" w:styleId="NoKern"><w:rPr><w:kern w:val="0"/></w:rPr></w:style>';
  const table = cascade('', style + character);
  const inherited = cascadeParagraphFormatting(table, undefined).runProperties;
  const small = resolveRunStyle([...inherited, { localName: 'sz', attributes: { val: '22' } }]);
  expect(small.kerningMinPt).toBe(14);
  expect(isRunKerningEnabled(small)).toBe(false);
  expect(isRunKerningEnabled({ ...small, fontSizePt: 18 })).toBe(true);
  for (const direct of [
    [{ localName: 'kern', attributes: { val: '0' } }],
    [{ localName: 'rStyle', attributes: { val: 'NoKern' } }],
  ]) {
    const run = resolveRunStyle(cascadeRunProperties(inherited, direct, table));
    expect(run.kerningMinPt).toBe(0);
    expect(isRunKerningEnabled({ ...run, fontSizePt: 18 })).toBe(false);
  }
  const authored = cascade(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="40"/></w:rPr></w:rPrDefault></w:docDefaults>'
  );
  expect(resolveRunStyle(authored.docDefaultsRun).kerningMinPt).toBe(20);
});

import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const V2_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V2_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const V2_W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

function loadV2(body: string, extra = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${V2_W}" xmlns:w14="${V2_W14}" xmlns:w15="${V2_W15}"${extra}><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function applyV2(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

function firstSdtV2(part: OoxmlPart): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'sdt') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no sdt');
  return found;
}

function attributeOfV2(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamedV2(parent: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (parent.kind === 'textValue') return undefined;
  return parent.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
}

test.each([
  [
    'font omitted',
    '<w14:checkedState w14:val="2612"/><w14:uncheckedState w14:val="2610"/>',
    '2612',
    '2610',
    'MS Gothic',
    'MS Gothic',
  ],
  [
    'custom glyphs',
    '<w14:checkedState w14:val="2714"/><w14:uncheckedState w14:val="2718"/>',
    '2714',
    '2718',
    'MS Gothic',
    'MS Gothic',
  ],
  ['states omitted', '', '2612', '2610', 'MS Gothic', 'MS Gothic'],
  [
    'values omitted',
    '<w14:checkedState/><w14:uncheckedState/>',
    '2612',
    '2610',
    'MS Gothic',
    'MS Gothic',
  ],
  [
    'mixed fonts',
    '<w14:checkedState w14:val="F0FE" w14:font="Wingdings"/><w14:uncheckedState w14:val="2610"/>',
    'F0FE',
    '2610',
    'Wingdings',
    'MS Gothic',
  ],
])(
  'checkbox applies symbol defaults: %s',
  (_label, states, checkedGlyph, uncheckedGlyph, checkedFont, uncheckedFont) => {
    let part = loadV2(
      '<w:p><w:sdt><w:sdtPr><w14:checkbox>' +
        '<w14:checked w14:val="0"/>' +
        states +
        '</w14:checkbox></w:sdtPr>' +
        '<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>☐</w:t></w:r></w:sdtContent>' +
        '</w:sdt></w:p>'
    );
    for (const checked of [true, false]) {
      const control = firstSdtV2(part);
      const next = applyV2(part, {
        op: 'setContentControlValue',
        controlId: control.id,
        value: String(checked),
      });
      const xml = serializeOoxmlPart(next);
      const reopened = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
      if (!reopened.ok) throw new Error(reopened.reason);
      part = reopened.part;
      const updated = firstSdtV2(part);
      const properties = childNamedV2(updated, 'sdtPr')!;
      const checkbox = childNamedV2(properties, 'checkbox')!;
      expect(attributeOfV2(childNamedV2(checkbox, 'checked')!, 'val')).toBe(checked ? '1' : '0');
      const run = childNamedV2(childNamedV2(updated, 'sdtContent')!, 'r')!;
      const symbol = childNamedV2(run, 'sym')!;
      const font = checked ? checkedFont : uncheckedFont;
      expect(attributeOfV2(symbol, 'char')).toBe(checked ? checkedGlyph : uncheckedGlyph);
      expect(attributeOfV2(symbol, 'font')).toBe(font);
      const fonts = childNamedV2(childNamedV2(run, 'rPr')!, 'rFonts')!;
      for (const slot of ['ascii', 'hAnsi', 'eastAsia']) {
        expect(attributeOfV2(fonts, slot)).toBe(font);
      }
      expect(childNamedV2(run, 't')).toBeUndefined();
    }
  }
);

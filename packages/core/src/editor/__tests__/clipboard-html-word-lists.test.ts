// How Word's clipboard states list geometry and format, beyond the marker glyph:
// - a right-aligned number's `text-indent` is `-margin-left` for browsers, padded with nbsp,
//   while `mso-text-indent-alt` keeps the hang Word authored;
// - `@list` rules state each level's number position;
// - an all-default level gets no `@list` rule, and a `<li>` item may have no marker span.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { strFromU8 } from '../../store/package/zip.ts';

function project(html: string): { docXml: string; numberingXml: string } {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const numbering = read.package.partBytes.get('/word/numbering.xml');
  return {
    docXml: serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!),
    numberingXml: numbering ? strFromU8(numbering) : '',
  };
}

/** The `w:lvl` the paragraph holding `text` is numbered by. */
function levelOf({ docXml, numberingXml }: ReturnType<typeof project>, text: string): string {
  const paragraph = docXml.split('</w:p>').find((part) => part.includes(text)) ?? '';
  const ilvl = /<w:ilvl w:val="(\d)"\/>/.exec(paragraph)?.[1];
  const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraph)?.[1];
  const abstractId = new RegExp(
    `<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"\\/>`
  ).exec(numberingXml)?.[1];
  const abstract = new RegExp(
    `<w:abstractNum w:abstractNumId="${abstractId}">.*?</w:abstractNum>`
  ).exec(numberingXml)?.[0];
  return new RegExp(`<w:lvl w:ilvl="${ilvl}">.*?</w:lvl>`).exec(abstract ?? '')?.[0] ?? '';
}

const wordHtml = (style: string, body: string): string =>
  `<html><head><style>${style}</style></head><body>${body}</body></html>`;

test('a right-aligned Word list number keeps the hanging from mso-text-indent-alt', () => {
  const { docXml } = project(
    '<p style="margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo2">' +
      '<span style="mso-list:Ignore">a.<span>&nbsp;&nbsp;</span></span>Nested</p>' +
      '<p style="margin-left:108.0pt;text-indent:-108.0pt;mso-text-indent-alt:-18.0pt;' +
      'mso-list:l0 level3 lfo3"><span style="mso-list:Ignore">' +
      '<span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>i.' +
      '<span>&nbsp;&nbsp;</span></span>Indented</p>'
  );
  const roman = docXml.split('</w:p>').find((paragraph) => paragraph.includes('Indented'));
  expect(roman).toContain('w:left="2160"');
  expect(roman).toContain('w:hanging="360"');
  expect(roman).not.toContain('w:hanging="2160"');
  expect(docXml).not.toContain('>i.<');
  expect(docXml).not.toContain(' ');
});

test('a zero mso-text-indent-alt on a list item writes a zero first-line indent', () => {
  const { docXml } = project(
    '<p style="margin-left:36.0pt;text-indent:-36.0pt;mso-text-indent-alt:0cm;' +
      'mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">' +
      '<span>&nbsp;&nbsp;&nbsp;&nbsp;</span>1.' +
      '<span>&nbsp;</span></span>Flush</p>'
  );
  const item = docXml.split('</w:p>').find((paragraph) => paragraph.includes('Flush'));
  expect(item).toContain('w:left="720"');
  expect(item).toContain('w:firstLine="0"');
  expect(item).not.toContain('w:hanging=');
});

test('an unparseable mso-text-indent-alt falls back to text-indent', () => {
  const { docXml } = project(
    '<p style="margin-left:36.0pt;text-indent:-18.0pt;mso-text-indent-alt:auto">hang</p>'
  );
  expect(docXml).toContain('w:hanging="360"');
});

test("Word's mso-level-number-position sets each level's alignment", () => {
  const item = (ilvl: number, marker: string): string =>
    `<p style="mso-list:l0 level${ilvl} lfo1"><span style="mso-list:Ignore">${marker}</span>` +
    `item ${ilvl}</p>`;
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-number-position:right;}\n' +
        '@list l0:level2 {mso-level-number-format:roman-lower;mso-level-number-position:left;}\n' +
        '@list l0:level3 {mso-level-number-format:alpha-lower;mso-level-number-position:center;}',
      item(1, '10.') + item(2, 'i.') + item(3, 'a.')
    )
  );
  expect(levelOf(projected, 'item 1')).toContain('<w:numFmt w:val="decimal"/>');
  expect(levelOf(projected, 'item 1')).toContain('<w:lvlJc w:val="right"/>');
  expect(levelOf(projected, 'item 2')).toContain('<w:numFmt w:val="lowerRoman"/>');
  expect(levelOf(projected, 'item 2')).toContain('<w:lvlJc w:val="left"/>');
  expect(levelOf(projected, 'item 3')).toContain('<w:lvlJc w:val="center"/>');
});

test('a Word <li> with no level rule and no marker takes its list element format', () => {
  const li = (ilvl: number, text: string, nested = ''): string =>
    `<li style="mso-list:l1 level${ilvl} lfo13">${text}${nested}</li>`;
  const projected = project(
    wordHtml(
      '@list l1 {mso-list-id:1846162424;}\n@list l1:level2 {mso-level-number-format:alpha-lower;}',
      '<ol start=1 type=1>' +
        li(1, 'one', `<ol start=1 type=a>${li(2, 'nested')}</ol>`) +
        '</ol><ul>' +
        '<li style="mso-list:l2 level1 lfo14">bullet</li></ul>'
    )
  );
  expect(levelOf(projected, 'one')).toContain('<w:numFmt w:val="decimal"/>');
  expect(levelOf(projected, 'nested')).toContain('<w:numFmt w:val="lowerLetter"/>');
  expect(levelOf(projected, 'bullet')).toContain('<w:numFmt w:val="bullet"/>');
});

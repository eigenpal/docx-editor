// Each expectation names the anonymous probe in local/evidence/hansi-font-slots that measured
// it against reference output.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { collectThemeSchemeFaces } from '../../store/package/theme-font-scheme.ts';
import { fontTableChineseFaces, isChineseFace } from '../../store/package/default-font-faces.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { OoxmlProperty } from '../../store/store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function root(xml: string, name: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root;
}
const settings = (language: string) =>
  root(
    `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="${language}"/></w:settings>`,
    '/word/settings.xml'
  );
const emptyTheme = root(
  `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="T">` +
    '<a:majorFont><a:latin typeface="Major"/><a:ea typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Minor"/><a:ea typeface=""/></a:minorFont>' +
    '</a:fontScheme></a:themeElements></a:theme>',
  '/word/theme/theme1.xml'
);
const fontTable = (entries: string) =>
  root(`<w:fonts xmlns:w="${W}">${entries}</w:fonts>`, '/word/fontTable.xml');

describe('empty East Asian theme slots', () => {
  test.each([
    // [theme language, minor, major]: probes e01/m01, p-minor-*, p-major-*.
    [undefined, 'SimSun', 'SimHei'],
    ['zh-CN', 'SimSun', 'SimHei'],
    ['zh-TW', 'PMingLiU', 'MingLiU'],
    ['ja-JP', 'MS Mincho', 'MS Gothic'],
    ['ko-KR', 'Batang', 'Dotum'],
  ])('a theme part with language %s', (language, minor, major) => {
    const fonts = collectThemeSchemeFaces(emptyTheme, language ? settings(language) : null);
    expect([fonts.minorEastAsia, fonts.majorEastAsia]).toEqual([minor, major]);
  });

  test.each([
    // [theme language, minor, major]: probes x02/m06, z08/p-major-notheme-*, m04, m05.
    [undefined, 'DengXian', 'DengXian Light'],
    ['ja-JP', 'Yu Mincho', 'Yu Gothic Light'],
    ['zh-TW', 'PMingLiU', 'PMingLiU'],
    ['ko-KR', 'Malgun Gothic', 'Malgun Gothic'],
  ])('no theme part with language %s uses the built-in theme', (language, minor, major) => {
    const fonts = collectThemeSchemeFaces(null, language ? settings(language) : null);
    expect([fonts.minorEastAsia, fonts.majorEastAsia]).toEqual([minor, major]);
  });

  test('the run language selects no theme face (probes e03, x07, z02, m03)', () => {
    const run = (language: string): OoxmlProperty[] => [
      { localName: 'rFonts', attributes: { eastAsiaTheme: 'majorEastAsia' } },
      { localName: 'lang', attributes: { eastAsia: language } },
    ];
    const builtIn = collectThemeSchemeFaces(null);
    expect(resolveRunStyle(run('ja-JP'), builtIn).fontFamilyEastAsia).toBe('DengXian Light');
    const themed = collectThemeSchemeFaces(emptyTheme);
    expect(resolveRunStyle(run('ko-KR'), themed).fontFamilyEastAsia).toBe('SimHei');
  });
});

describe('Chinese fonts for the East Asian hint', () => {
  test.each([
    // Installed faces answer by their own character set (c04, c05, c08, c09, c10, c15-c17).
    ['STKaiti', [], true],
    ['华文楷体', [], true],
    ['KaiTi', [], true],
    ['Songti SC', [], true],
    ['Meiryo', [], false],
    ['Meiryo', ['meiryo'], false],
    ['Verdana', ['verdana'], false],
    ['SimSun', [], true],
    // Other faces answer by the font table charset (c01-c03, c11-c14, c18).
    ['Noto Sans SC', [], false],
    ['Noto Sans SC', ['noto sans sc'], true],
    ['Unknown Face', [], false],
    // Spaces do not count; a vertical-writing name is not Chinese (c06, c07).
    [' SimSun ', [], true],
    ['@SimSun', [], false],
  ] as const)('%s with table %j is Chinese: %s', (face, table, chinese) => {
    expect(isChineseFace(face, table)).toBe(chinese);
  });

  test('the font table names GB2312 and Big5 faces only', () => {
    const table = fontTable(
      '<w:font w:name="Gb Face"><w:charset w:val="86"/></w:font>' +
        '<w:font w:name="Big5 Face "><w:charset w:val="88"/></w:font>' +
        '<w:font w:name="Jis Face"><w:charset w:val="80"/></w:font>' +
        '<w:font w:name="Panose Face"><w:panose1 w:val="02010600030101010101"/></w:font>'
    );
    expect(fontTableChineseFaces(table)).toEqual(['gb face', 'big5 face']);
  });

  test('a font table charset makes an unavailable face Chinese for the hint (probe c02)', () => {
    const fonts = collectThemeSchemeFaces(
      emptyTheme,
      null,
      fontTable('<w:font w:name="Noto Sans SC"><w:charset w:val="86"/></w:font>')
    );
    const props: OoxmlProperty[] = [
      {
        localName: 'rFonts',
        attributes: {
          ascii: 'Georgia',
          hAnsi: 'Tahoma',
          eastAsia: 'Noto Sans SC',
          hint: 'eastAsia',
        },
      },
      { localName: 'lang', attributes: { eastAsia: 'ja-JP' } },
    ];
    const eastAsian = (themeFonts: typeof fonts) => {
      const piece: FieldAwarePiece = {
        text: 'aąa',
        props,
        start: 0,
        end: 3,
        style: resolveRunStyle(props, themeFonts),
      };
      return applyEastAsiaFontSlots([piece], themeFonts)
        .filter((p) => p.fontSlot === 'eastAsia')
        .map((p) => p.text)
        .join('');
    };
    expect(eastAsian(fonts)).toBe('ą');
    expect(eastAsian(collectThemeSchemeFaces(emptyTheme))).toBe('');
  });

  test('an opened package carries its font table charsets into layout', () => {
    const files = {
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>',
      'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`,
      'word/fontTable.xml': `<w:fonts xmlns:w="${W}"><w:font w:name="Noto Sans SC"><w:charset w:val="86"/></w:font></w:fonts>`,
    };
    const opened = openHeadlessDocument(
      zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
    );
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.view.documentThemeFonts().chineseFontTableFaces).toEqual(['noto sans sc']);
  });
});

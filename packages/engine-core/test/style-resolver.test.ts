// Style resolution (section 6): effective run formatting is composed from docDefaults ->
// paragraph style (basedOn chain) -> character style -> direct run rPr, WITHOUT ever
// mutating authored state. Driven through real parseDocx so the whole path (styles.xml +
// docDefaults parse -> resolver) is exercised. Untrusted basedOn chains fail closed.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx, bodyStoryId, createStyleResolver } from '../src/index.ts';
import type { ParagraphRecord } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const THEME_COLORS =
  '<a:clrScheme name="Test Colors">' +
  ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
    .map((name, index) => `<a:${name}><a:srgbClr val="${index.toString(16).padStart(6, '0')}"/></a:${name}>`)
    .join('') +
  '</a:clrScheme>';
const THEME_FORMAT =
  '<a:fmtScheme name="Test Format">' +
  '<a:fillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:bgFillStyleLst>' +
  '</a:fmtScheme>';

function docx(stylesInner: string, bodyInner: string, themeInner = ''): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${stylesInner}</w:styles>`),
  };
  if (themeInner) {
    files['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
        '</Relationships>'
    );
    files['word/theme/theme1.xml'] = strToU8(
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        `<a:themeElements>${THEME_COLORS}${themeInner}${THEME_FORMAT}</a:themeElements></a:theme>`
    );
  }
  return zipSync(files);
}
function parse(stylesInner: string, bodyInner: string, themeInner = '') {
  const r = parseDocx(docx(stylesInner, bodyInner, themeInner));
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}
function firstPara(model: ReturnType<typeof parse>) {
  return model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord;
}

describe('style resolver — inheritance without materialization', () => {
  test('a run inherits bold from its paragraph style (run authors nothing)', () => {
    const model = parse(
      '<w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="Strong"/></w:pPr><w:r><w:t>hi</w:t></w:r></w:p>',
    );
    const para = firstPara(model);
    const run = para.runs[0];
    // Authored state is untouched: the run did NOT author bold.
    expect(run.props?.bold).toBeUndefined();
    // Resolution applies the style.
    expect(createStyleResolver(model).runProps(para, run).bold).toBe(true);
  });

  test('basedOn chain: docDefaults -> base -> derived, derived overrides', () => {
    const model = parse(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:b/><w:i/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Derived"><w:name w:val="Derived"/><w:basedOn w:val="Base"/>' +
        '<w:rPr><w:i w:val="0"/></w:rPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="Derived"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    );
    const para = firstPara(model);
    const eff = createStyleResolver(model).runProps(para, para.runs[0]);
    expect(eff.bold).toBe(true); // inherited from Base
    expect(eff.italic).toBe(false); // Derived turns Base's italic OFF (explicit w:val="0")
  });

  test('direct run formatting overrides paragraph and character style inheritance', () => {
    const model = parse(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Default ASCII" w:hAnsi="Default ANSI"/><w:sz w:val="18"/><w:color w:val="101010"/><w:b/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="ParagraphBase"><w:name w:val="Paragraph Base"/><w:rPr><w:rFonts w:ascii="Paragraph ASCII"/><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="ParagraphLeaf"><w:name w:val="Paragraph Leaf"/><w:basedOn w:val="ParagraphBase"/><w:rPr><w:color w:val="202020"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="CharacterBase"><w:name w:val="Character Base"/><w:rPr><w:rFonts w:hAnsi="Character ANSI"/><w:sz w:val="22"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="CharacterLeaf"><w:name w:val="Character Leaf"/><w:basedOn w:val="CharacterBase"/><w:rPr><w:color w:val="303030"/></w:rPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="ParagraphLeaf"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CharacterLeaf"/><w:rFonts w:ascii="Direct ASCII"/><w:sz w:val="26"/><w:color w:val="404040"/><w:b w:val="false"/></w:rPr><w:t>x</w:t></w:r></w:p>',
    );
    const para = firstPara(model);
    const eff = createStyleResolver(model).runProps(para, para.runs[0]);
    expect(eff).toEqual({
      fonts: { ascii: 'Direct ASCII', hAnsi: 'Character ANSI' },
      sizeHalfPoints: 26,
      color: '404040',
      bold: false,
    });
  });

  test('explicit false overrides inherited true while omission continues to inherit', () => {
    const model = parse(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:b/><w:i/></w:rPr></w:rPrDefault></w:docDefaults>',
      '<w:p>' +
        '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>off</w:t></w:r>' +
        '<w:r><w:rPr><w:i w:val="false"/></w:rPr><w:t>partial</w:t></w:r>' +
        '<w:r><w:t>inherit</w:t></w:r>' +
        '</w:p>',
    );
    const para = firstPara(model);
    const resolver = createStyleResolver(model);
    expect(para.runs[0].props).toEqual({ bold: false });
    expect(resolver.runProps(para, para.runs[0])).toMatchObject({ bold: false, italic: true });
    expect(para.runs[1].props).toEqual({ italic: false });
    expect(resolver.runProps(para, para.runs[1])).toMatchObject({ bold: true, italic: false });
    expect(para.runs[2].props).toBeUndefined();
    expect(resolver.runProps(para, para.runs[2])).toMatchObject({ bold: true, italic: true });
  });

  test('theme references resolve to major and minor script families', () => {
    const theme =
      '<a:fontScheme name="Theme Fonts">' +
      '<a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="Major East"/><a:cs typeface="Major Complex"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="Minor East"/><a:cs typeface="Minor Complex"/></a:minorFont>' +
      '</a:fontScheme>';
    const model = parse(
      '',
      '<w:p>' +
        '<w:r><w:rPr><w:rFonts w:asciiTheme="majorAscii"/></w:rPr><w:t>a</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:asciiTheme="minorAscii"/></w:rPr><w:t>b</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:hAnsiTheme="majorHAnsi"/></w:rPr><w:t>c</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:hAnsiTheme="minorHAnsi"/></w:rPr><w:t>d</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:eastAsiaTheme="majorEastAsia"/></w:rPr><w:t>e</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia"/></w:rPr><w:t>f</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:cstheme="majorBidi"/></w:rPr><w:t>g</w:t></w:r>' +
        '<w:r><w:rPr><w:rFonts w:cstheme="minorBidi"/></w:rPr><w:t>h</w:t></w:r>' +
        '</w:p>',
      theme,
    );
    const para = firstPara(model);
    const resolver = createStyleResolver(model);
    expect(para.runs.map((run) => resolver.runProps(para, run).fonts)).toEqual([
      { asciiTheme: 'majorAscii', ascii: 'Major Latin' },
      { asciiTheme: 'minorAscii', ascii: 'Minor Latin' },
      { hAnsiTheme: 'majorHAnsi', hAnsi: 'Major Latin' },
      { hAnsiTheme: 'minorHAnsi', hAnsi: 'Minor Latin' },
      { eastAsiaTheme: 'majorEastAsia', eastAsia: 'Major East' },
      { eastAsiaTheme: 'minorEastAsia', eastAsia: 'Minor East' },
      { csTheme: 'majorBidi', cs: 'Major Complex' },
      { csTheme: 'minorBidi', cs: 'Minor Complex' },
    ]);
  });

  test('an explicit family wins over a theme reference for the same script slot', () => {
    const theme =
      '<a:fontScheme name="Theme Fonts"><a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>';
    const model = parse(
      '<w:style w:type="paragraph" w:styleId="ThemeStyle"><w:name w:val="Theme Style"/><w:rPr><w:rFonts w:asciiTheme="majorAscii"/></w:rPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="ThemeStyle"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Explicit Face"/></w:rPr><w:t>x</w:t></w:r></w:p>',
      theme,
    );
    const para = firstPara(model);
    expect(createStyleResolver(model).runProps(para, para.runs[0]).fonts).toEqual({
      ascii: 'Explicit Face',
    });
  });

  test('a same-element theme attribute overrides its concrete font attribute', () => {
    const theme =
      '<a:fontScheme name="Theme Fonts"><a:majorFont><a:latin typeface="Theme Latin"/><a:ea typeface="Theme East"/><a:cs typeface="Theme Complex"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="Minor East"/><a:cs typeface="Minor Complex"/></a:minorFont></a:fontScheme>';
    const model = parse(
      '',
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Concrete Latin" w:asciiTheme="majorAscii" w:cs="Concrete Complex" w:cstheme="majorBidi"/></w:rPr><w:t>x</w:t></w:r></w:p>',
      theme
    );
    const para = firstPara(model);
    expect(createStyleResolver(model).runProps(para, para.runs[0]).fonts).toEqual({
      ascii: 'Theme Latin',
      asciiTheme: 'majorAscii',
      cs: 'Theme Complex',
      csTheme: 'majorBidi',
    });
  });

  test('a self-referential basedOn cycle fails closed (no infinite loop)', () => {
    const model = parse(
      '<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/><w:rPr><w:b/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/><w:rPr><w:i/></w:rPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    );
    const para = firstPara(model);
    const eff = createStyleResolver(model).runProps(para, para.runs[0]);
    // Both A and B are visited once, then the cycle stops.
    expect(eff.bold).toBe(true);
    expect(eff.italic).toBe(true);
  });

  test('an unknown pStyle resolves to just docDefaults (fail-open, no throw)', () => {
    const model = parse(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>',
      '<w:p><w:pPr><w:pStyle w:val="DoesNotExist"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    );
    const para = firstPara(model);
    expect(createStyleResolver(model).runProps(para, para.runs[0]).bold).toBe(true);
  });

  test('no styles / no docDefaults: resolution returns the run\'s own formatting only', () => {
    const model = parse('', '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>');
    const para = firstPara(model);
    expect(createStyleResolver(model).runProps(para, para.runs[0]).bold).toBe(true);
  });
});

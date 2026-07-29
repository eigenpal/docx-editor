// Styles + numbering parsing (document-engine task 2.7 partial).

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { bodyStoryId, parseDocx, type ParagraphRecord } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function validThemeXml(fontScheme: string, prefix = 'a', namespace = DRAWING): string {
  const p = `${prefix}:`;
  const color = (name: string, value: string) =>
    `<${p}${name}><${p}srgbClr val="${value}"/></${p}${name}>`;
  const colors =
    `<${p}clrScheme name="Test Colors">` +
    color('dk1', '000000') +
    color('lt1', 'FFFFFF') +
    color('dk2', '111111') +
    color('lt2', 'EEEEEE') +
    color('accent1', '111111') +
    color('accent2', '222222') +
    color('accent3', '333333') +
    color('accent4', '444444') +
    color('accent5', '555555') +
    color('accent6', '666666') +
    color('hlink', '0000FF') +
    color('folHlink', '800080') +
    `</${p}clrScheme>`;
  const effect = `<${p}effectStyle><${p}effectLst/></${p}effectStyle>`;
  const format =
    `<${p}fmtScheme name="Test Format">` +
    `<${p}fillStyleLst><${p}solidFill/><${p}solidFill/><${p}solidFill/></${p}fillStyleLst>` +
    `<${p}lnStyleLst><${p}ln/><${p}ln/><${p}ln/></${p}lnStyleLst>` +
    `<${p}effectStyleLst>${effect}${effect}${effect}</${p}effectStyleLst>` +
    `<${p}bgFillStyleLst><${p}solidFill/><${p}solidFill/><${p}solidFill/></${p}bgFillStyleLst>` +
    `</${p}fmtScheme>`;
  return `<${p}theme xmlns:${prefix}="${namespace}"><${p}themeElements>${colors}${fontScheme}${format}</${p}themeElements></${p}theme>`;
}

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
        `<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>` +
        `</w:styles>`,
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
        `</w:numbering>`,
    ),
  });
}

function formattingDocx(documentInner: string, stylesInner = '', themeInner = ''): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${documentInner}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${stylesInner}</w:styles>`),
  };
  if (themeInner) {
    files['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
        '</Relationships>'
    );
    files['word/theme/theme1.xml'] = strToU8(validThemeXml(themeInner));
  }
  return zipSync(files);
}

function themeDocx(relationshipsXml: string, themeXml?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(relationshipsXml),
  };
  if (themeXml !== undefined) files['word/theme/theme1.xml'] = strToU8(themeXml);
  return zipSync(files, { level: 0 });
}

function stylesPartDocx(stylesXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
    ),
    'word/styles.xml': strToU8(stylesXml),
  });
}

describe('styles', () => {
  test('parses styleId, name, type, and default flag', () => {
    const r = parseDocx(docx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.model.styles.map((s) => [s.id, s]));
    expect(byId.get('Normal')).toMatchObject({ name: 'Normal', type: 'paragraph', isDefault: true });
    expect(byId.get('Heading1')).toMatchObject({ name: 'heading 1', type: 'paragraph' });
    expect(byId.get('Strong')).toMatchObject({ type: 'character' });
  });

  test('parses every authored rFonts attribute plus size and color on direct runs', () => {
    const bytes = formattingDocx(
      '<w:p><w:r><w:rPr>' +
        '<w:rFonts w:ascii="Ascii Face" w:hAnsi="High ANSI Face" w:eastAsia="East Asia Face" w:cs="Complex Face" ' +
        'w:asciiTheme="majorAscii" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="majorEastAsia" w:cstheme="minorBidi"/>' +
        '<w:sz w:val="27"/><w:color w:val="A1B2C3"/>' +
        '</w:rPr><w:t>x</w:t></w:r></w:p>'
    );
    const result = parseDocx(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraph = result.model.stories.get(bodyStoryId(result.model))!
      .blocks[0] as ParagraphRecord;
    expect(paragraph.runs[0].props).toEqual({
      fonts: {
        ascii: 'Ascii Face',
        hAnsi: 'High ANSI Face',
        eastAsia: 'East Asia Face',
        cs: 'Complex Face',
        asciiTheme: 'majorAscii',
        hAnsiTheme: 'minorHAnsi',
        eastAsiaTheme: 'majorEastAsia',
        csTheme: 'minorBidi',
      },
      sizeHalfPoints: 27,
      color: 'A1B2C3',
    });
  });

  test('accepts only bounded decimal w:sz lexical values', () => {
    const result = parseDocx(
      formattingDocx(
        '<w:p>' +
          '<w:r><w:rPr><w:sz w:val="0030"/></w:rPr><w:t>a</w:t></w:r>' +
          '<w:r><w:rPr><w:sz w:val="3276"/></w:rPr><w:t>b</w:t></w:r>' +
          '<w:r><w:rPr><w:sz w:val="1e2"/></w:rPr><w:t>c</w:t></w:r>' +
          '<w:r><w:rPr><w:sz w:val="0x20"/></w:rPr><w:t>d</w:t></w:r>' +
          '<w:r><w:rPr><w:sz w:val="-2"/></w:rPr><w:t>e</w:t></w:r>' +
          '<w:r><w:rPr><w:sz w:val="3277"/></w:rPr><w:t>f</w:t></w:r>' +
          '</w:p>'
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraph = result.model.stories.get(bodyStoryId(result.model))!
      .blocks[0] as ParagraphRecord;
    expect(paragraph.runs.map((run) => run.props?.sizeHalfPoints)).toEqual([
      30,
      3276,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('parses formatting in docDefaults and paragraph and character styles', () => {
    const styles =
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorAscii"/><w:sz w:val="21"/><w:color w:val="112233"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:rFonts w:hAnsi="Base ANSI"/><w:sz w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Derived"><w:name w:val="Derived"/><w:basedOn w:val="Base"/><w:rPr><w:color w:val="445566"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CharBase"><w:name w:val="Char Base"/><w:rPr><w:rFonts w:cstheme="majorBidi"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CharDerived"><w:name w:val="Char Derived"/><w:basedOn w:val="CharBase"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style>';
    const result = parseDocx(formattingDocx('<w:p/>', styles));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.docDefaults?.runProps).toEqual({
      fonts: { asciiTheme: 'minorAscii' },
      sizeHalfPoints: 21,
      color: '112233',
    });
    expect(result.model.styles.find((style) => style.id === 'Base')?.runProps).toEqual({
      fonts: { hAnsi: 'Base ANSI' },
      sizeHalfPoints: 24,
    });
    expect(result.model.styles.find((style) => style.id === 'Derived')).toMatchObject({
      basedOn: 'Base',
      runProps: { color: '445566' },
    });
    expect(result.model.styles.find((style) => style.id === 'CharDerived')).toMatchObject({
      basedOn: 'CharBase',
      runProps: { sizeHalfPoints: 30 },
    });
  });

  test('styles and docDefaults parse by namespace URI with an alternate prefix', () => {
    const strictW = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
    const result = parseDocx(
      stylesPartDocx(
        `<s:styles xmlns:s="${strictW}">` +
          '<s:docDefaults><s:rPrDefault><s:rPr><s:rFonts s:ascii="Default Face"/><s:sz s:val="22"/></s:rPr></s:rPrDefault></s:docDefaults>' +
          '<s:style s:type="paragraph" s:styleId="Alt"><s:name s:val="Alternate"/><s:rPr><s:color s:val="ABCDEF"/></s:rPr></s:style>' +
          '</s:styles>'
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.docDefaults?.runProps).toMatchObject({
      fonts: { ascii: 'Default Face' },
      sizeHalfPoints: 22,
    });
    expect(result.model.styles.find((style) => style.id === 'Alt')?.runProps).toEqual({
      color: 'ABCDEF',
    });
  });

  test('styles elements parse from the default WML namespace', () => {
    const result = parseDocx(
      stylesPartDocx(
        `<styles xmlns="${W}" xmlns:w="${W}">` +
          '<docDefaults><rPrDefault><rPr><rFonts w:ascii="Default Namespace"/></rPr></rPrDefault></docDefaults>' +
          '<style w:type="character" w:styleId="DefaultNs"><name w:val="Default NS"/><rPr><color w:val="123ABC"/></rPr></style>' +
          '</styles>'
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.docDefaults?.runProps?.fonts?.ascii).toBe('Default Namespace');
    expect(result.model.styles.find((style) => style.id === 'DefaultNs')?.runProps?.color).toBe(
      '123ABC'
    );
  });

  test('malformed styles XML fails closed instead of dropping formatting', () => {
    expect(parseDocx(stylesPartDocx(`<w:styles xmlns:w="${W}"><w:style`))).toMatchObject({
      ok: false,
      reason: 'xml-error',
    });
  });

  test('parses major and minor theme font families', () => {
    const fontScheme =
      '<a:fontScheme name="Theme Fonts">' +
      '<a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="Major East"/><a:cs typeface="Major Complex"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="Minor East"/><a:cs typeface="Minor Complex"/></a:minorFont>' +
      '</a:fontScheme>';
    const result = parseDocx(formattingDocx('<w:p/>', '', fontScheme));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.themeFonts).toEqual({
      majorLatin: 'Major Latin',
      minorLatin: 'Minor Latin',
      majorEastAsia: 'Major East',
      minorEastAsia: 'Minor East',
      majorComplexScript: 'Major Complex',
      minorComplexScript: 'Minor Complex',
    });
  });

  test('theme parsing is namespace-URI aware rather than prefix-specific', () => {
    const rels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>';
    const theme = validThemeXml(
      '<d:fontScheme xmlns:f="http://schemas.openxmlformats.org/drawingml/2006/main" name="Alternate Prefix"><f:majorFont><f:latin typeface="Major"/><f:ea typeface=""/><f:cs typeface=""/></f:majorFont>' +
        '<f:minorFont><f:latin typeface="Minor"/><f:ea typeface=""/><f:cs typeface=""/></f:minorFont></d:fontScheme>',
      'd'
    );
    const result = parseDocx(themeDocx(rels, theme));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.themeFonts).toMatchObject({ majorLatin: 'Major', minorLatin: 'Minor' });
  });

  test('accepts the strict theme relationship URI and ignores lookalike suffixes', () => {
    const strictRels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/theme" Target="theme/theme1.xml"/></Relationships>';
    const theme = validThemeXml(
      '<a:fontScheme name="Strict"><a:majorFont><a:latin typeface="Strict Major"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Strict Minor"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    );
    const strict = parseDocx(themeDocx(strictRels, theme));
    expect(strict.ok).toBe(true);
    if (strict.ok) expect(strict.model.themeFonts?.majorLatin).toBe('Strict Major');

    const lookalike = parseDocx(
      themeDocx(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="urn:attacker/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
        theme
      )
    );
    expect(lookalike.ok).toBe(true);
    if (lookalike.ok) expect(lookalike.model.themeFonts).toBeUndefined();
  });

  test('parses strict DrawingML themes by namespace URI', () => {
    const strictDrawing = 'http://purl.oclc.org/ooxml/drawingml/main';
    const rels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/theme" Target="theme/theme1.xml"/></Relationships>';
    const theme =
      `<theme xmlns="${strictDrawing}"><themeElements><clrScheme name="Strict Colors">` +
      '<dk1><srgbClr val="000000"/></dk1><lt1><srgbClr val="FFFFFF"/></lt1><dk2><srgbClr val="111111"/></dk2><lt2><srgbClr val="EEEEEE"/></lt2>' +
      '<accent1><srgbClr val="111111"/></accent1><accent2><srgbClr val="222222"/></accent2><accent3><srgbClr val="333333"/></accent3><accent4><srgbClr val="444444"/></accent4><accent5><srgbClr val="555555"/></accent5><accent6><srgbClr val="666666"/></accent6><hlink><srgbClr val="0000FF"/></hlink><folHlink><srgbClr val="800080"/></folHlink></clrScheme>' +
      '<fontScheme name="Strict Fonts"><majorFont><latin typeface="Strict Major"/><ea typeface="Strict EA"/><cs typeface="Strict CS"/></majorFont><minorFont><latin typeface="Strict Minor"/><ea typeface="Strict Minor EA"/><cs typeface="Strict Minor CS"/></minorFont></fontScheme>' +
      '<fmtScheme name="Strict Format"><fillStyleLst><solidFill/><solidFill/><solidFill/></fillStyleLst><lnStyleLst><ln/><ln/><ln/></lnStyleLst><effectStyleLst><effectStyle><effectLst/></effectStyle><effectStyle><effectLst/></effectStyle><effectStyle><effectLst/></effectStyle></effectStyleLst><bgFillStyleLst><solidFill/><solidFill/><solidFill/></bgFillStyleLst></fmtScheme>' +
      '</themeElements></theme>';
    const result = parseDocx(themeDocx(rels, theme));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.model.themeFonts).toMatchObject({
        majorLatin: 'Strict Major',
        minorLatin: 'Strict Minor',
        majorEastAsia: 'Strict EA',
        majorComplexScript: 'Strict CS',
      });
  });

  test.each([
    {
      name: 'malformed relationships XML',
      rels: '<Relationships><Relationship',
      theme: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    },
    {
      name: 'duplicate theme relationships',
      rels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="one" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
        '<Relationship Id="two" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme2.xml"/></Relationships>',
      theme: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    },
    {
      name: 'invalid internal theme target',
      rels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../bad/../../escape.xml"/></Relationships>',
      theme: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    },
    {
      name: 'missing internal theme part',
      rels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
      theme: undefined,
    },
    {
      name: 'malformed theme XML',
      rels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
      theme: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fontScheme>',
    },
    {
      name: 'duplicate font schemes',
      rels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
      theme:
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fontScheme/><a:fontScheme/></a:theme>',
    },
  ])('fails closed for $name', ({ rels, theme }) => {
    expect(parseDocx(themeDocx(rels, theme))).toMatchObject({ ok: false, reason: 'xml-error' });
  });

  test('theme parsing enforces byte and element ceilings', () => {
    const rels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>';
    const oversized =
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      'x'.repeat(1024 * 1024) +
      '</a:theme>';
    expect(parseDocx(themeDocx(rels, oversized))).toMatchObject({
      ok: false,
      reason: 'xml-error',
    });
    const tooManyElements =
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:fontScheme><a:majorFont><a:latin typeface="Major"/></a:majorFont><a:minorFont><a:latin typeface="Minor"/></a:minorFont>' +
      '<x/>'.repeat(10_001) +
      '</a:fontScheme></a:theme>';
    expect(parseDocx(themeDocx(rels, tooManyElements))).toMatchObject({
      ok: false,
      reason: 'xml-error',
    });
  });
});

describe('numbering', () => {
  test('parses numId -> abstractNumId', () => {
    const r = parseDocx(docx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.numbering).toEqual([
      { numId: '1', abstractId: '0' },
      { numId: '2', abstractId: '1' },
    ]);
  });
});

describe('real fixture', () => {
  const fixture = join(import.meta.dir, '..', '..', '..', '..', '..', 'e2e', 'fixtures', 'comprehensive-word-element-test.docx');
  test.if(existsSync(fixture))('a rich fixture yields multiple styles', () => {
    const r = parseDocx(new Uint8Array(readFileSync(fixture)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model.styles.length).toBeGreaterThan(1);
  });
});

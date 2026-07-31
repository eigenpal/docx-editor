import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const FIDELITY_DOCUMENT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:r><w:t>AV</w:t></w:r>' +
  '<w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/><w:b/><w:sz w:val="28"/><w:color w:val="C00000"/></w:rPr><w:t>BoldAV</w:t></w:r>' +
  '<w:r><w:rPr><w:i/><w:sz w:val="22"/><w:color w:val="0066CC"/></w:rPr><w:t>Italic</w:t></w:r>' +
  '<w:r><w:rPr><w:rFonts w:ascii="Declared Missing" w:hAnsi="Declared Missing"/></w:rPr><w:t>DirectFace</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="DerivedParagraph"/></w:pPr><w:r><w:rPr><w:rStyle w:val="DerivedCharacter"/></w:rPr><w:t>InheritedCharacter</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="MajorHeading"/></w:pPr><w:r><w:t>Major heading</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="MinorHeading"/></w:pPr><w:r><w:t>Minor heading</w:t></w:r></w:p>' +
  '<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/></w:rPr><w:t>سلام</w:t></w:r></w:p>' +
  Array.from(
    { length: 48 },
    (_, index) =>
      `<w:p><w:r><w:t>Wrapping line ${String(index + 1).padStart(2, '0')} with AV office glyph clusters and fixed vertical metrics.</w:t></w:r></w:p>`
  ).join('') +
  '<w:sectPr><w:pgSz w:w="6120" w:h="3960"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/></w:sectPr>' +
  '</w:body></w:document>';

export const FIDELITY_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/><w:sz w:val="24"/><w:color w:val="202020"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="BaseParagraph"><w:name w:val="Base Paragraph"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="DerivedParagraph"><w:name w:val="Derived Paragraph"/><w:basedOn w:val="BaseParagraph"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="BaseCharacter"><w:name w:val="Base Character"/><w:rPr><w:i/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="DerivedCharacter"><w:name w:val="Derived Character"/><w:basedOn w:val="BaseCharacter"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="MajorHeading"><w:name w:val="Major Heading"/><w:rPr><w:rFonts w:asciiTheme="majorAscii" w:hAnsiTheme="majorHAnsi"/><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="MinorHeading"><w:name w:val="Minor Heading"/><w:rPr><w:rFonts w:asciiTheme="minorAscii" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="32"/></w:rPr></w:style>' +
  '</w:styles>';

export const FIDELITY_THEME_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${A}" name="Fidelity Theme"><a:themeElements>` +
  '<a:clrScheme name="Fidelity Colors"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="202020"/></a:dk2><a:lt2><a:srgbClr val="F0F0F0"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Fidelity Fonts"><a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Fidelity Format"><a:fillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:bgFillStyleLst></a:fmtScheme>' +
  '</a:themeElements></a:theme>';

export function createHarfBuzzTextFidelityDocx(): Uint8Array {
  const files = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(FIDELITY_DOCUMENT_XML),
    'word/styles.xml': strToU8(FIDELITY_STYLES_XML),
    'word/theme/theme1.xml': strToU8(FIDELITY_THEME_XML),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdTheme" Type="${R}/theme" Target="theme/theme1.xml"/></Relationships>`
    ),
  };
  const mtime = new Date(1980, 0, 1, 0, 0, 0, 0);
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime }]])),
    { level: 0 }
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(
    fileURLToPath(new URL('./harfbuzz-text-fidelity.docx', import.meta.url)),
    createHarfBuzzTextFidelityDocx()
  );
}

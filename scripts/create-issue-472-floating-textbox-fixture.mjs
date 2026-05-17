/**
 * Create a synthetic DOCX fixture for issue #472.
 *
 * The generated document reproduces the relevant OOXML structure from the
 * private repro: a WPS text box in a wp:anchor with square both-sides wrapping.
 * All text and package metadata are synthetic.
 *
 * Run: bun scripts/create-issue-472-floating-textbox-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/issue-472-floating-textbox.docx');
const FIXTURE_DATE = new Date('2026-01-01T00:00:00Z');

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Issue 472 Synthetic Floating Textbox</dc:title>
  <dc:creator>docx-editor fixture generator</dc:creator>
  <cp:lastModifiedBy>docx-editor fixture generator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>docx-editor fixture generator</Application>
</Properties>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="360"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="2F75B5"/><w:sz w:val="44"/></w:rPr>
  </w:style>
</w:styles>`;

function paragraph(text, opts = {}) {
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '';
  const spacing =
    opts.spacing ?? '<w:spacing w:before="0" w:after="180" w:line="276" w:lineRule="auto"/>';
  const jc = opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '';
  const color = opts.color ? `<w:color w:val="${opts.color}"/>` : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/>` : '<w:sz w:val="36"/>';
  return `<w:p>
    <w:pPr>${style}${spacing}${jc}<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${color}${size}</w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${color}${size}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

const TEXT_BOX_ANCHOR = `<w:drawing>
  <wp:anchor distT="0" distB="0" distL="114300" distR="114300"
    simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0"
    layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="margin"><wp:posOffset>2076450</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="page"><wp:posOffset>2279650</wp:posOffset></wp:positionV>
    <wp:extent cx="1263650" cy="482600"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapSquare wrapText="bothSides"/>
    <wp:docPr id="472" name="Synthetic anchored text box"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
          <wps:cNvSpPr txBox="1"/>
          <wps:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="1263650" cy="482600"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
            <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln>
          </wps:spPr>
          <wps:txbx>
            <w:txbxContent>
              <w:p>
                <w:pPr><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="36"/></w:rPr></w:pPr>
                <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="36"/></w:rPr><w:t>Text Box</w:t></w:r>
              </w:p>
            </w:txbxContent>
          </wps:txbx>
          <wps:bodyPr lIns="38576" tIns="19288" rIns="38576" bIns="19288" anchorCtr="0"/>
        </wps:wsp>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>`;

const INTRO_TEXT =
  'Northwind Sample Works is a fictional manufacturing company used for layout testing. The company builds small metal and composite demo products for North American, European, and Asian commercial markets. While its base operation is located in a synthetic city with 290 employees, several regional sales teams are located throughout the sample market base.';

const FOLLOWUP_TEXT =
  'In 2000, Northwind Sample Works bought a small manufacturing plant, Contoso Imports, located in a generated test region. Contoso Imports manufactures several critical subcomponents for the sample product line. These subcomponents are shipped to the assembly location for final product completion.';

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    ${paragraph('Synthetic Sample Works', { style: 'Heading1', color: '2F75B5', size: '44', spacing: '<w:spacing w:before="480" w:after="600"/>' })}
    <w:p>
      <w:pPr><w:spacing w:before="0" w:after="180" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="36"/></w:rPr></w:pPr>
      <w:r>${TEXT_BOX_ANCHOR}</w:r>
      <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">${INTRO_TEXT}</w:t></w:r>
    </w:p>
    ${paragraph(FOLLOWUP_TEXT, { jc: 'center' })}
    ${paragraph('Product Overview', { style: 'Heading1', color: '2F75B5', size: '40', spacing: '<w:spacing w:before="360" w:after="120"/>' })}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="000000"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="000000"/>
          <w:insideH w:val="single" w:sz="8" w:space="0" w:color="000000"/>
          <w:insideV w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>${paragraph('Synthetic Product A', { color: '2F75B5', size: '32' })}</w:tc>
        <w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>${paragraph('Product No: TEST-472', { size: '28' })}</w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const zip = new JSZip();
const zipOptions = { date: FIXTURE_DATE, createFolders: false };
zip.file('[Content_Types].xml', CONTENT_TYPES_XML, zipOptions);
zip.file('_rels/.rels', RELS_XML, zipOptions);
zip.file('docProps/core.xml', CORE_XML, zipOptions);
zip.file('docProps/app.xml', APP_XML, zipOptions);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, zipOptions);
zip.file('word/styles.xml', STYLES_XML, zipOptions);
zip.file('word/document.xml', DOCUMENT_XML, zipOptions);

const buffer = await zip.generateAsync({ type: 'nodebuffer' });
fs.writeFileSync(OUT, buffer);
console.log(`Created ${OUT}`);

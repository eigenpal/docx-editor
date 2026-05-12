/**
 * Create a generic DOCX fixture for border-overlay geometry.
 *
 * The geometry exercises wrapNone decorative anchors, an indented title
 * paragraph with w:pBdr, and text-relative double page borders. Content and
 * artwork are generated placeholders.
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/border-overlay-layout-demo.docx');

function svgEmblem(label, fill, stroke) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="white"/>
  <circle cx="90" cy="90" r="78" fill="${fill}" stroke="${stroke}" stroke-width="7"/>
  <circle cx="90" cy="90" r="58" fill="none" stroke="${stroke}" stroke-width="3"/>
  <path d="M48 104c19-31 42-44 84-31 7 2 15 6 23 12v45H25v-15c8-1 16-5 23-11Z" fill="#eef3f9" stroke="${stroke}" stroke-width="2"/>
  <path d="M39 76c21-19 47-28 79-24 14 2 25 6 33 12" fill="none" stroke="${stroke}" stroke-width="3"/>
  <text x="90" y="33" text-anchor="middle" font-family="Georgia, serif" font-size="15" font-weight="700" fill="${stroke}">${label}</text>
  <text x="90" y="154" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-weight="700" fill="${stroke}">SAMPLE</text>
</svg>`;
}

function anchorImage({ rId, id, name, x, y, cx, cy, relativeHeight }) {
  return `<w:drawing>
  <wp:anchor behindDoc="1" distT="0" distB="0" distL="114935" distR="114935" simplePos="0" locked="0" layoutInCell="1" allowOverlap="1" relativeHeight="${relativeHeight}">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV>
    <wp:extent cx="${cx}" cy="${cy}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapNone/>
    <wp:docPr id="${id}" name="${name}" descr="${name}"/>
    <wp:cNvGraphicFramePr>
      <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
    </wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${id}" name="${name}"/>
            <pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdLeftArt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/left-art.svg"/>
  <Relationship Id="rIdRightArt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/right-art.svg"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const rightArt = anchorImage({
  rId: 'rIdRightArt',
  id: 1,
  name: 'Decorative right art',
  x: 5259070,
  y: 412115,
  cx: 1463040,
  cy: 1613535,
  relativeHeight: 2,
});

const leftArt = anchorImage({
  rId: 'rIdLeftArt',
  id: 2,
  name: 'Decorative left art',
  x: 104775,
  y: 635,
  cx: 1419225,
  cy: 1409700,
  relativeHeight: 3,
});

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:spacing w:before="240" w:after="60"/>
        <w:ind w:start="1584" w:end="1872"/>
        <w:jc w:val="center"/>
        <w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>
      </w:pPr>
      <w:r>${rightArt}</w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t>DOCUMENT LAYOUT SAMPLE</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:spacing w:before="0" w:after="360"/>
        <w:ind w:start="1584" w:end="1872"/>
        <w:jc w:val="center"/>
        <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
      </w:pPr>
      <w:r>${leftArt}</w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr><w:t>Generated Header Example</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:pBdr>
          <w:top w:val="single" w:sz="12" w:space="5" w:color="000000"/>
          <w:left w:val="single" w:sz="12" w:space="3" w:color="000000"/>
          <w:bottom w:val="single" w:sz="12" w:space="5" w:color="000000"/>
          <w:right w:val="single" w:sz="12" w:space="4" w:color="000000"/>
        </w:pBdr>
        <w:ind w:start="3168" w:end="3168"/>
        <w:jc w:val="center"/>
        <w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
      </w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t>CENTERED BORDER TITLE</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/><w:spacing w:before="0" w:after="60"/><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/><w:spacing w:lineRule="auto" w:line="360"/><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/><w:spacing w:lineRule="auto" w:line="360"/><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:sz w:val="22"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:sz w:val="22"/></w:rPr><w:t>This generated document exercises page and paragraph border geometry with neutral sample text.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/><w:spacing w:before="180" w:after="180"/><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:sz w:val="22"/></w:rPr><w:t>00000 Example Section - Page and Paragraph Border Geometry</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/><w:spacing w:lineRule="auto" w:line="360"/><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:sz w:val="22"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:sz w:val="22"/></w:rPr><w:t>This fixture uses generated text and abstract artwork only.</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:type w:val="nextPage"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:left="810" w:right="540" w:gutter="0" w:header="0" w:top="810" w:footer="720" w:bottom="776"/>
      <w:pgBorders w:display="allPages" w:offsetFrom="text">
        <w:top w:val="double" w:sz="4" w:space="15" w:color="000000"/>
        <w:left w:val="double" w:sz="4" w:space="15" w:color="000000"/>
        <w:bottom w:val="double" w:sz="4" w:space="11" w:color="000000"/>
        <w:right w:val="double" w:sz="4" w:space="2" w:color="000000"/>
      </w:pgBorders>
      <w:pgNumType w:fmt="decimal"/>
      <w:docGrid w:type="default" w:linePitch="360" w:charSpace="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
zip.file('_rels/.rels', RELS_XML);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
zip.file('word/styles.xml', STYLES_XML);
zip.file('word/document.xml', DOCUMENT_XML);
zip.file('word/media/left-art.svg', svgEmblem('LEFT ART', '#dbeafe', '#1d4ed8'));
zip.file('word/media/right-art.svg', svgEmblem('RIGHT ART', '#fef3c7', '#92400e'));

const buffer = await zip.generateAsync({ type: 'nodebuffer' });
fs.writeFileSync(OUT, buffer);
console.log(`Created ${OUT}`);

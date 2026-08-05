/**
 * Deterministic DrawingML fixture builder (Task 17).
 *
 * Generates the ten focused drawing fixtures and refreshes `drawings-fixtures.md`
 * with SHA-256 hashes for all sixteen manifest inputs.
 *
 *   bun e2e/fixtures/build-drawing-fixtures.mjs
 */

import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DATE = new Date('2026-01-01T00:00:00Z');
const ZIP_OPTS = { date: FIXTURE_DATE, createFolders: false };

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const GROUP_URI = 'http://schemas.openxmlformats.org/drawingml/2006/group';
const WPS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const IMAGE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HEADER_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xd9,
]);
const GIF_1X1 = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0x00, 0x00,
  0x00, 0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x01, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x01, 0x00, 0x00, 0x02, 0x02, 0x4c, 0x01, 0x00, 0x3b,
]);
const SVG_MIN = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
const TIFF_MIN = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const EMF_MIN = Buffer.from([0x01, 0x00, 0x00, 0x00, ...new Array(40).fill(0)]);
const WMF_MIN = Buffer.from([0xd7, 0xcd, 0xc6, 0x9a, ...new Array(40).fill(0)]);

function contentTypes(extra = '') {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="gif" ContentType="image/gif"/>` +
    `<Default Extension="svg" ContentType="image/svg+xml"/>` +
    `<Default Extension="tif" ContentType="image/tiff"/>` +
    `<Default Extension="emf" ContentType="image/x-emf"/>` +
    `<Default Extension="wmf" ContentType="image/x-wmf"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    extra +
    `</Types>`
  );
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

const SECT = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>`;

function paragraph(text, drawing = '') {
  const drawRun = drawing ? `<w:r><w:drawing>${drawing}</w:drawing></w:r>` : '';
  return `<w:p><w:r><w:t>${text}</w:t></w:r>${drawRun}</w:p>`;
}

function pictureBlip({
  embed,
  link,
  srcRect = '',
  effects = '',
  xfrm = 'rot="0" flipH="0" flipV="0"',
  cNvPrId,
}) {
  const embedAttr = embed !== undefined ? ` r:embed="${embed}"` : '';
  const linkAttr = link ? ` r:link="${link}"` : '';
  const rect = srcRect || '<a:srcRect/>';
  const blipInner = effects ? `${effects}` : '';
  return (
    `<pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${cNvPrId}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip${embedAttr}${linkAttr}>${blipInner}</a:blip>` +
    rect +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr><a:xfrm ${xfrm}><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic>`
  );
}

function inlineDrawing({ id, name, blip, extent = 'cx="914400" cy="914400"' }) {
  return (
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    `<wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">${blip ?? pictureBlip({ embed: 'rIdMedia', cNvPrId: id })}</a:graphicData></a:graphic>` +
    `</wp:inline>`
  );
}

function anchorDrawing({
  id,
  name,
  blip,
  wrap,
  anchorAttrs = 'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="251658240" allowOverlap="1" layoutInCell="1"',
  posH = '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>',
  posV = '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>',
  extent = 'cx="914400" cy="914400"',
  graphicUri = PIC_URI,
  graphicInner = '',
}) {
  const inner =
    graphicInner ||
    `<a:graphicData uri="${graphicUri}">${blip ?? pictureBlip({ embed: 'rIdMedia', cNvPrId: id })}</a:graphicData>`;
  return (
    `<wp:anchor ${anchorAttrs}>` +
    `<wp:simplePos x="0" y="0"/>` +
    posH +
    posV +
    `<wp:extent ${extent}/>` +
    wrap +
    `<wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${A}">${inner}</a:graphic>` +
    `</wp:anchor>`
  );
}

async function writeDocx(filename, files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content, ZIP_OPTS);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const out = path.join(ROOT, filename);
  fs.writeFileSync(out, buffer);
  return buffer;
}

function basePackage(documentXml, docRels, extra = {}, contentTypesExtra = '') {
  return {
    '[Content_Types].xml': contentTypes(contentTypesExtra),
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/></Relationships>`,
    'word/styles.xml': STYLES_XML,
    'word/document.xml': documentXml,
    'word/_rels/document.xml.rels': docRels,
    ...extra,
  };
}

function buildImagesExternal() {
  const blipLink = pictureBlip({ link: 'rIdLink', cNvPrId: 1 });
  const blipUnsafe = pictureBlip({ embed: 'rIdUnsafe', cNvPrId: 2 });
  const blipSpoof = pictureBlip({ embed: 'rIdSpoof', cNvPrId: 3 });
  const blipHuge = pictureBlip({ embed: 'rIdHuge', cNvPrId: 4 });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    paragraph('External r:link', anchorDrawing({ id: 1, name: 'link ext', blip: blipLink, wrap: '<wp:wrapNone/>' })) +
    paragraph('Unsafe scheme', inlineDrawing({ id: 2, name: 'unsafe', blip: blipUnsafe })) +
    paragraph('MIME spoof', inlineDrawing({ id: 3, name: 'spoof', blip: blipSpoof })) +
    paragraph('Oversize extent', inlineDrawing({ id: 4, name: 'oversize', blip: blipHuge, extent: 'cx="999999999" cy="999999999"' })) +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLink" Type="${IMAGE_REL}" Target="https://example.invalid/pixel.png" TargetMode="External"/>` +
    `<Relationship Id="rIdUnsafe" Type="${IMAGE_REL}" Target="javascript:alert(1)" TargetMode="External"/>` +
    `<Relationship Id="rIdSpoof" Type="${IMAGE_REL}" Target="media/spoof.jpg"/>` +
    `<Relationship Id="rIdHuge" Type="${IMAGE_REL}" Target="media/huge.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, {
    'word/media/spoof.jpg': PNG_1X1,
    'word/media/huge.png': PNG_1X1,
  });
}

function buildImagesWrapSides() {
  const wraps = [
    ['square-left', '<wp:wrapSquare wrapText="left" distT="1" distB="2" distL="3" distR="4"/>', 1],
    ['square-right', '<wp:wrapSquare wrapText="right" distT="1" distB="2" distL="3" distR="4"/>', 2],
    ['square-both', '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>', 3],
    ['square-largest', '<wp:wrapSquare wrapText="largest" distT="1" distB="2" distL="3" distR="4"/>', 4],
    ['tight', '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>', 5],
    ['through', '<wp:wrapThrough wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>', 6],
    ['top-bottom', '<wp:wrapTopAndBottom distT="1" distB="2"/>', 7],
    ['wrap-none-front', '<wp:wrapNone/>', 8],
    ['wrap-none-behind', '<wp:wrapNone/>', 9],
  ];
  let bodyInner = '';
  for (const [label, wrap, id] of wraps) {
    const behind = label === 'wrap-none-behind' ? '1' : '0';
    bodyInner += paragraph(
      label,
      anchorDrawing({
        id,
        name: label,
        blip: pictureBlip({ embed: 'rIdMedia', cNvPrId: id }),
        wrap,
        anchorAttrs: `distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${behind}" locked="0" relativeHeight="${251658240 + id}" allowOverlap="1" layoutInCell="1"`,
        posH: `<wp:positionH relativeFrom="margin"><wp:posOffset>${id * 200000}</wp:posOffset></wp:positionH>`,
        posV: `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${id * 100000}</wp:posOffset></wp:positionV>`,
      })
    );
  }
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    bodyInner +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/image.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, { 'word/media/image.png': PNG_1X1 });
}

function buildImagesCrop() {
  const blip = pictureBlip({
    embed: 'rIdMedia',
    cNvPrId: 1,
    srcRect: '<a:srcRect l="10000" t="15000" r="20000" b="25000"/>',
  });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    paragraph('Cropped image', inlineDrawing({ id: 1, name: 'crop', blip })) +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/image.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, { 'word/media/image.png': PNG_1X1 });
}

function buildImagesZorder() {
  const blipBehind = pictureBlip({ embed: 'rIdMedia', cNvPrId: 1 });
  const blipFront = pictureBlip({ embed: 'rIdMedia', cNvPrId: 2 });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    `<w:p><w:r><w:t>Overlap z-order</w:t></w:r>` +
    `<w:r><w:drawing>${anchorDrawing({
      id: 1,
      name: 'behind',
      blip: blipBehind,
      wrap: '<wp:wrapSquare wrapText="bothSides"/>',
      anchorAttrs:
        'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" relativeHeight="100" allowOverlap="0" layoutInCell="1"',
      posH: '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>',
      posV: '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>',
    })}</w:drawing></w:r>` +
    `<w:r><w:drawing>${anchorDrawing({
      id: 2,
      name: 'front',
      blip: blipFront,
      wrap: '<wp:wrapSquare wrapText="bothSides"/>',
      anchorAttrs:
        'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="200" allowOverlap="0" layoutInCell="1"',
      posH: '<wp:positionH relativeFrom="page"><wp:posOffset>1200000</wp:posOffset></wp:positionH>',
      posV: '<wp:positionV relativeFrom="page"><wp:posOffset>1200000</wp:posOffset></wp:positionV>',
    })}</w:drawing></w:r>` +
    `</w:p>` +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/image.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, { 'word/media/image.png': PNG_1X1 });
}

function buildImagesFormats() {
  const formats = [
    ['png', 'rIdPng', PNG_1X1],
    ['jpeg', 'rIdJpeg', JPEG_1X1],
    ['gif', 'rIdGif', GIF_1X1],
    ['svg', 'rIdSvg', SVG_MIN],
    ['tif', 'rIdTiff', TIFF_MIN],
    ['emf', 'rIdEmf', EMF_MIN],
    ['wmf', 'rIdWmf', WMF_MIN],
  ];
  let bodyInner = '';
  const rels = [`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`];
  const media = {};
  let id = 1;
  for (const [label, relId, bytes] of formats) {
    const ext = label === 'jpeg' ? 'jpg' : label;
    media[`word/media/fmt.${ext}`] = bytes;
    rels.push(`<Relationship Id="${relId}" Type="${IMAGE_REL}" Target="media/fmt.${ext}"/>`);
    bodyInner += paragraph(
      label,
      inlineDrawing({ id, name: label, blip: pictureBlip({ embed: relId, cNvPrId: id }) })
    );
    id += 1;
  }
  rels.push(`</Relationships>`);
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    bodyInner +
    SECT +
    `</w:body></w:document>`;
  return basePackage(body, rels.join(''), media);
}

function buildImagesHeader() {
  const blip = pictureBlip({ embed: 'rIdHdrMedia', cNvPrId: 1 });
  const headerDrawing = anchorDrawing({
    id: 1,
    name: 'header anchor',
    blip,
    wrap: '<wp:wrapNone/>',
    posH: '<wp:positionH relativeFrom="page"><wp:align>right</wp:align></wp:positionH>',
    posV: '<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionV>',
  });
  const headerXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
    `<w:p><w:r><w:drawing>${headerDrawing}</w:drawing></w:r><w:r><w:t>Header letterhead</w:t></w:r></w:p></w:hdr>`;
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    paragraph('Body under header anchor') +
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>` +
    `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>` +
    `</w:body></w:document>`;
  const docRels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdHdr" Type="${HEADER_REL}" Target="header1.xml"/>` +
    `</Relationships>`;
  const hdrRels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdHdrMedia" Type="${IMAGE_REL}" Target="media/header.png"/>` +
    `</Relationships>`;
  return basePackage(
    body,
    docRels,
    {
      'word/header1.xml': headerXml,
      'word/_rels/header1.xml.rels': hdrRels,
      'word/media/header.png': PNG_1X1,
    },
    `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
  );
}

function buildImagesNonpicture() {
  const chart = anchorDrawing({
    id: 1,
    name: 'chart',
    wrap: '<wp:wrapSquare wrapText="bothSides"/>',
    graphicUri: CHART_URI,
    graphicInner: `<a:graphicData uri="${CHART_URI}"><c:chart xmlns:c="${CHART_URI}" r:id="rIdChart"/></a:graphicData>`,
  });
  const group = anchorDrawing({
    id: 2,
    name: 'group',
    wrap: '<wp:wrapSquare wrapText="bothSides"/>',
    graphicUri: GROUP_URI,
    graphicInner: `<a:graphicData uri="${GROUP_URI}"><a:grpSp/></a:graphicData>`,
  });
  const textbox = anchorDrawing({
    id: 3,
    name: 'textbox',
    wrap: '<wp:wrapSquare wrapText="bothSides"/>',
    graphicUri: WPS_URI,
    graphicInner:
      `<a:graphicData uri="${WPS_URI}">` +
      `<wps:wsp xmlns:wps="${WPS_URI}"><wps:cNvSpPr txBox="1"/><wps:spPr/>` +
      `<wps:txbx><w:txbxContent xmlns:w="${W}"><w:p><w:r><w:t>Text box</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
      `<wps:bodyPr/></wps:wsp></a:graphicData>`,
  });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS_URI}"><w:body>` +
    paragraph('Non-picture graphics') +
    `<w:p><w:r><w:drawing>${chart}</w:drawing></w:r></w:p>` +
    `<w:p><w:r><w:drawing>${group}</w:drawing></w:r></w:p>` +
    `<w:p><w:r><w:drawing>${textbox}</w:drawing></w:r></w:p>` +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>` +
    `</Relationships>`;
  return basePackage(body, rels, {
    'word/charts/chart1.xml': '<?xml version="1.0"?><c:chartSpace xmlns:c="' + CHART_URI + '"/>',
  }, `<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
}

function buildImagesTransform() {
  const blipRot = pictureBlip({ embed: 'rIdMedia', cNvPrId: 1, xfrm: 'rot="5400000" flipH="0" flipV="0"' });
  const blipFlipH = pictureBlip({ embed: 'rIdMedia', cNvPrId: 2, xfrm: 'rot="0" flipH="1" flipV="0"' });
  const blipFlipV = pictureBlip({ embed: 'rIdMedia', cNvPrId: 3, xfrm: 'rot="0" flipH="0" flipV="1"' });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    paragraph('Rotation', inlineDrawing({ id: 1, name: 'rot90', blip: blipRot })) +
    paragraph('FlipH', inlineDrawing({ id: 2, name: 'flipH', blip: blipFlipH })) +
    paragraph('FlipV', inlineDrawing({ id: 3, name: 'flipV', blip: blipFlipV })) +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/image.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, { 'word/media/image.png': PNG_1X1 });
}

function buildImagesCompatibilityMalformed() {
  const goodBlip = pictureBlip({ embed: 'rIdMedia', cNvPrId: 12 });
  const mcBlock =
    `<w:p><w:r>` +
    `<mc:AlternateContent xmlns:mc="${MC}">` +
    `<mc:Choice Requires="wps"><w:drawing>` +
    anchorDrawing({ id: 10, name: 'mc-choice', blip: pictureBlip({ embed: 'rIdMedia', cNvPrId: 10 }), wrap: '<wp:wrapNone/>' }) +
    `</w:drawing></mc:Choice>` +
    `<mc:Fallback><w:drawing>` +
    anchorDrawing({ id: 11, name: 'mc-fallback', blip: pictureBlip({ embed: 'rIdMedia', cNvPrId: 11 }), wrap: '<wp:wrapNone/>' }) +
    `</w:drawing></mc:Fallback></mc:AlternateContent>` +
    `</w:r></w:p>`;
  const malformedAnchor =
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="0" allowOverlap="1" layoutInCell="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="not-a-number" cy="914400"/>` +
    `<wp:wrapSquare wrapText="bothSides"/>` +
    `<wp:docPr id="0" name="bad-id"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">${goodBlip}</a:graphicData></a:graphic>` +
    `</wp:anchor>`;
  const vml =
    `<w:pict>` +
    `<v:shape xmlns:v="${V}" xmlns:o="${O}" id="vml1" style="width:72pt;height:72pt" o:allowincell="f">` +
    `<v:imagedata r:id="rIdMedia"/></v:shape></w:pict>`;
  const ole =
    `<w:object w:dxaOrig="914400" w:dyaOrig="914400" w:progId="Package">` +
    `<o:OLEObject xmlns:o="${O}" Type="Embed" ProgID="Package" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_123" r:id="rIdOle"/>` +
    `</w:object>`;
  const altChunk = `<w:altChunk r:id="rIdAltChunk"/>`;
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:mc="${MC}" xmlns:v="${V}" xmlns:o="${O}" xmlns:wps="${WPS_URI}"><w:body>` +
    `<w:p><w:r><w:drawing>${malformedAnchor}</w:drawing></w:r></w:p>` +
    mcBlock +
    `<w:p><w:r>${vml}</w:r></w:p>` +
    `<w:p><w:r>${ole}</w:r></w:p>` +
    paragraph('AltChunk follows') +
    altChunk +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/image.png"/>` +
    `<Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/ole.bin"/>` +
    `<Relationship Id="rIdAltChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="altChunk/fragment.htm"/>` +
    `</Relationships>`;
  return basePackage(body, rels, {
    'word/media/image.png': PNG_1X1,
    'word/embeddings/ole.bin': Buffer.from([0, 1, 2, 3]),
    'word/altChunk/fragment.htm': '<html><body>alt chunk</body></html>',
  });
}

function buildImagesDrawingmlWatermark() {
  const blip = pictureBlip({
    embed: 'rIdMedia',
    cNvPrId: 1,
    effects: '<a:lum bright="70000" contrast="-25000"/><a:grayscl/>',
  });
  const drawing = anchorDrawing({
    id: 1,
    name: 'watermark',
    blip,
    wrap: '<wp:wrapNone/>',
    anchorAttrs:
      'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="1" relativeHeight="1" allowOverlap="1" layoutInCell="0"',
    posH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
    posV: '<wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>',
    extent: 'cx="5486400" cy="5486400"',
  });
  const body =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>` +
    paragraph('Document with DrawingML watermark') +
    `<w:p><w:r><w:drawing>${drawing}</w:drawing></w:r></w:p>` +
    SECT +
    `</w:body></w:document>`;
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdMedia" Type="${IMAGE_REL}" Target="media/watermark.png"/>` +
    `</Relationships>`;
  return basePackage(body, rels, { 'word/media/watermark.png': PNG_1X1 });
}

const GENERATED = {
  'images-external.docx': buildImagesExternal,
  'images-wrap-sides.docx': buildImagesWrapSides,
  'images-crop.docx': buildImagesCrop,
  'images-zorder.docx': buildImagesZorder,
  'images-formats.docx': buildImagesFormats,
  'images-header.docx': buildImagesHeader,
  'images-nonpicture.docx': buildImagesNonpicture,
  'images-transform.docx': buildImagesTransform,
  'images-compatibility-malformed.docx': buildImagesCompatibilityMalformed,
  'images-drawingml-watermark.docx': buildImagesDrawingmlWatermark,
};

const EXISTING = [
  {
    file: 'comprehensive-word-element-test.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['inline layout', 'square wrap sample', 'eleven drawings', 'empty a:srcRect on all pictures'],
    geometry: 'mixed inline/anchor; see fixture labels',
    branch: 'canonical tree',
    refusal: 'none for supported drawings',
    wordEvidence: 'pending — editor-only baseline captured Task 0',
    tolerance: 'n/a until Word screenshots (9.5)',
  },
  {
    file: 'list-pagination-break.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['27 TargetMode=External image relationships', 'list pagination', 'zero-fetch rule'],
    geometry: 'multi-page body lists',
    branch: 'external rel refusal',
    refusal: 'external image — no fetch',
    wordEvidence: 'n/a — security oracle',
    tolerance: 'zero network requests',
  },
  {
    file: 'float-wrap-comprehensive-test.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['wrapTight', 'wrapThrough', 'wrapTopAndBottom'],
    geometry: 'multiple anchored wraps',
    branch: 'polygon/bbox exclusion',
    refusal: 'none',
    wordEvidence: 'pending (9.5)',
    tolerance: 'pending Word comparison',
  },
  {
    file: 'image-layout-modes-demo.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['inline', 'square wrap', 'top-and-bottom', 'Playwright acceptance target'],
    geometry: 'six drawings on one page',
    branch: 'authoring chrome',
    refusal: 'none',
    wordEvidence: 'pending (9.5)',
    tolerance: 'browser acceptance only',
  },
  {
    file: 'issue-705-anchored-header-letterhead.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['page-relative header anchor', 'header flow-height rule'],
    geometry: 'header letterhead anchor',
    branch: 'HF furniture',
    refusal: 'none',
    wordEvidence: 'pending (9.5)',
    tolerance: 'pending Word comparison',
  },
  {
    file: 'wrap-none-positioned-image-demo.docx',
    source: 'Word-authored',
    version: 'Microsoft Word (repository fixture)',
    features: ['wrapNone', 'behindDoc positioning'],
    geometry: 'positioned wrap-none seals',
    branch: 'layer order',
    refusal: 'none',
    wordEvidence: 'pending (9.5)',
    tolerance: 'pending Word comparison',
  },
];

const GENERATED_META = [
  ['images-external.docx', 'r:link, unsafe scheme, MIME spoof, oversize extent', 'external/missing/spoof/unrenderable', 'zero fetch'],
  ['images-wrap-sides.docx', 'all ST_WrapText sides, wrapNone front/behind', 'nine wrap modes', 'layout records per wrap'],
  ['images-crop.docx', 'non-empty a:srcRect', 'inline crop', 'crop permille preserved'],
  ['images-zorder.docx', 'relativeHeight, behindDoc, allowOverlap=0', 'two overlapping anchors', 'layer metadata'],
  ['images-formats.docx', 'PNG/JPEG/GIF/SVG/TIFF/EMF/WMF', 'seven inline drawings', 'ready vs placeholder'],
  ['images-header.docx', 'page-relative header anchor', 'HF furniture anchor', 'header flow height unchanged'],
  ['images-nonpicture.docx', 'chart, group, textbox', 'extent placeholders', 'non-picture refusal'],
  ['images-transform.docx', 'rotation, flipH, flipV', 'three inline drawings', 'transform paint metadata'],
  ['images-compatibility-malformed.docx', 'malformed anchor, mc:AlternateContent, VML, OLE, altChunk', 'demotion/generic preservation', 'inert unsupported payloads'],
  ['images-drawingml-watermark.docx', 'a:lum, a:grayscl, behindDoc', 'centered watermark anchor', 'watermark effects paint'],
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  for (const [name, build] of Object.entries(GENERATED)) {
    await writeDocx(name, build());
    console.log(`Wrote ${name}`);
  }

  const entries = [];
  for (const meta of EXISTING) {
    const bytes = fs.readFileSync(path.join(ROOT, meta.file));
    entries.push({ ...meta, sha256: sha256(bytes) });
  }
  for (const [file, features, branch, refusal] of GENERATED_META) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    entries.push({
      file,
      source: 'deterministic builder',
      version: 'build-drawing-fixtures.mjs @ 2026-01-01',
      features: features.split(', '),
      geometry: 'see builder',
      branch,
      refusal,
      wordEvidence: 'not applicable — synthetic OPC',
      tolerance: 'fingerprint + digest equality',
      sha256: sha256(bytes),
    });
  }

  const manifestJson = JSON.stringify({ version: 1, entries }, null, 2);
  const md =
    `# Drawings fixture manifest\n\n` +
    `Sixteen inputs for typed-drawings-and-images Task 17: six Word-authored repository fixtures plus ten deterministic builder outputs.\n\n` +
    `Regenerate focused fixtures:\n\n\`\`\`bash\nbun e2e/fixtures/build-drawing-fixtures.mjs\n\`\`\`\n\n` +
    `## Evidence status\n\n` +
    `- **9.5 Word visual comparison:** blocked — Microsoft Word desktop not available in CI/dev; \`screenshots/typed-drawings-word-comparison/\` holds editor output only, labeled NOT Word reference.\n` +
    `- **3.4 / 6.8a:** unchecked without Word evidence.\n` +
    `- **7.9 comprehensive empty srcRect:** all eleven \`a:srcRect\` elements in \`comprehensive-word-element-test.docx\` are empty — not crop coverage.\n` +
    `- **7.1 list-pagination:** 27 \`TargetMode="External"\` image relationships; zero network fetch oracle.\n\n` +
    `## Entries\n\n` +
    `| File | Source | SHA-256 | Branch / refusal | Word evidence |\n` +
    `| --- | --- | --- | --- | --- |\n` +
    entries
      .map(
        (e) =>
          `| ${e.file} | ${e.source} | \`${e.sha256.slice(0, 16)}…\` | ${e.branch ?? ''} / ${e.refusal ?? ''} | ${e.wordEvidence ?? 'n/a'} |`
      )
      .join('\n') +
    `\n\n<!-- DRAWINGS_FIXTURE_MANIFEST\n${manifestJson}\n-->\n`;

  fs.writeFileSync(path.join(ROOT, 'drawings-fixtures.md'), md);
  console.log('Updated drawings-fixtures.md');
}

await main();

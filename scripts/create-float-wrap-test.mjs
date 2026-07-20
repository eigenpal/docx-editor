/**
 * Create a comprehensive test DOCX for floating image text wrapping.
 *
 * Tests for issues #143 (text wrapping around floating images) and
 * #188 (floating images in table cells render as blocks).
 *
 * Covers:
 * - All wrap types: wrapSquare, wrapTight, wrapTopAndBottom, wrapNone (behind/inFront)
 * - All wrapText modes: bothSides, left, right, largest
 * - Floating images on page level with surrounding text
 * - Floating images inside table cells with cell text
 * - Multiple floating images in the same paragraph
 * - Different position modes: offset, alignment (left/center/right)
 * - Different relativeFrom: column, margin, page
 *
 * Run: node scripts/create-float-wrap-test.mjs
 *   or: bun scripts/create-float-wrap-test.mjs
 */

import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

// ============================================================================
// MINIMAL PNG GENERATOR
// ============================================================================

function createSolidPng(width, height, r, g, b) {
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = deflateSync(rawData);
  const chunks = [];
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(makePngChunk('IHDR', ihdr));
  chunks.push(makePngChunk('IDAT', compressed));
  chunks.push(makePngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function makePngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const EMU_PER_PIXEL = 9525;
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
const SHORT_TEXT =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump.';

// ============================================================================
// XML BUILDERS
// ============================================================================

let docPrCounter = 1;

function buildAnchorImage({
  rId,
  widthPx,
  heightPx,
  posXPx = 0,
  posYPx = 0,
  wrapType = 'wrapSquare',
  wrapText = 'bothSides',
  behindDoc = 0,
  relativeFromH = 'column',
  relativeFromV = 'paragraph',
  alignH = null,
  alignV = null,
  name = 'Image',
  alt = '',
}) {
  const cx = widthPx * EMU_PER_PIXEL;
  const cy = heightPx * EMU_PER_PIXEL;
  const id = docPrCounter++;

  // Horizontal positioning
  let positionH;
  if (alignH) {
    positionH = `<wp:positionH relativeFrom="${relativeFromH}"><wp:align>${alignH}</wp:align></wp:positionH>`;
  } else {
    const posX = posXPx * EMU_PER_PIXEL;
    positionH = `<wp:positionH relativeFrom="${relativeFromH}"><wp:posOffset>${posX}</wp:posOffset></wp:positionH>`;
  }

  // Vertical positioning
  let positionV;
  if (alignV) {
    positionV = `<wp:positionV relativeFrom="${relativeFromV}"><wp:align>${alignV}</wp:align></wp:positionV>`;
  } else {
    const posY = posYPx * EMU_PER_PIXEL;
    positionV = `<wp:positionV relativeFrom="${relativeFromV}"><wp:posOffset>${posY}</wp:posOffset></wp:positionV>`;
  }

  // Wrap element
  let wrapEl;
  switch (wrapType) {
    case 'wrapSquare':
      wrapEl = `<wp:wrapSquare wrapText="${wrapText}"/>`;
      break;
    case 'wrapTight':
      // wrapTight uses a wrapPolygon - simplified rectangle
      wrapEl = `<wp:wrapTight wrapText="${wrapText}">
        <wp:wrapPolygon edited="0">
          <wp:start x="0" y="0"/>
          <wp:lineTo x="0" y="21600"/>
          <wp:lineTo x="21600" y="21600"/>
          <wp:lineTo x="21600" y="0"/>
          <wp:lineTo x="0" y="0"/>
        </wp:wrapPolygon>
      </wp:wrapTight>`;
      break;
    case 'wrapThrough':
      wrapEl = `<wp:wrapThrough wrapText="${wrapText}">
        <wp:wrapPolygon edited="0">
          <wp:start x="0" y="0"/>
          <wp:lineTo x="0" y="21600"/>
          <wp:lineTo x="21600" y="21600"/>
          <wp:lineTo x="21600" y="0"/>
          <wp:lineTo x="0" y="0"/>
        </wp:wrapPolygon>
      </wp:wrapThrough>`;
      break;
    case 'wrapTopAndBottom':
      wrapEl = `<wp:wrapTopAndBottom/>`;
      break;
    case 'wrapNone':
      wrapEl = `<wp:wrapNone/>`;
      break;
    default:
      wrapEl = `<wp:wrapSquare wrapText="bothSides"/>`;
  }

  return `<w:drawing>
  <wp:anchor distT="45720" distB="45720" distL="114300" distR="114300"
             simplePos="0" relativeHeight="251658240"
             behindDoc="${behindDoc}" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/>
    ${positionH}
    ${positionV}
    <wp:extent cx="${cx}" cy="${cy}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    ${wrapEl}
    <wp:docPr id="${id}" name="${name}" descr="${alt}"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${id}" name="${name}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm>
              <a:off x="0" y="0"/>
              <a:ext cx="${cx}" cy="${cy}"/>
            </a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>`;
}

function para(text, bold = false, sz = null) {
  let rPr = '';
  if (bold || sz) {
    rPr = '<w:rPr>';
    if (bold) rPr += '<w:b/>';
    if (sz) rPr += `<w:sz w:val="${sz}"/>`;
    rPr += '</w:rPr>';
  }
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function heading(text, level = 1) {
  const sz = level === 1 ? 36 : level === 2 ? 28 : 24;
  return `<w:p>
    <w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="${sz}"/><w:color w:val="1F4E79"/></w:rPr>
    <w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function imageWithText(imageXml, text) {
  return `<w:p><w:r>${imageXml}</w:r><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function separator() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>`;
}

function tableCell(contentXml, widthTwips) {
  return `<w:tc>
  <w:tcPr>
    <w:tcW w:w="${widthTwips}" w:type="dxa"/>
    <w:tcBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
    </w:tcBorders>
    <w:tcMar>
      <w:top w:w="72" w:type="dxa"/>
      <w:left w:w="144" w:type="dxa"/>
      <w:bottom w:w="72" w:type="dxa"/>
      <w:right w:w="144" w:type="dxa"/>
    </w:tcMar>
  </w:tcPr>
  ${contentXml}
</w:tc>`;
}

// ============================================================================
// DOCUMENT BODY
// ============================================================================

function buildDocumentXml() {
  const sections = [];

  // ── TITLE ──
  sections.push(heading('Floating Image Text Wrapping Test Suite', 1));
  sections.push(para('Comprehensive test for issues #143 and #188. Tests all wrap types, wrap text modes, position modes, and table cell scenarios.'));
  sections.push(separator());

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Page-level wrap types (Issue #143)
  // ══════════════════════════════════════════════════════════════════════════
  sections.push(heading('Section 1: Wrap Types (Issue #143 — Page Level)', 1));

  // 1a. wrapSquare — bothSides
  sections.push(heading('1a. wrapSquare — bothSides', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId10',
        widthPx: 150,
        heightPx: 120,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'bothSides',
        name: 'Square-BothSides',
      }),
      LOREM
    )
  );
  sections.push(para(SHORT_TEXT));

  // 1b. wrapSquare — left (text wraps on left only)
  sections.push(heading('1b. wrapSquare — left (text on left only)', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId11',
        widthPx: 140,
        heightPx: 100,
        posXPx: 300,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'left',
        name: 'Square-Left',
      }),
      LOREM
    )
  );

  // 1c. wrapSquare — right (text wraps on right only)
  sections.push(heading('1c. wrapSquare — right (text on right only)', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId12',
        widthPx: 140,
        heightPx: 100,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'right',
        name: 'Square-Right',
      }),
      LOREM
    )
  );

  // 1d. wrapTight — bothSides
  sections.push(heading('1d. wrapTight — bothSides', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId13',
        widthPx: 130,
        heightPx: 110,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapTight',
        wrapText: 'bothSides',
        name: 'Tight-BothSides',
      }),
      LOREM
    )
  );

  // 1e. wrapThrough
  sections.push(heading('1e. wrapThrough — bothSides', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId14',
        widthPx: 120,
        heightPx: 100,
        posXPx: 200,
        posYPx: 0,
        wrapType: 'wrapThrough',
        wrapText: 'bothSides',
        name: 'Through-BothSides',
      }),
      LOREM
    )
  );

  // 1f. wrapTopAndBottom
  sections.push(heading('1f. wrapTopAndBottom', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId10',
        widthPx: 200,
        heightPx: 80,
        posXPx: 100,
        posYPx: 0,
        wrapType: 'wrapTopAndBottom',
        name: 'TopAndBottom',
      }),
      LOREM
    )
  );

  // 1g. wrapNone — in front of text
  sections.push(heading('1g. wrapNone — In Front of Text', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId11',
        widthPx: 100,
        heightPx: 80,
        posXPx: 150,
        posYPx: 10,
        wrapType: 'wrapNone',
        behindDoc: 0,
        name: 'InFront',
      }),
      LOREM
    )
  );

  // 1h. wrapNone — behind text
  sections.push(heading('1h. wrapNone — Behind Text', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId12',
        widthPx: 200,
        heightPx: 120,
        posXPx: 100,
        posYPx: 0,
        wrapType: 'wrapNone',
        behindDoc: 1,
        name: 'BehindText',
      }),
      LOREM
    )
  );

  sections.push(separator());

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Position modes
  // ══════════════════════════════════════════════════════════════════════════
  sections.push(heading('Section 2: Position Modes', 1));

  // 2a. Align left
  sections.push(heading('2a. Horizontal Align: left', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId13',
        widthPx: 120,
        heightPx: 90,
        wrapType: 'wrapSquare',
        wrapText: 'right',
        alignH: 'left',
        relativeFromH: 'column',
        name: 'Align-Left',
      }),
      LOREM
    )
  );

  // 2b. Align right
  sections.push(heading('2b. Horizontal Align: right', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId14',
        widthPx: 120,
        heightPx: 90,
        wrapType: 'wrapSquare',
        wrapText: 'left',
        alignH: 'right',
        relativeFromH: 'column',
        name: 'Align-Right',
      }),
      LOREM
    )
  );

  // 2c. Align center
  sections.push(heading('2c. Horizontal Align: center', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId10',
        widthPx: 120,
        heightPx: 90,
        wrapType: 'wrapSquare',
        wrapText: 'bothSides',
        alignH: 'center',
        relativeFromH: 'column',
        name: 'Align-Center',
      }),
      LOREM
    )
  );

  // 2d. Relative to page margin
  sections.push(heading('2d. Relative to margin', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId11',
        widthPx: 120,
        heightPx: 90,
        posXPx: 20,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'bothSides',
        relativeFromH: 'margin',
        name: 'RelMargin',
      }),
      LOREM
    )
  );

  sections.push(separator());

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Multiple floating images
  // ══════════════════════════════════════════════════════════════════════════
  sections.push(heading('Section 3: Multiple Floating Images', 1));

  // 3a. Two images in same paragraph — left and right
  sections.push(heading('3a. Two images — left and right side', 2));
  {
    const imgLeft = buildAnchorImage({
      rId: 'rId10',
      widthPx: 100,
      heightPx: 80,
      posXPx: 0,
      posYPx: 0,
      wrapType: 'wrapSquare',
      wrapText: 'right',
      name: 'Multi-Left',
    });
    const imgRight = buildAnchorImage({
      rId: 'rId12',
      widthPx: 100,
      heightPx: 80,
      posXPx: 400,
      posYPx: 0,
      wrapType: 'wrapSquare',
      wrapText: 'left',
      name: 'Multi-Right',
    });
    sections.push(
      `<w:p><w:r>${imgLeft}</w:r><w:r>${imgRight}</w:r><w:r><w:t xml:space="preserve">${LOREM} ${SHORT_TEXT}</w:t></w:r></w:p>`
    );
  }

  // 3b. Stacked images (different Y offsets)
  sections.push(heading('3b. Stacked images (different vertical offsets)', 2));
  {
    const img1 = buildAnchorImage({
      rId: 'rId13',
      widthPx: 100,
      heightPx: 60,
      posXPx: 0,
      posYPx: 0,
      wrapType: 'wrapSquare',
      wrapText: 'right',
      name: 'Stack-Top',
    });
    const img2 = buildAnchorImage({
      rId: 'rId14',
      widthPx: 100,
      heightPx: 60,
      posXPx: 0,
      posYPx: 80,
      wrapType: 'wrapSquare',
      wrapText: 'right',
      name: 'Stack-Bottom',
    });
    sections.push(
      `<w:p><w:r>${img1}</w:r><w:r>${img2}</w:r><w:r><w:t xml:space="preserve">${LOREM} ${LOREM}</w:t></w:r></w:p>`
    );
  }

  sections.push(separator());

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Floating images in table cells (Issue #188)
  // ══════════════════════════════════════════════════════════════════════════
  sections.push(heading('Section 4: Floating Images in Table Cells (Issue #188)', 1));
  sections.push(para('Each cell contains a floating image with different wrap settings. Text in the cell should wrap around the image.'));

  const cellW = '4680';

  // Row 1: wrapSquare bothSides / wrapSquare left
  const cell1 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId10',
      widthPx: 80,
      heightPx: 60,
      posXPx: 0,
      posYPx: 0,
      wrapType: 'wrapSquare',
      wrapText: 'bothSides',
      name: 'Cell-Square-Both',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );
  const cell2 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId11',
      widthPx: 80,
      heightPx: 60,
      posXPx: 150,
      posYPx: 0,
      wrapType: 'wrapSquare',
      wrapText: 'left',
      name: 'Cell-Square-Left',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );

  // Row 2: wrapTight / wrapTopAndBottom
  const cell3 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId12',
      widthPx: 80,
      heightPx: 60,
      posXPx: 0,
      posYPx: 0,
      wrapType: 'wrapTight',
      wrapText: 'right',
      name: 'Cell-Tight-Right',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );
  const cell4 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId13',
      widthPx: 100,
      heightPx: 50,
      posXPx: 50,
      posYPx: 0,
      wrapType: 'wrapTopAndBottom',
      name: 'Cell-TopAndBottom',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );

  // Row 3: wrapNone in front / wrapNone behind
  const cell5 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId14',
      widthPx: 60,
      heightPx: 50,
      posXPx: 80,
      posYPx: 5,
      wrapType: 'wrapNone',
      behindDoc: 0,
      name: 'Cell-InFront',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );
  const cell6 = tableCell(
    `<w:p><w:r>${buildAnchorImage({
      rId: 'rId10',
      widthPx: 120,
      heightPx: 80,
      posXPx: 30,
      posYPx: 0,
      wrapType: 'wrapNone',
      behindDoc: 1,
      name: 'Cell-Behind',
    })}</w:r><w:r><w:t xml:space="preserve">${SHORT_TEXT}</w:t></w:r></w:p>`,
    cellW
  );

  sections.push(`<w:tbl>
    <w:tblPr>
      <w:tblW w:w="9360" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${cellW}"/>
      <w:gridCol w:w="${cellW}"/>
    </w:tblGrid>
    <w:tr>${cell1}${cell2}</w:tr>
    <w:tr>${cell3}${cell4}</w:tr>
    <w:tr>${cell5}${cell6}</w:tr>
  </w:tbl>`);

  sections.push(separator());

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Edge cases
  // ══════════════════════════════════════════════════════════════════════════
  sections.push(heading('Section 5: Edge Cases', 1));

  // 5a. Very large image (wider than half page)
  sections.push(heading('5a. Large image — wider than half content area', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId14',
        widthPx: 400,
        heightPx: 120,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'bothSides',
        name: 'LargeImage',
      }),
      LOREM
    )
  );

  // 5b. Very small image
  sections.push(heading('5b. Small image (30x30)', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId12',
        widthPx: 30,
        heightPx: 30,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'bothSides',
        name: 'SmallImage',
      }),
      LOREM
    )
  );

  // 5c. Image with large wrap distances
  sections.push(heading('5c. Image with large wrap distances', 2));
  // We'll use explicit distance attributes in the XML
  {
    const id = docPrCounter++;
    const cx = 120 * EMU_PER_PIXEL;
    const cy = 90 * EMU_PER_PIXEL;
    // Large distances: 20px = 190500 EMU
    const distLarge = 190500;
    const imgXml = `<w:drawing>
  <wp:anchor distT="${distLarge}" distB="${distLarge}" distL="${distLarge}" distR="${distLarge}"
             simplePos="0" relativeHeight="251658240"
             behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
    <wp:extent cx="${cx}" cy="${cy}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapSquare wrapText="bothSides"/>
    <wp:docPr id="${id}" name="LargeDist"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="${id}" name="LargeDist"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="rId13" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>`;
    sections.push(imageWithText(imgXml, LOREM));
  }

  // 5d. Empty paragraph after floating image
  sections.push(heading('5d. Empty paragraph after floating image', 2));
  sections.push(
    imageWithText(
      buildAnchorImage({
        rId: 'rId10',
        widthPx: 120,
        heightPx: 200,
        posXPx: 0,
        posYPx: 0,
        wrapType: 'wrapSquare',
        wrapText: 'right',
        name: 'TallImage',
      }),
      SHORT_TEXT
    )
  );
  sections.push(`<w:p/>`);
  sections.push(`<w:p/>`);
  sections.push(para('This paragraph should still wrap around the tall image above if it vertically overlaps.'));

  // Section break
  sections.push(`<w:sectPr>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
  </w:sectPr>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 wp14">
  <w:body>
    ${sections.join('\n    ')}
  </w:body>
</w:document>`;
}

// ============================================================================
// XML PARTS
// ============================================================================

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
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
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/red.png"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/green.png"/>
  <Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/blue.png"/>
  <Relationship Id="rId13" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/orange.png"/>
  <Relationship Id="rId14" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/purple.png"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('Creating comprehensive float-wrap test DOCX...\n');

  const images = {
    'red.png': createSolidPng(200, 200, 220, 50, 50),
    'green.png': createSolidPng(200, 200, 50, 180, 80),
    'blue.png': createSolidPng(200, 200, 50, 80, 220),
    'orange.png': createSolidPng(200, 200, 240, 150, 30),
    'purple.png': createSolidPng(200, 200, 150, 50, 200),
  };

  const documentXml = buildDocumentXml();

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/document.xml', documentXml);

  for (const [filename, data] of Object.entries(images)) {
    zip.file(`word/media/${filename}`, data);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputPath = path.join(
    __dirname,
    '..',
    'examples',
    'vite',
    'public',
    'float-wrap-comprehensive-test.docx'
  );
  fs.writeFileSync(outputPath, buffer);

  console.log(`Output: ${outputPath}`);
  console.log(`Size:   ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log('\nSections:');
  console.log('  1. Wrap Types (page level): square, tight, through, topAndBottom, none');
  console.log('  2. Position Modes: align left/right/center, relative-to margin');
  console.log('  3. Multiple Floating Images: side-by-side, stacked');
  console.log('  4. Table Cells: all wrap types in cells');
  console.log('  5. Edge Cases: large/small images, large distances, empty paragraphs');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

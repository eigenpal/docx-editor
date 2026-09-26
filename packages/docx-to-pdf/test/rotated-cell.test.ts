/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const FAMILY = 'DejaVu Sans';
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

/** One 1in-wide, 2in-tall cell whose text reads bottom to top, beside an upright cell. */
const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2880"/></w:tblGrid>' +
  '<w:tr><w:trPr><w:trHeight w:val="2880" w:hRule="exact"/></w:trPr>' +
  '<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/><w:textDirection w:val="btLr"/>' +
  '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/></w:tcPr>' +
  paragraph('Up', '<w:rPr><w:highlight w:val="yellow"/></w:rPr>') +
  '</w:tc>' +
  `<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${paragraph('Flat')}</w:tc>` +
  '</w:tr></w:tbl>';

test('a btLr cell paints its text turned a quarter turn, reading up the page', async () => {
  const result = await exportPdf(docx(TABLE), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const stream = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  // The turn is a quarter turn counter-clockwise, applied once around the buffered text.
  expect(stream.match(/\n0 1 -1 0 [\d.-]+ [\d.-]+ cm\n/g)).toHaveLength(1);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const items = content.items.filter((item) => 'str' in item && item.str.trim());
    const up = items.find((item) => 'str' in item && item.str === 'Up');
    const flat = items.find((item) => 'str' in item && item.str === 'Flat');
    expect(up && 'transform' in up).toBe(true);
    expect(flat && 'transform' in flat).toBe(true);
    if (!up || !('transform' in up) || !flat || !('transform' in flat)) return;
    // Upright text advances along +x; the turned text advances along +y, up the page.
    expect(flat.transform[0]).toBeGreaterThan(0);
    expect(Math.abs(flat.transform[1]!)).toBeLessThan(1e-6);
    expect(Math.abs(up.transform[0]!)).toBeLessThan(1e-6);
    expect(up.transform[1]).toBeGreaterThan(0);
    // The turned run starts inside the cell: the cell spans x 72..144pt, and its text
    // starts near the cell's bottom (page y 720 - 144 = 576pt) and reads upward.
    expect(up.transform[4]).toBeGreaterThan(72);
    expect(up.transform[4]).toBeLessThan(144);
    expect(up.transform[5]).toBeGreaterThanOrEqual(576);
    expect(up.transform[5]).toBeLessThan(600);
  } finally {
    await pdf.destroy();
  }
});

const turnedCell = (properties: string, text: string, paragraphProperties = ''): string =>
  '<w:tc><w:tcPr><w:tcW w:w="850" w:type="dxa"/><w:textDirection w:val="btLr"/>' +
  `${properties}</w:tcPr><w:p><w:pPr><w:ind w:left="6" w:right="6"/>${paragraphProperties}` +
  `</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p></w:tc>`;
const turnedTable = (rows: string): string =>
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="850"/><w:gridCol w:w="850"/></w:tblGrid>${rows}</w:tbl><w:p/>`;

test.each([
  [
    'a centred merge head beside turned cells',
    turnedTable(
      '<w:tr><w:trPr><w:trHeight w:val="506"/></w:trPr>' +
        turnedCell('<w:vMerge w:val="restart"/>', 'Head', '<w:jc w:val="center"/>') +
        turnedCell('', 'Side', '<w:jc w:val="center"/>') +
        '</w:tr><w:tr><w:trPr><w:trHeight w:val="506"/></w:trPr>' +
        turnedCell('<w:vMerge/>', '') +
        turnedCell('', 'Next', '<w:jc w:val="center"/>') +
        '</w:tr>'
    ),
    ['Head', 'Side', 'Next'],
  ],
  [
    'a shaded paragraph in an auto-height turned cell',
    turnedTable(
      '<w:tr>' +
        turnedCell('', 'Shaded', '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>') +
        `<w:tc><w:tcPr><w:tcW w:w="850" w:type="dxa"/></w:tcPr>${paragraph('Flat')}</w:tc>` +
        '</w:tr>'
    ),
    ['Shaded', 'Flat'],
  ],
])('exports %s with every label', async (_name, body, labels) => {
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    for (const label of labels) expect(text).toContain(label);
  } finally {
    await pdf.destroy();
  }
});

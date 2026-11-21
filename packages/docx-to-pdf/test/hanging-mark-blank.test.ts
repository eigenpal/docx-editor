/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// 19 ideographs and a 12 pt mark take 240 pt on a 236 pt measure: only the mark's 6 pt blank
// half hangs. A 5 pt right indent leaves a 231 pt measure, and the whole mark hangs.
function hangingDocument(compression: string, underline: string, tracked = false): Uint8Array {
  const run =
    `<w:r><w:rPr><w:highlight w:val="yellow"/>` +
    (tracked ? '' : `<w:u w:val="${underline}" w:color="FF0000"/>`) +
    `</w:rPr><w:t>${'国'.repeat(19)}。余</w:t></w:r>`;
  const paragraph = (rightIndent: number) =>
    `<w:p><w:pPr><w:overflowPunct/><w:ind w:right="${rightIndent}"/><w:jc w:val="both"/></w:pPr>` +
    (tracked ? `<w:ins w:id="${rightIndent + 1}" w:author="Reviewer">${run}</w:ins>` : run) +
    '</w:p>';
  return docx(
    paragraph(0) +
      paragraph(100) +
      '<w:sectPr><w:pgSz w:w="7600" w:h="6000"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>',
    {
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/></Types>`,
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="s1" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="s2" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
      'word/styles.xml':
        `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        '<w:rFonts w:ascii="Noto Sans CJK JP" w:hAnsi="Noto Sans CJK JP" w:eastAsia="Noto Sans CJK JP"/>' +
        '<w:sz w:val="24"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
        '</w:docDefaults></w:styles>',
      'word/settings.xml':
        `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="${compression}"/>` +
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    }
  );
}

/** The right edge, in points from the page's left edge, of each line's highlight and underline. */
async function lineEnds(
  compression: string,
  underline = 'single',
  tracked = false
): Promise<{ fill: number[]; rule: number[] }> {
  const result = await exportPdf(
    hangingDocument(compression, underline, tracked),
    tracked ? { displayMode: 'all-markup' } : {}
  );
  const parsed = await PDFDocument.load(result.bytes);
  const commands = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
  const ends = (colour: string, thinOnly = false) => {
    const byLine = new Map<number, number>();
    for (const m of commands.matchAll(
      new RegExp(`${colour} rg ([\\d.-]+) ([\\d.-]+) ([\\d.-]+) ([\\d.-]+) re f`, 'g')
    )) {
      if (thinOnly && Number(m[4]) > 2) continue;
      const top = Math.round((Number(m[2]) + Number(m[4])) / 6);
      byLine.set(top, Math.max(byLine.get(top) ?? 0, Number(m[1]) + Number(m[3])));
    }
    // Lines top to bottom; the first line of each paragraph holds the hanging mark.
    return [...byLine.entries()].sort((a, b) => b[0] - a[0]).map(([, right]) => right);
  };
  // A revision underline takes its author's colour, so any thin rule counts.
  return {
    fill: ends('1 1 0'),
    rule: tracked ? ends('[\\d.]+ [\\d.]+ [\\d.]+', true) : ends('1 0 0'),
  };
}

test("a hanging mark's highlight and underline end before its compressed blank", async () => {
  const { fill, rule } = await lineEnds('compressPunctuation');
  // Line 1: only the blank half hangs, so the marks end at the 308 pt margin. Line 3: the whole
  // mark hangs from the 303 pt margin, and the marks end 6 pt past it.
  for (const ends of [fill, rule]) {
    expect(ends[0]).toBeCloseTo(308, 0);
    expect(ends[2]).toBeCloseTo(309, 0);
  }
});

test('a word underline ends before the compressed blank too', async () => {
  const { rule } = await lineEnds('compressPunctuation', 'words');
  expect(rule[0]).toBeCloseTo(308, 0);
  expect(rule[2]).toBeCloseTo(309, 0);
});

test('without compression the marks cover the whole hanging mark', async () => {
  const { fill, rule } = await lineEnds('doNotCompress');
  for (const ends of [fill, rule]) {
    expect(ends[0]).toBeCloseTo(320, 0);
    expect(ends[2]).toBeCloseTo(315, 0);
  }
});

test("a tracked insertion's revision underline ends before the compressed blank", async () => {
  const { fill, rule } = await lineEnds('compressPunctuation', 'single', true);
  for (const ends of [fill, rule]) {
    expect(ends[0]).toBeCloseTo(308, 0);
    expect(ends[2]).toBeCloseTo(309, 0);
  }
});

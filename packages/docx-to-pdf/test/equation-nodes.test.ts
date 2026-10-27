/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function equation(math: string): Uint8Array {
  return docx(
    `<w:p xmlns:m="${M}"><w:r><w:t xml:space="preserve">Before </w:t></w:r><m:oMath>${math}</m:oMath></w:p>`
  );
}

async function pageOf(bytes: Uint8Array) {
  const result = await exportPdf(bytes, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const operators = await page.getOperatorList();
  return { result, pdf, content, operators };
}

test('an overline equation paints its body and its bar', async () => {
  const { result, pdf, content, operators } = await pageOf(
    equation(
      '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e><m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr><w:sz w:val="18"/></w:rPr><m:t>AB</m:t></m:r></m:e></m:bar>'
    )
  );
  try {
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('equation-unsupported');
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toContain('AB');
    // The body text and the bar: the page holds one filled path besides the glyphs.
    const fills = operators.fnArray.filter((op, index) => {
      const painted = op === OPS.constructPath ? operators.argsArray[index]?.[0] : op;
      return painted === OPS.fill || painted === OPS.eoFill;
    });
    expect(fills.length).toBe(1);
  } finally {
    await pdf.destroy();
  }
});

test('equation digits paint in the authored text face that layout measured', async () => {
  const { pdf, content } = await pageOf(
    equation(
      '<m:r><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/></w:rPr><m:t>x12</m:t></m:r>'
    )
  );
  try {
    const digits = content.items.find((item) => 'str' in item && item.str.includes('12'));
    expect(digits).toBeDefined();
    const letter = content.items.find((item) => 'str' in item && /𝑥/u.test(item.str));
    expect(letter).toBeDefined();
    // The digits and the math letter come from different embedded faces.
    expect('fontName' in digits! && digits.fontName).not.toBe(
      'fontName' in letter! && letter.fontName
    );
  } finally {
    await pdf.destroy();
  }
});

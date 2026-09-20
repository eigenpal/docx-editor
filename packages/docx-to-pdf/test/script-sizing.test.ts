/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

// Saved Word 16.113 demo: 11pt super/subscript emits 6.96pt; 10pt note markers emit
// 6.48pt. Allow one 300-DPI device step (0.24pt), because Core retains fractional sizes.
for (const [size, wordSize] of [
  [11, 6.96],
  [10, 6.48],
] as const) {
  for (const verticalAlign of size === 11 ? ['superscript', 'subscript'] : ['superscript']) {
    test(`${size}pt ${verticalAlign} stays within one device step of the saved Word sizing`, async () => {
      const run = (text: string, extra = '') =>
        `<w:r><w:rPr><w:sz w:val="${size * 2}"/>${extra}</w:rPr><w:t>${text}</w:t></w:r>`;
      const input = docx(
        `<w:p>${run('BASE')}${run('SCRIPT', `<w:vertAlign w:val="${verticalAlign}"/>`)}${run('END')}</w:p>`
      );
      const result = await exportPdf(input, { useSystemFonts: false });
      const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
      try {
        const content = await (await pdf.getPage(1)).getTextContent();
        const items = content.items.filter((item) => 'str' in item);
        const script = items.find((item) => item.str === 'SCRIPT')!;
        const end = items.find((item) => item.str === 'END')!;
        expect(script).toBeDefined();
        expect(end).toBeDefined();
        expect(Math.abs(script.transform[3] - wordSize)).toBeLessThanOrEqual(0.24);
        // The next run begins where layout put it, within one device step of the painted
        // script end. It cannot be exact: the drawn size is rounded onto the 0.24pt grid the
        // reference emits sizes on, while the advances keep the size layout measured with.
        expect(Math.abs(end.transform[4] - (script.transform[4] + script.width))).toBeLessThan(
          0.24
        );
      } finally {
        await pdf.destroy();
      }
    });
  }
}

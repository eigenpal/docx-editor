/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The saved file as Latin-1 text: dictionaries are written uncompressed, so they are greppable. */
async function savedText(body: string, extras?: Record<string, string>): Promise<string> {
  const result = await exportPdf(docx(body, extras), { useSystemFonts: false });
  return Buffer.from(result.bytes).toString('latin1');
}

// `Registry` and `Ordering` are byte strings the consumer compares as bytes. Written as
// UTF-16BE text strings behind a BOM they still decode in pdf.js, and a byte-comparing consumer
// cannot match the CIDFont to its CMap. The same holds for a link's `URI`.
test('CIDSystemInfo is written as the byte strings (Adobe) and (Identity)', async () => {
  const text = await savedText(paragraph('Byte strings'));
  expect(text).toContain('/Registry (Adobe)');
  expect(text).toContain('/Ordering (Identity)');
  expect(text).not.toMatch(/\/Registry <FEFF/i);
  expect(text).not.toMatch(/\/Ordering <FEFF/i);
});

test('a link URI is written as an ASCII byte string, not a UTF-16BE text string', async () => {
  const href = 'https://example.com/a?b=1';
  const body =
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>open</w:t></w:r></w:hyperlink></w:p>` +
    paragraph('after');
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="${href}" TargetMode="External"/>` +
    `</Relationships>`;
  const text = await savedText(body, { 'word/_rels/document.xml.rels': rels });
  expect(text).toContain(`/URI (${href})`);
  expect(text).not.toMatch(/\/URI <FEFF/i);
});

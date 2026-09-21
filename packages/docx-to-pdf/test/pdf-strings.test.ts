/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
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

// `PDFString.of` writes its value verbatim. Without escaping, a `)` in an allowlisted href
// closes the URI string and everything after it is raw PDF inside the action dictionary,
// which is how a hyperlink becomes a `/JavaScript` action. The check is structural, on the
// parsed file: the one link action must still be a `URI` action whose string is the whole
// href, and no action anywhere on the page may carry a `JS` entry.
test('a hyperlink cannot break out of the URI string', async () => {
  const hostile = 'https://example.com/) /S /JavaScript /JS (app.alert(1';
  const body =
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>open</w:t></w:r></w:hyperlink></w:p>` +
    paragraph('after');
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="${hostile}" TargetMode="External"/>` +
    `</Relationships>`;
  const result = await exportPdf(docx(body, { 'word/_rels/document.xml.rels': rels }), {
    useSystemFonts: false,
  });
  const pdf = await PDFDocument.load(result.bytes);
  const annots = pdf.getPage(0).node.Annots();
  expect(annots).toBeDefined();
  let links = 0;
  for (let index = 0; index < annots!.size(); index += 1) {
    const annot = pdf.context.lookup(annots!.get(index), PDFDict);
    const action = annot.lookup(PDFName.of('A'), PDFDict);
    expect(action.lookup(PDFName.of('S'), PDFName).decodeText()).toBe('URI');
    expect(action.has(PDFName.of('JS'))).toBe(false);
    const uri = action.lookup(PDFName.of('URI'), PDFString);
    expect(uri.decodeText()).toBe(hostile);
    links += 1;
  }
  expect(links).toBe(1);
  // And at the byte level the string is one string: every bare `(` and `)` is escaped.
  const text = Buffer.from(result.bytes).toString('latin1');
  expect(text).toContain('/URI (https://example.com/\\) /S /JavaScript /JS \\(app.alert\\(1)');
});

test('a target outside printable ASCII is refused rather than approximated', async () => {
  const body =
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>open</w:t></w:r></w:hyperlink></w:p>` +
    paragraph('after');
  const rels =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/é" TargetMode="External"/>` +
    `</Relationships>`;
  const text = await savedText(body, { 'word/_rels/document.xml.rels': rels });
  expect(text).not.toContain('/URI (');
});

/**
 * One-off generator for the watermark parity fixture.
 *
 * Parses a simple base docx, stamps a diagonal "CONFIDENTIAL" text watermark
 * onto it via the public core API, and writes the result to
 * e2e/fixtures/watermark-confidential.docx. Run with:
 *
 *   bun scripts/create-watermark-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocx, repackDocx, setDocumentWatermark } from '../packages/core/src/headless.ts';

const base = path.resolve('e2e/fixtures/section-inheritance-header-footer.docx');
const out = path.resolve('e2e/fixtures/watermark-confidential.docx');

const buf = readFileSync(base);
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const doc = await parseDocx(arrayBuffer);
const withWatermark = setDocumentWatermark(doc, {
  kind: 'text',
  text: 'CONFIDENTIAL',
  font: 'Calibri',
  color: '#C0C0C0',
  semitransparent: true,
  layout: 'diagonal',
});

const bytes = await repackDocx(withWatermark, { updateModifiedDate: false });
writeFileSync(out, Buffer.from(bytes));
console.log(`Wrote ${out} (${bytes.byteLength} bytes)`);

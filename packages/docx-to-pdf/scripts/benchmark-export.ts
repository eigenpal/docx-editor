/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Isolated corpus worker. The parent enforces a hard wall-clock deadline. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportPdf, PdfFidelityError } from '../src/index.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: benchmark-export.ts input.docx output.pdf');
const source = new Uint8Array(await readFile(input));
const hash = () => createHash('sha256').update(source).digest('hex');
const before = hash();
const start = performance.now();
let report;
try {
  const result = await exportPdf(source, { timeoutMs: 45_000, displayMode: 'proposed' });
  await writeFile(output, result.bytes);
  report = {
    status: 'exported',
    pages: result.pageCount,
    bytes: result.bytes.length,
    diagnostics: result.diagnostics,
    fontResolution: result.fontResolution,
  };
} catch (error) {
  report = {
    status: error instanceof PdfFidelityError ? 'unsupported' : 'error',
    error: error instanceof Error ? error.message : String(error),
    diagnostics: error instanceof PdfFidelityError ? error.diagnostics : undefined,
  };
}
console.log(
  JSON.stringify({
    input,
    ...report,
    elapsedMs: performance.now() - start,
    peakRssBytes: process.resourceUsage().maxRSS * (process.platform === 'darwin' ? 1 : 1024),
    sourceSha256: before,
    sourceUnchanged: hash() === before,
  })
);

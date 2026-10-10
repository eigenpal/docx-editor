/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportPdf } from '../src/index.ts';
const output = resolve('.cache/pdf');
await mkdir(output, { recursive: true });
for (const path of [
  'examples/vite/public/sample.docx',
  'e2e/fixtures/header-with-table-and-paragraphs.docx',
  'e2e/fixtures/images-crop.docx',
  'e2e/fixtures/images-transform.docx',
  'e2e/fixtures/example-with-image.docx',
]) {
  const result = await exportPdf(new Uint8Array(await readFile(path)), {
    fidelityPolicy: 'best-effort',
  });
  const name = path.split('/').at(-1)!.replace('.docx', '.pdf');
  await writeFile(resolve(output, name), result.bytes);
  console.warn(name, result.pageCount, result.diagnostics);
}

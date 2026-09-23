/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Eval protocol, version 1. No document-model API additions. */
import { readFile, writeFile } from 'node:fs/promises';
import { exportPdf } from '../../src/index.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected input.docx output.pdf');
try {
  const result = await exportPdf(new Uint8Array(await readFile(input)), {
    fidelityPolicy: 'best-effort',
    displayMode: 'proposed',
    comments: false,
    useSystemFonts: false,
    glyphFallbacks: [
      'Noto Sans Symbols 2',
      'Noto Sans Math',
      'Noto Sans Arabic',
      'Noto Sans CJK JP',
      'Twemoji Mozilla',
      'Noto Emoji',
    ].map((family) => ({ family, weight: 400, style: 'normal' as const })),
    timeoutMs: 60_000,
  });
  await writeFile(output, result.bytes);
  console.log(
    JSON.stringify({
      protocol: 1,
      status: 'exported',
      pages: result.pageCount,
      diagnostics: result.diagnostics,
      fontResolution: result.fontResolution,
      timings: result.timings,
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      protocol: 1,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
}

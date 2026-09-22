/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Exercise packed artifacts outside workspace aliases. Build PDF and Markdown first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'pdf-consumer-'));
const packs = path.join(temporary, 'packs');
const consumer = path.join(temporary, 'consumer');
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  mkdirSync(packs);
  mkdirSync(consumer);
  const tarballs = ['i18n', 'core', 'fonts', 'docx-to-markdown', 'docx-to-pdf'].map((name) => {
    const [packed] = JSON.parse(
      run('npm', ['pack', path.join(root, 'packages', name), '--json', '--pack-destination', packs])
    );
    assert.ok(packed.filename);
    if (name === 'docx-to-pdf') {
      for (const guide of ['api', 'fonts', 'integrations', 'markdown-contract']) {
        assert.ok(
          packed.files.some((file) => file.path === `docs/${guide}.md`),
          `Packed PDF package omits docs/${guide}.md`
        );
      }
    }
    return path.join(packs, packed.filename);
  });
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' })
  );
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...tarballs,
    '@types/node@22',
  ]);
  const files = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Installed PDF conversion</w:t></w:r></w:p></w:body></w:document>',
  };
  writeFileSync(
    path.join(consumer, 'document.docx'),
    zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])))
  );
  const program = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportMarkdownFrom } from '@docx-editor.dev/docx-to-markdown';
import {
  createFontSource, defineFontResolver, exportPdf, openDocumentForExport, exportPdfFrom, PdfDocumentOpenError,
  PdfOutputLimitError, PdfPageLimitError, PdfEncodingError, ExportResourceError,
  type PdfExportOptions, type PdfExportResult, type PdfExportTimings,
  type PdfFontsSource, type ExportFontResolutionReport,
} from '@docx-editor.dev/docx-to-pdf';
async function main() {
  assert.equal(typeof createFontSource, 'function');
  const fonts: PdfFontsSource = defineFontResolver(() => ({ sources: [] }));
  const options: PdfExportOptions = { fonts, useSystemFonts: false, maxPages: 1 };
  const source = await readFile('document.docx');
  const opened = await openDocumentForExport(source, { fonts, useSystemFonts: false });
  assert.ok(opened.ok);
  try {
    const sharedPdf = await exportPdfFrom(opened.session);
    const sharedMarkdown = await exportMarkdownFrom(opened.session);
    assert.equal(sharedPdf.pageCount, sharedMarkdown.pages.length);
    assert.equal(sharedPdf.displayMode, sharedMarkdown.pagination.displayMode);
    assert.equal(sharedPdf.fontResolution, sharedMarkdown.fontResolution);
    assert.ok(sharedMarkdown.markdown.includes('Installed PDF conversion'));
  } finally { opened.session.dispose(); }
  await assert.rejects(exportPdfFrom(opened.session), (error: unknown) =>
    error instanceof ExportResourceError && error.code === 'disposed');
  const result: PdfExportResult = await exportPdf(source, options);
  const timings: PdfExportTimings = result.timings;
  const report: ExportFontResolutionReport = result.fontResolution;
  assert.equal(Buffer.from(result.bytes.subarray(0, 5)).toString(), '%PDF-');
  assert.equal(result.pageCount, 1);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(timings.openMs >= 0 && report.families.length > 0);
  const response = new Response(new Uint8Array(result.bytes), {
    headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal((await response.arrayBuffer()).byteLength, result.bytes.byteLength);
  await assert.rejects(exportPdf(source, { ...options, maxOutputBytes: 1 }), (error: unknown) =>
    error instanceof PdfOutputLimitError && error instanceof PdfEncodingError &&
    error.code === 'outputTooLarge' && error.limit === 1);
  await assert.rejects(exportPdf(new Uint8Array([1])), PdfDocumentOpenError);
  await assert.rejects(exportPdf(source, { signal: AbortSignal.abort() }), ExportResourceError);
  assert.ok(new PdfPageLimitError(1, 2) instanceof RangeError);
  console.log('Packed PDF consumer passed');
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
`;
  for (const extension of ['mts', 'cts']) {
    writeFileSync(path.join(consumer, `convert.${extension}`), program);
    writeFileSync(
      path.join(consumer, `tsconfig.${extension}.json`),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: false,
          types: ['node'],
          outDir: 'out',
        },
        files: [`convert.${extension}`],
      })
    );
    run('node', [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      `tsconfig.${extension}.json`,
    ]);
    process.stdout.write(run('node', [`out/convert.${extension === 'mts' ? 'mjs' : 'cjs'}`]));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Run with Bun. LibreOffice, Poppler, and Python 3 must be installed. No fixture is modified. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
const exec = promisify(execFile);
const input = resolve(process.argv[2] ?? '../../examples/vite/public/sample.docx');
const output = resolve(process.argv[3] ?? '../../.cache/pdf/libreoffice-comparison');
const run = (bin: string, args: string[]) =>
  exec(bin, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Use an empty comparison output directory');
await mkdir(join(output, 'reference'), { recursive: true });
await mkdir(join(output, 'native'), { recursive: true });
{
  const version = (await run('soffice', ['--version'])).stdout.trim();
  const result = await exportPdf(new Uint8Array(await readFile(input)), {
    displayMode: 'proposed',
  });
  const nativePath = join(output, 'native.pdf');
  await writeFile(nativePath, result.bytes);
  const referencePath = join(output, 'reference', basename(input).replace(/\.docx$/i, '.pdf'));
  await run('python3', [
    fileURLToPath(new URL('./libreoffice_reference.py', import.meta.url)),
    input,
    referencePath,
  ]);
  async function extract(path: string) {
    const pdf = await getDocument({
      data: new Uint8Array(await readFile(path)),
      useSystemFonts: false,
    }).promise;
    try {
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push({
          width: page.view[2]! - page.view[0]!,
          height: page.view[3]! - page.view[1]!,
          text: content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .normalize('NFC'),
        });
      }
      return pages;
    } finally {
      await pdf.destroy();
    }
  }
  const [reference, native] = await Promise.all([extract(referencePath), extract(nativePath)]);
  await Promise.all([
    run('pdftoppm', [
      '-scale-to',
      '1100',
      '-png',
      referencePath,
      join(output, 'reference', 'page'),
    ]),
    run('pdftoppm', ['-scale-to', '1100', '-png', nativePath, join(output, 'native', 'page')]),
  ]);
  const report = {
    input,
    version,
    options: { useSystemFonts: true, displayMode: 'proposed' },
    referenceDisplayMode: 'proposed-no-markup',
    referencePages: reference.length,
    nativePages: native.length,
    diagnostics: result.diagnostics,
    fontResolution: result.fontResolution,
    pages: native.map((page, i) => ({
      page: i + 1,
      native: page,
      reference: reference[i] ?? null,
    })),
    note: 'Equal page counts and complete text do not prove visual fidelity. Review the paired pages and overlay. LibreOffice and Word can differ.',
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
    );
  const pages = Array.from({ length: Math.max(native.length, reference.length) }, (_, i) => {
    const filename = `page-${String(i + 1).padStart(String(Math.max(native.length, reference.length)).length, '0')}.png`;
    return `<section><h2>Page ${i + 1}</h2><div class="pair"><figure><figcaption>LibreOffice</figcaption>${i < reference.length ? `<img loading="lazy" src="reference/${filename}">` : ''}</figure><figure><figcaption>Native exporter</figcaption>${i < native.length ? `<img loading="lazy" src="native/${filename}">` : ''}</figure></div></section>`;
  }).join('');
  await writeFile(
    join(output, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>DOCX PDF comparison</title><style>body{font:16px system-ui;background:#eee;margin:24px}header{position:sticky;top:0;background:#fff;padding:16px;z-index:1}.pair{display:flex;gap:16px}figure{margin:0;width:50%}img{width:100%;background:#fff}h2{margin:24px 0 8px}.overlay .pair{position:relative}.overlay figure{width:65%}.overlay figure+figure{position:absolute;top:0;left:0;opacity:.5}.overlay figcaption{display:none}</style><header><b>${escape(basename(input))}</b> — ${escape(version)}: ${reference.length} pages; native: ${native.length} pages. <label><input type="checkbox" onchange="document.body.classList.toggle('overlay',this.checked)">Overlay</label><p>${escape(report.note)}</p><a href="report.json">Full text, fonts, and diagnostics</a></header>${pages}`
  );
  console.warn(
    JSON.stringify(
      {
        output,
        referencePages: reference.length,
        nativePages: native.length,
        diagnostics: result.diagnostics,
      },
      null,
      2
    )
  );
}

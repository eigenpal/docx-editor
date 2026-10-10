/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportMarkdown, type MarkdownExportOptions } from '../../docx-to-markdown/src/index.ts';
import {
  createFontSource,
  exportPdf,
  ExportResourceError,
  type PdfExportOptions,
} from '../src/index.ts';
import { docx } from './fixture.ts';

const input = docx(`<w:p>
  <w:del w:id="1"><w:r><w:delText>Removed text</w:delText></w:r></w:del>
  <w:ins w:id="2"><w:r><w:t>Inserted text</w:t></w:r></w:ins>
</w:p>`);

async function sharedFonts() {
  const bytes = new Uint8Array(
    await readFile(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
    )
  );
  const admitted = createFontSource(bytes, { family: 'Calibri', weight: 400, style: 'normal' });
  if ('failure' in admitted) throw new Error(admitted.failure.reason);
  return { sources: [admitted.source] };
}

for (const displayMode of ['proposed', 'original'] as const) {
  test(`shared ${displayMode} options preserve content and font selection across formats`, async () => {
    const options = {
      displayMode,
      fonts: await sharedFonts(),
      fontPolicy: 'best-effort',
      resourceTimeoutMs: 15_000,
      signal: new AbortController().signal,
    } satisfies MarkdownExportOptions & PdfExportOptions;
    const markdown = await exportMarkdown(input, options);
    const pdf = await exportPdf(input, {
      ...options,
      useSystemFonts: false,
      documentLigatures: false,
    });
    expect(pdf.displayMode).toBe(markdown.pagination.displayMode);
    expect(pdf.layoutRevision).toBe(markdown.pagination.layoutRevision);
    expect(pdf.pageCount).toBe(markdown.pages.length);
    const regular = (report: typeof pdf.fontResolution | null) =>
      report?.families
        .find((entry) => entry.family === 'Calibri')
        ?.faces.find((face) => face.weight === 400 && face.style === 'normal');
    expect(regular(pdf.fontResolution)?.hash).toBeTruthy();
    expect(regular(pdf.fontResolution)?.hash).toBe(regular(markdown.fontResolution)?.hash);
    const visible = displayMode === 'proposed' ? 'Inserted text' : 'Removed text';
    const hidden = displayMode === 'proposed' ? 'Removed text' : 'Inserted text';
    expect(markdown.markdown).toContain(visible);
    expect(markdown.markdown).not.toContain(hidden);
    const document = await getDocument({ data: pdf.bytes.slice(), useSystemFonts: false }).promise;
    try {
      const text = (await (await document.getPage(1)).getTextContent()).items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join('');
      expect(text).toContain(visible);
      expect(text).not.toContain(hidden);
    } finally {
      await document.destroy();
    }
  });
}

test('both one-shot converters expose shared cancellation codes and causes', async () => {
  const cause = new Error('Shared request cancelled');
  const options = { signal: AbortSignal.abort(cause) };
  for (const convert of [exportMarkdown, exportPdf]) {
    await expect(convert(input, options)).rejects.toBeInstanceOf(ExportResourceError);
    await expect(convert(input, options)).rejects.toMatchObject({ code: 'aborted', cause });
  }
});

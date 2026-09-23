/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, spyOn, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import {
  createFontSource,
  defineFontResolver,
  exportPdf,
  ExportResourceError,
  PdfDocumentOpenError,
  PdfEncodingError,
  PdfFidelityError,
  PdfOutputLimitError,
  PdfPageLimitError,
  type PdfExportOptions,
} from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const source = docx(paragraph('Developer API'));
const deterministic = { useSystemFonts: false } as const;

test('JavaScript option errors precede document parsing and font work', async () => {
  let calls = 0;
  const fonts = defineFontResolver(() => {
    calls++;
    return { sources: [] };
  });
  for (const invalid of [
    { fontPolicy: 'silently-approximate' },
    { displayMode: 'hidden' },
    { fidelityPolicy: 'ignore' },
    { comments: 'false' },
    { useSystemFonts: 0 },
    { documentLigatures: 'true' },
    { onFontResolution: true },
    { convertPreservedImage: true },
    { imageDecodePort: null },
    { imageDecodePort: {} },
    { imageDecodePort: { decode: true } },
    { signal: {} },
    { signal: null },
    { timeoutMs: NaN },
    { timeoutMs: null },
    { maxOutputBytes: 0 },
    { maxOutputBytes: 67_108_865 },
    { maxPages: 0 },
    { maxPages: 10_001 },
    { maxPages: 1.5 },
    { resourceTimeoutMs: Infinity },
    { fontResolutionTimeoutMs: 2_147_483_648 },
    { measurer: {} },
    { producer: 'custom' },
    { reuseAcrossRevisions: true },
  ]) {
    try {
      await exportPdf(new Uint8Array([1]), { fonts, ...invalid } as PdfExportOptions);
      throw new Error('Invalid options were accepted');
    } catch (error) {
      expect(error instanceof TypeError || error instanceof RangeError).toBe(true);
      expect(error).not.toBeInstanceOf(PdfEncodingError);
    }
  }
  expect(calls).toBe(0);
  for (const invalid of [null, [], false, 'options']) {
    await expect(exportPdf(source, invalid as unknown as PdfExportOptions)).rejects.toBeInstanceOf(
      TypeError
    );
  }
});

test('page and output limits return actionable errors and preserve superclass checks', async () => {
  const pages = docx(
    paragraph('First') +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Second</w:t></w:r></w:p>'
  );
  await expect(exportPdf(pages, { ...deterministic, maxPages: 1 })).rejects.toMatchObject({
    name: 'PdfPageLimitError',
    code: 'pageLimitExceeded',
    limit: 1,
    actual: 2,
  });
  await expect(exportPdf(pages, { ...deterministic, maxPages: 1 })).rejects.toBeInstanceOf(
    PdfPageLimitError
  );
  const result = await exportPdf(pages, { ...deterministic, maxPages: 2 });
  expect(result.pageCount).toBe(2);
  await expect(
    exportPdf(pages, { ...deterministic, maxOutputBytes: result.bytes.length - 1 })
  ).rejects.toMatchObject({
    code: 'outputTooLarge',
    limit: result.bytes.length - 1,
    actual: result.bytes.length,
  });
  const equal = await exportPdf(pages, { ...deterministic, maxOutputBytes: result.bytes.length });
  expect(equal.bytes).toEqual(result.bytes);
  expect(new PdfOutputLimitError(1, 2)).toBeInstanceOf(PdfEncodingError);
  expect(new PdfPageLimitError(1, 2)).toBeInstanceOf(RangeError);
});

test('font source failures remain visible when another source supplies the font', async () => {
  const failure = new Error('Application font source failed');
  const fonts = defineFontResolver(() => {
    throw failure;
  });
  const result = await exportPdf(source, { ...deterministic, fonts });
  expect(result.fontResolution.originFailures).toHaveLength(1);
  expect(result.fontResolution.originFailures[0]!.cause).toBe(failure);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'font-origin-failed',
      severity: 'information',
    })
  );
  await expect(
    exportPdf(source, { ...deterministic, fonts, fontPolicy: 'strict' })
  ).rejects.toBeInstanceOf(ExportResourceError);
});

test('lastResortFonts resolves a missing family before generic substitutes', async () => {
  const bytes = new Uint8Array(
    await readFile(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
    )
  );
  const admitted = createFontSource(bytes, {
    family: 'Application Sans',
    weight: 400,
    style: 'normal',
  });
  if ('failure' in admitted) throw new Error(admitted.failure.reason);
  const input = docx(
    paragraph(
      'Custom font',
      '<w:rPr><w:rFonts w:ascii="Application Sans" w:hAnsi="Application Sans"/></w:rPr>'
    )
  );
  const result = await exportPdf(input, {
    ...deterministic,
    lastResortFonts: { sources: [admitted.source] },
  });
  const family = result.fontResolution.families.find(
    (entry) => entry.family === 'Application Sans'
  );
  expect(
    family?.faces.some((face) => face.sourceFamily === 'Application Sans' && face.via === 'direct')
  ).toBe(true);
  expect(result.diagnostics.some((entry) => entry.code === 'font-substitution')).toBe(false);
});

test('stable failure codes cover input and fidelity refusals', async () => {
  await expect(exportPdf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
    code: 'documentOpenFailed',
  });
  await expect(exportPdf(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfDocumentOpenError);
  const unsupported = docx(paragraph('Text', '<w:rPr><w:u w:val="unsupported"/></w:rPr>'));
  await expect(exportPdf(unsupported, deterministic)).rejects.toBeInstanceOf(PdfFidelityError);
  await expect(exportPdf(unsupported, deterministic)).rejects.toMatchObject({
    code: 'fidelityUnsupported',
  });
  const result = await exportPdf(unsupported, { ...deterministic, fidelityPolicy: 'best-effort' });
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test('abort during a font wait preserves the cause and permits a later conversion', async () => {
  const controller = new AbortController();
  const reason = new Error('Request disconnected');
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fonts = defineFontResolver(() => {
    started();
    return new Promise<never>(() => {});
  });
  const conversion = exportPdf(source, { ...deterministic, fonts, signal: controller.signal });
  await ready;
  controller.abort(reason);
  await expect(conversion).rejects.toMatchObject({ code: 'aborted', cause: reason });
  expect((await exportPdf(source, deterministic)).pageCount).toBe(1);
});

test('encoder TypeErrors retain their cause inside PdfEncodingError', async () => {
  const cause = new TypeError('Encoder failure');
  const create = spyOn(PDFDocument, 'create').mockRejectedValueOnce(cause);
  try {
    await expect(exportPdf(source, deterministic)).rejects.toMatchObject({
      name: 'PdfEncodingError',
      code: 'encodingFailed',
      cause,
    });
  } finally {
    create.mockRestore();
  }
  expect((await exportPdf(source, deterministic)).pageCount).toBe(1);
});

test('image-wait deadlines report timedOut', async () => {
  const input = new Uint8Array(
    await readFile(new URL('../../../e2e/fixtures/images-crop.docx', import.meta.url))
  );
  let decoding = false;
  await expect(
    exportPdf(input, {
      ...deterministic,
      timeoutMs: 2_000,
      resourceTimeoutMs: 60_000,
      imageDecodePort: {
        decode() {
          decoding = true;
          return new Promise<never>(() => {});
        },
      },
    })
  ).rejects.toMatchObject({ code: 'timedOut' });
  expect(decoding).toBe(true);
}, 10_000);

test('caller cancellation during an image wait preserves its cause', async () => {
  const input = new Uint8Array(
    await readFile(new URL('../../../e2e/fixtures/images-crop.docx', import.meta.url))
  );
  const controller = new AbortController();
  const reason = new Error('Request disconnected during image decoding');
  await expect(
    exportPdf(input, {
      ...deterministic,
      signal: controller.signal,
      imageDecodePort: {
        decode() {
          queueMicrotask(() => controller.abort(reason));
          return new Promise<never>(() => {});
        },
      },
    })
  ).rejects.toMatchObject({ code: 'aborted', cause: reason });
  expect((await exportPdf(source, deterministic)).pageCount).toBe(1);
});

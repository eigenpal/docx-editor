/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Node-first DOCX-to-PDF conversion using Core's positioned glyphs. @packageDocumentation */
import { PDFDocument } from 'pdf-lib';
import {
  createPackagedFileFetch,
  ExportResourceError,
  openFontBackedDocumentForExport,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import { MAX_OUTPUT_BYTES, positiveLimit, Work } from './context.ts';
import { paint } from './paint.ts';
import { installedWordFonts, supplementalFonts, PDF_GLYPH_FALLBACKS } from './font-provisioning.ts';
import {
  PdfDocumentOpenError,
  PdfEncodingError,
  PdfFidelityError,
  type PdfExportOptions,
  type PdfExportResult,
} from './types.ts';
export { PdfDocumentOpenError, PdfEncodingError, PdfFidelityError } from './types.ts';
export type { PdfDiagnostic, PdfExportOptions, PdfExportResult } from './types.ts';
export { ExportResourceError } from '@docx-editor.dev/core/export';
const bundledFonts = packagedFonts({
  install: false,
  fetcher: createPackagedFileFetch({
    trustedRoot: new URL('./', FONT_ASSET_ROOT),
    maxBytes: HARD_MAX_FONT_BYTES,
  }),
});

/** Convert DOCX bytes without modifying the source document. Defaults to strict, proposed view, and native comments. @public */
export async function exportPdf(
  source: Uint8Array,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  if (!(source instanceof Uint8Array)) throw new TypeError('source must be a Uint8Array');
  if (
    options.fidelityPolicy !== undefined &&
    !['strict', 'best-effort'].includes(options.fidelityPolicy)
  )
    throw new RangeError('Invalid fidelityPolicy');
  if (
    options.displayMode !== undefined &&
    !['proposed', 'original', 'all-markup'].includes(options.displayMode)
  )
    throw new RangeError('Invalid displayMode');
  if (options.useSystemFonts !== undefined && typeof options.useSystemFonts !== 'boolean')
    throw new TypeError('useSystemFonts must be boolean');
  if (options.comments !== undefined && typeof options.comments !== 'boolean')
    throw new TypeError('comments must be boolean');
  const timeoutMs = positiveLimit(options.timeoutMs ?? 60_000, 2_147_483_647, 'timeoutMs');
  const maxBytes = positiveLimit(
    options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
    MAX_OUTPUT_BYTES,
    'maxOutputBytes'
  );
  const controller = new AbortController();
  const abort = (): void =>
    controller.abort(
      new ExportResourceError('aborted', 'PDF conversion aborted', {
        cause: options.signal?.reason,
      })
    );
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new ExportResourceError('timedOut', 'PDF conversion timed out')),
    timeoutMs
  );
  const work = new Work(controller.signal, Date.now() + timeoutMs);
  const {
    comments = true,
    fidelityPolicy = 'strict',
    fonts,
    fallbackFonts,
    useSystemFonts = true,
    timeoutMs: _timeout,
    maxOutputBytes: _max,
    ...core
  } = options;
  try {
    work.check();
    const opened = await openFontBackedDocumentForExport(source, {
      documentLigatures: true,
      ...core,
      signal: controller.signal,
      displayMode: options.displayMode ?? 'proposed',
      reuseAcrossRevisions: false,
      glyphFallbacks: options.glyphFallbacks ?? PDF_GLYPH_FALLBACKS,
      fonts: [
        ...(fonts ? (Array.isArray(fonts) ? fonts : [fonts]) : []),
        ...(useSystemFonts ? [installedWordFonts] : []),
        bundledFonts,
        ...(fallbackFonts ? (Array.isArray(fallbackFonts) ? fallbackFonts : [fallbackFonts]) : []),
        supplementalFonts,
      ],
    });
    if (!opened.ok) throw new PdfDocumentOpenError(opened.reason, opened.detail);
    try {
      work.check();
      const layout = await opened.session.layout();
      if (layout.pages.length > 10_000) throw new RangeError('PDF page limit exceeded');
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.setProducer('docx-editor.dev');
      doc.setCreator('docx-editor.dev');
      const date = new Date('2020-01-01T00:00:00Z');
      doc.setCreationDate(date);
      doc.setModificationDate(date);
      const metadata = layout.documentMetadata;
      if (metadata?.title) doc.setTitle(metadata.title);
      if (metadata?.creator) doc.setAuthor(metadata.creator);
      if (metadata?.subject) doc.setSubject(metadata.subject);
      if (metadata?.keywords) doc.setKeywords([metadata.keywords]);
      await paint(doc, opened.session, layout, work, comments);
      const diagnostics = Object.freeze([...work.diagnostics]);
      if (fidelityPolicy === 'strict' && diagnostics.some((d) => d.severity !== 'information'))
        throw new PdfFidelityError(diagnostics);
      work.check();
      const bytes = await doc.save({ useObjectStreams: false, objectsPerTick: 50 });
      work.check();
      if (bytes.byteLength > maxBytes)
        throw new PdfEncodingError(`PDF exceeds maxOutputBytes (${maxBytes})`);
      return Object.freeze({
        bytes,
        pageCount: layout.pages.length,
        layoutRevision: layout.revision,
        displayMode: options.displayMode ?? 'proposed',
        fontResolution: opened.session.fontResolution,
        diagnostics,
      });
    } finally {
      opened.session.dispose();
    }
  } catch (error) {
    work.check();
    if (
      error instanceof PdfFidelityError ||
      error instanceof PdfDocumentOpenError ||
      error instanceof ExportResourceError ||
      error instanceof RangeError ||
      error instanceof PdfEncodingError
    )
      throw error;
    throw new PdfEncodingError('PDF encoding failed', { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Node-first DOCX-to-PDF conversion using Core's positioned glyphs. @packageDocumentation */
import { PDFDocument } from 'pdf-lib';
import type { ExportFontResolutionReport } from '@docx-editor.dev/core/export';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { MAX_OUTPUT_BYTES, positiveLimit, Work, PdfWorkLimitError } from './context.ts';
import { paint } from './paint.ts';
import { isGenericSubstitution } from './font-provisioning.ts';
import { openExportSession } from './open-session.ts';
import {
  PdfDocumentOpenError,
  PdfEncodingError,
  PdfFidelityError,
  type PdfExportOptions,
  type PdfExportResult,
} from './types.ts';
export { PdfDocumentOpenError, PdfEncodingError, PdfFidelityError } from './types.ts';
export { PdfWorkLimitError } from './context.ts';
export type { PdfDiagnostic, PdfExportOptions, PdfExportResult } from './types.ts';
export { ExportResourceError } from '@docx-editor.dev/core/export';
/**
 * Say which families render in a stand-in face of another family's metrics. Word's own
 * metric-compatible substitutions (Calibri in Carlito and the like) are silent, as they are
 * in Word; a family this package only knows by name is not, and the report is `unsupported`.
 */
function reportGenericSubstitutions(resolution: ExportFontResolutionReport, work: Work): void {
  for (const family of resolution.families) {
    const stand = family.faces.find(
      (face) =>
        face.via === 'substitution' && isGenericSubstitution(family.family, face.sourceFamily)
    );
    if (stand)
      // Not information: the stand-in's metrics move line breaks and page count, so a strict
      // export refuses rather than paginate in another font. Best effort renders and says so.
      work.report(
        'font-substitution',
        `${family.family} is not available; best-effort export renders it in ${stand.sourceFamily}`
      );
  }
}

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
  const { comments = true, fidelityPolicy = 'strict', ...session } = options;
  try {
    work.check();
    const clock = performance.now();
    const phase = () => Math.round(performance.now() - clock);
    const opened = await openExportSession(source, session, controller.signal);
    if (!opened.ok) throw new PdfDocumentOpenError(opened.reason, opened.detail);
    try {
      work.check();
      const openMs = phase();
      const layout = await opened.session.layout();
      const layoutMs = phase() - openMs;
      if (layout.pages.length > 10_000) throw new RangeError('PDF page limit exceeded');
      reportGenericSubstitutions(opened.session.fontResolution, work);
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
      const paintMs = phase() - openMs - layoutMs;
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
        timings: Object.freeze({
          openMs,
          layoutMs,
          paintMs,
          saveMs: phase() - openMs - layoutMs - paintMs,
        }),
      });
    } finally {
      opened.session.dispose();
    }
  } catch (error) {
    // A typed export error is the answer, whatever the clock says now: a fidelity refusal
    // that lands after the deadline is still a fidelity refusal, not a timeout. The one
    // exception is an open that failed BECAUSE the signal fired mid-open; that failure is the
    // deadline or the abort wearing another name, and `check` throws the right one.
    if (error instanceof PdfDocumentOpenError && error.reason === 'aborted') work.check();
    // Only an untyped failure asks the budget whether a deadline or an abort is the story.
    if (
      error instanceof PdfFidelityError ||
      error instanceof PdfDocumentOpenError ||
      error instanceof ExportResourceError ||
      error instanceof RangeError ||
      error instanceof PdfEncodingError ||
      // A blown operation or diagnostic budget is its own answer, not an encoding failure.
      error instanceof PdfWorkLimitError
    )
      throw error;
    work.check();
    throw new PdfEncodingError('PDF encoding failed', { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

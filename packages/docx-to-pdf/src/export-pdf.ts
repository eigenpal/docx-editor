/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument } from 'pdf-lib';
import { hasFontBackedExportCapabilities } from '@docx-editor.dev/core/export';
import { validateOptions } from './options.ts';
import { openExportSession } from './open-session.ts';
import { reportFontDiagnostics } from './font-diagnostics.ts';
import { paint } from './paint.ts';
import { withPdfWork, waitForPdfWork } from './pdf-work.ts';
import type { Work } from './context.ts';
import {
  PdfDocumentOpenError,
  PdfFidelityError,
  PdfPageLimitError,
  PdfOutputLimitError,
  type PdfExportOptions,
  type PdfProjectionOptions,
  type PdfExportSession,
  type PdfExportResult,
} from './types.ts';

/** Convert DOCX bytes. Disposes its session after success or failure. @public */
export async function exportPdf(
  source: Uint8Array,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  if (!(source instanceof Uint8Array)) throw new TypeError('source must be a Uint8Array');
  validateOptions(options);
  return withPdfWork(options, async (work, phase) => {
    const {
      comments: _comments,
      fidelityPolicy: _fidelity,
      timeoutMs: _timeout,
      maxOutputBytes: _bytes,
      maxPages: _pages,
      ...open
    } = options;
    const opened = await openExportSession(source, open, work.signal);
    if (!opened.ok) throw new PdfDocumentOpenError(opened.reason, opened.detail);
    try {
      return await renderSession(opened.session, options, work, phase, phase());
    } finally {
      opened.session.dispose();
    }
  });
}

/**
 * Encode a caller-owned font-backed session without reopening the document.
 * Does not dispose the session. The caller must dispose it after all exports.
 * Cancellation stops this export; the session's signal controls shared resource work.
 * @public
 */
export async function exportPdfFrom(
  session: PdfExportSession,
  options: PdfProjectionOptions = {}
): Promise<PdfExportResult> {
  validateOptions(options);
  for (const key of Object.keys(options)) {
    if (
      ![
        'comments',
        'fidelityPolicy',
        'timeoutMs',
        'maxOutputBytes',
        'maxPages',
        'signal',
        'displayMode',
      ].includes(key)
    )
      throw new TypeError(`${key} must be configured when opening the PDF session`);
  }
  if (
    !session ||
    typeof session !== 'object' ||
    !hasFontBackedExportCapabilities(session) ||
    typeof session.layout !== 'function' ||
    typeof session.layoutFor !== 'function' ||
    !session.fontResolution
  )
    throw new TypeError('exportPdfFrom requires a font-backed export session');
  return withPdfWork(options, (work, phase) => renderSession(session, options, work, phase, 0));
}

async function renderSession(
  session: PdfExportSession,
  options: PdfProjectionOptions,
  work: Work,
  phase: () => number,
  openMs: number
): Promise<PdfExportResult> {
  const { maxBytes, maxPages } = validateOptions(options);
  const { comments = true, fidelityPolicy = 'strict' } = options;
  work.check();
  const layout = await waitForPdfWork(
    () => (options.displayMode ? session.layoutFor(options.displayMode) : session.layout()),
    work
  );
  const layoutMs = phase() - openMs;
  if (layout.pages.length > maxPages) throw new PdfPageLimitError(maxPages, layout.pages.length);
  reportFontDiagnostics(session.fontResolution, work);
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
  await paint(doc, session, layout, work, comments);
  const paintMs = phase() - openMs - layoutMs;
  const diagnostics = Object.freeze([...work.diagnostics]);
  if (fidelityPolicy === 'strict' && diagnostics.some((d) => d.severity !== 'information'))
    throw new PdfFidelityError(diagnostics);
  work.check();
  // pdf-lib yields with `setTimeout(0)` between batches, which costs at least a millisecond
  // each on Node. A batch of a thousand objects takes milliseconds for text pages and tens of
  // milliseconds for large images. The deadline and signal are checked again after the save.
  const bytes = await doc.save({ useObjectStreams: false, objectsPerTick: 1000 });
  work.check();
  if (bytes.byteLength > maxBytes) throw new PdfOutputLimitError(maxBytes, bytes.byteLength);
  return Object.freeze({
    bytes,
    pageCount: layout.pages.length,
    layoutRevision: layout.revision,
    displayMode: layout.displayMode ?? 'proposed',
    fontResolution: session.fontResolution,
    diagnostics,
    timings: Object.freeze({
      openMs,
      layoutMs,
      paintMs,
      saveMs: phase() - openMs - layoutMs - paintMs,
    }),
  });
}

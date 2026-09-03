/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  createPackagedFileFetch,
  ExportResourceError,
  openFontBackedDocumentForExport,
  type FontBackedExportCapabilities,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import {
  createFidelityDiagnosticCollector,
  type PdfFidelityDiagnostic,
  type PdfFidelityDiagnosticCollector,
} from './pdf-fidelity-diagnostics.ts';
import type {
  PdfExportOptions,
  PdfExportResult,
  PdfFontOrigin,
  PdfFontsSource,
} from './pdf-export-types.ts';
import { PdfDocumentOpenError, PdfFidelityError } from './pdf-export-types.ts';
import { planPdfPaintFromLayout } from './pdf-page-planner.ts';
import { writePdfPaintPlanToBytes } from './pdfkit-paint-writer.ts';
import { HARD_MAX_OUTPUT_BYTES, validateOutputByteLimit } from './pdf-paint-bounds.ts';
import type { PdfAdmittedFont } from './pdf-paint-writer-port.ts';

const packagedFileFetch = createPackagedFileFetch({
  trustedRoot: new URL('./', FONT_ASSET_ROOT),
  maxBytes: HARD_MAX_FONT_BYTES,
});

const packagedExportFonts = packagedFonts({
  fetcher: packagedFileFetch,
  install: false,
});

function fontOrigins(source: PdfFontsSource | undefined): readonly PdfFontOrigin[] {
  if (source === undefined) return [];
  return Array.isArray(source) ? source : [source as PdfFontOrigin];
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  throw new ExportResourceError('aborted', message, { cause: signal.reason });
}

function hasVisibleFidelityIssue(diagnostics: readonly PdfFidelityDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.kind === 'unsupported' || diagnostic.kind === 'approximation'
  );
}

function admittedFonts(session: FontBackedExportCapabilities): readonly PdfAdmittedFont[] {
  const byteResources = new Map<string, Uint8Array>();
  const fonts = new Map<string, PdfAdmittedFont>();
  for (const family of session.fontResolution.families) {
    for (const face of family.faces) {
      const request = face.substitution?.requested ?? {
        family: family.family,
        weight: face.weight,
        style: face.style,
      };
      const admitted = session.admittedFontFace({
        family: request.family,
        weight: request.weight,
        style: request.style,
      });
      if (!admitted) continue;
      const requestKey = `${admitted.identity}\u001f${request.family}\u001f${request.weight}\u001f${request.style}`;
      if (fonts.has(requestKey)) continue;
      let bytes = byteResources.get(admitted.identity);
      if (!bytes) {
        // The Core session owns this buffer. Make one bounded copy per resource so
        // PDFKit cannot observe mutation while it encodes aliases of the same face.
        bytes = admitted.bytes.slice();
        byteResources.set(admitted.identity, bytes);
      }
      fonts.set(
        requestKey,
        Object.freeze({
          id: admitted.id,
          identity: admitted.identity,
          family: admitted.family,
          request: Object.freeze(request),
          byteLength: admitted.byteLength,
          hash: admitted.hash,
          faceIndex: admitted.faceIndex,
          bytes,
        })
      );
    }
  }
  return Object.freeze([...fonts.values()]);
}

function absorbDiagnostics(
  collector: PdfFidelityDiagnosticCollector,
  diagnostics: readonly PdfFidelityDiagnostic[]
): void {
  for (const diagnostic of diagnostics) collector.push(diagnostic);
}

/** Convert untrusted DOCX bytes to PDF with Node-safe resource and shaping defaults. @public */
export async function exportPdf(
  source: Uint8Array,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  const outputByteLimit = validateOutputByteLimit(options.maxOutputBytes ?? HARD_MAX_OUTPUT_BYTES);
  throwIfAborted(options.signal, 'Export was aborted before layout');
  const { fonts, fallbackFonts, fidelityPolicy, maxOutputBytes, ...coreOptions } = options;
  void maxOutputBytes;
  const opened = await openFontBackedDocumentForExport(source, {
    ...coreOptions,
    reuseAcrossRevisions: false,
    fonts: [...fontOrigins(fonts), packagedExportFonts, ...fontOrigins(fallbackFonts)],
  });
  if (!opened.ok) {
    if (opened.reason === 'aborted') {
      throw new ExportResourceError('aborted', 'Export was aborted before layout', {
        cause: options.signal?.reason,
      });
    }
    throw new PdfDocumentOpenError(opened.reason, opened.detail);
  }

  try {
    throwIfAborted(options.signal, 'Export was aborted before layout');
    const layout = await opened.session.layout();
    throwIfAborted(options.signal, 'Export was aborted before PDF encoding');
    const planned = planPdfPaintFromLayout(layout, { signal: options.signal });
    const diagnostics = createFidelityDiagnosticCollector();
    absorbDiagnostics(diagnostics, planned.diagnostics);
    const written = await writePdfPaintPlanToBytes(planned.plan, {
      signal: options.signal,
      maxOutputBytes: outputByteLimit,
      admittedFonts: admittedFonts(opened.session),
      defaultFontFamily: opened.session.fontResolution.defaultFamily,
    });
    throwIfAborted(options.signal, 'Export was aborted during PDF encoding');
    absorbDiagnostics(diagnostics, written.diagnostics);
    if (written.pageCount !== planned.pageCount) {
      throw new Error(
        `PDF writer page count ${written.pageCount} does not match planned page count ${planned.pageCount}`
      );
    }

    const snapshot = diagnostics.snapshot();
    if ((fidelityPolicy ?? 'best-effort') === 'strict' && hasVisibleFidelityIssue(snapshot)) {
      throw new PdfFidelityError(snapshot);
    }

    return Object.freeze({
      bytes: written.bytes,
      pageCount: planned.pageCount,
      layoutRevision: layout.revision,
      displayMode: layout.displayMode ?? 'all-markup',
      fontResolution: opened.session.fontResolution,
      diagnostics: snapshot,
    });
  } finally {
    opened.session.dispose();
  }
}

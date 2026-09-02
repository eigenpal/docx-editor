import {
  createPackagedFileFetch,
  ExportResourceError,
  openFontBackedDocumentForExport,
  type ExportSemanticLayout,
  type FontBackedExportCapabilities,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES, forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { packagedFonts } from '@docx-editor.dev/fonts';
import {
  createFidelityDiagnosticCollector,
  pdfApproximationDiagnostic,
  type PdfFidelityDiagnostic,
  type PdfFidelityDiagnosticCollector,
  type PdfFidelityStoryKind,
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

// Workspace and published sibling packages keep faces in fonts/assets. Bundled Node
// workers copy those same faces beside the entry as ../assets/.
const packagedFontRoots = Object.freeze([
  new URL('../../fonts/assets/', import.meta.url),
  new URL('../assets/', import.meta.url),
]);
const packagedFileFetch = createPackagedFileFetch({
  trustedRoot: packagedFontRoots,
  maxBytes: HARD_MAX_FONT_BYTES,
});

const packagedExportFonts = packagedFonts({
  fetcher: packagedFileFetch,
  install: false,
});

const PAINTED_TEXT_STORIES = new Set<PdfFidelityStoryKind>(['body', 'header', 'footer']);

const PDFKIT_RESHAPE_REASON =
  'PDFKit reshapes Unicode text; Core HarfBuzz glyph IDs are not encoded';
const MISSING_SHAPING_REASON =
  'PDFKit reshapes Unicode text; Core HarfBuzz glyph IDs and admitted font bytes are not available';

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

function recordLaidOutTextFidelity(
  layout: ExportSemanticLayout,
  session: FontBackedExportCapabilities,
  diagnostics: PdfFidelityDiagnosticCollector
): void {
  forEachSemanticSpan(layout, (visit) => {
    if (!PAINTED_TEXT_STORIES.has(visit.rootStory as PdfFidelityStoryKind)) return;
    if (visit.span.style?.hidden || visit.span.equation) return;
    if (visit.span.text.length === 0) return;

    const laidOut = session.shapeLaidOutText(visit.span);
    diagnostics.push(
      pdfApproximationDiagnostic({
        feature: 'shaped-glyph-run',
        pageIndex: visit.page.index,
        recordKind: 'styleSpan',
        recordId: visit.span.range.paragraphId,
        story: visit.rootStory as PdfFidelityStoryKind,
        reason: laidOut === null ? MISSING_SHAPING_REASON : PDFKIT_RESHAPE_REASON,
      })
    );
  });
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
    recordLaidOutTextFidelity(layout, opened.session, diagnostics);
    const written = await writePdfPaintPlanToBytes(planned.plan, {
      signal: options.signal,
      maxOutputBytes: outputByteLimit,
    });
    throwIfAborted(options.signal, 'Export was aborted during PDF encoding');
    absorbDiagnostics(diagnostics, written.diagnostics);

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

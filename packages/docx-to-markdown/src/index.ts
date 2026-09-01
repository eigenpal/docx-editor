/**
 * Server-first DOCX to Markdown conversion over the shared semantic layout engine.
 *
 * @packageDocumentation
 * @public
 */
import {
  acquireSharedExportShaping,
  openFontBackedDocumentForExport,
  openDocumentForExport as openCoreDocumentForExport,
  type ExportDocumentSource,
  type ExportSemanticLayout,
  type ExportSession,
  type OpenDocumentForExportResult,
} from '@docx-editor.dev/core/export';
import {
  HARD_MAX_FONT_BYTES,
  prepareLayoutFontConfiguration,
  type LayoutFontConfiguration,
  type PreparedLayoutFontConfiguration,
} from '@docx-editor.dev/core/layout';
import type { HeadlessDocumentRejection } from '@docx-editor.dev/core/store';
import { loadDefaultFonts, packagedFonts } from '@docx-editor.dev/fonts';
import {
  exportMarkdownFrom as translateMarkdown,
  exportMarkdownLayout as translateMarkdownLayout,
} from './markdown.ts';
import type {
  MarkdownExportOptions,
  MarkdownExportResult,
  MarkdownFontOrigin,
  MarkdownFontsSource,
  OpenMarkdownDocumentForExportOptions,
  MarkdownTranslationOptions,
} from './markdown-types.ts';
import { createSuccessfulValueCache, provisionWithExportDeadline } from './export-deadline.ts';
import { createPackagedFileFetch } from './packaged-file-fetch.ts';

export { ExportResourceError } from '@docx-editor.dev/core/export';
export {
  forEachSemanticDrawing,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
} from '@docx-editor.dev/core/layout';
export { createFontSource, defineFontResolver } from '@docx-editor.dev/core/editor';

export type {
  ExportDocumentSource,
  ExportFontFaceResolution,
  ExportFontFamilyResolution,
  ExportFontResolutionReport,
  FontOriginFailure,
  ExportSemanticLayout,
  ExportSession,
  OpenDocumentForExportOptions,
  OpenDocumentForExportResult,
  PreservedImageConverter,
} from '@docx-editor.dev/core/export';
export type {
  AnchoredDrawingLayoutFallback,
  SemanticDrawingVisit,
  SemanticLayout,
  AnchoredDrawingRecord,
  DrawingAccessibility,
  DrawingGeometry,
  DrawingHorizontalReferenceFrame,
  DrawingTransform,
  DrawingVerticalReferenceFrame,
  ImageWrapTarget,
  InlineDrawingRecord,
  LayoutBox,
  RevisionAttribution,
  RevisionDisplayMode,
  SourceCrop,
  TextboxStoryLayout,
  TextMeasurer,
  VectorShapeProjection,
} from '@docx-editor.dev/core/layout';
export type {
  HeadlessDocumentRejection,
  HeadlessDocumentView,
  ImageDecodePort,
  ImageResourceState,
} from '@docx-editor.dev/core/store';
export type {
  MarkdownExportOptions,
  MarkdownExportResult,
  MarkdownFontOrigin,
  MarkdownFontsSource,
  MarkdownImageResult,
  MarkdownPage,
  MarkdownPaginationInfo,
  OpenMarkdownDocumentForExportOptions,
  MarkdownTranslationOptions,
} from './markdown-types.ts';

/** Typed one-shot failure for bytes that cannot be opened as a supported DOCX. @public */
export class DocumentOpenError extends Error {
  constructor(
    readonly reason: HeadlessDocumentRejection | 'aborted',
    readonly detail?: string
  ) {
    super(`Unable to open DOCX for export: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'DocumentOpenError';
  }
}

const packagedFileFetch = createPackagedFileFetch();

interface DefaultExportFonts {
  readonly configuration: PreparedLayoutFontConfiguration;
}

const defaultFonts = createSuccessfulValueCache(async (signal): Promise<DefaultExportFonts> => {
  const fragment = await loadDefaultFonts({ fetcher: packagedFileFetch, signal });
  if (fragment.failures.length > 0 || fragment.sources.length === 0) {
    const detail = fragment.failures
      .map((failure) => `${failure.file}: ${failure.diagnostic}`)
      .join('; ');
    throw new Error(
      `Unable to provision packaged fonts for headless export${detail ? `: ${detail}` : ''}`
    );
  }
  const configuration = Object.freeze({
    epoch: 1,
    maxFontBytes: HARD_MAX_FONT_BYTES,
    sources: fragment.sources,
    substitutions: fragment.substitutions,
    defaultFont: Object.freeze({ family: 'Calibri', sizeHalfPoints: 22 }),
  }) satisfies LayoutFontConfiguration;
  const prepared = prepareLayoutFontConfiguration(configuration);
  return Object.freeze({
    configuration: prepared,
  });
});

const packagedExportFonts = packagedFonts({
  fetcher: packagedFileFetch,
  install: false,
});

function isByteSource(source: ExportDocumentSource): source is Uint8Array {
  return ArrayBuffer.isView(source);
}

function fontOrigins(source: MarkdownFontsSource | undefined): readonly MarkdownFontOrigin[] {
  if (source === undefined) return [];
  return Array.isArray(source) ? source : [source as MarkdownFontOrigin];
}

/** Open a reusable export session with packaged fonts and HarfBuzz shaping by default. @public */
export async function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenMarkdownDocumentForExportOptions = {}
): Promise<OpenDocumentForExportResult> {
  const { fonts: _fonts, fallbackFonts: _fallbackFonts, ...coreOptions } = options;
  if (options.measurer) {
    if (options.fontPolicy !== undefined || options.onFontResolution !== undefined) {
      throw new TypeError(
        'fontPolicy and onFontResolution cannot verify a caller-supplied measurer; ' +
          'omit measurer to use document-aware Core font resolution'
      );
    }
    return openCoreDocumentForExport(source, coreOptions);
  }
  const callerFonts = fontOrigins(options.fonts);
  const missingFonts = fontOrigins(options.fallbackFonts);
  const hasCustomFontPolicy =
    callerFonts.length > 0 ||
    missingFonts.length > 0 ||
    options.fontPolicy !== undefined ||
    options.onFontResolution !== undefined;
  if (isByteSource(source)) {
    return openFontBackedDocumentForExport(source, {
      ...coreOptions,
      fonts: [...callerFonts, packagedExportFonts, ...missingFonts],
    });
  }
  if (hasCustomFontPolicy) {
    throw new TypeError(
      'fonts and fallbackFonts require immutable DOCX bytes; pass a revision-stable measurer ' +
        'when exporting a live HeadlessDocumentView'
    );
  }
  // A live view cannot be safely reopened around asynchronous document-aware font origins.
  // Keep its process-static shaping snapshot stable across revisions; fidelity-sensitive hosts
  // should pass the exact measurer already used by their editor.
  const shared = await provisionWithExportDeadline(
    (signal) =>
      defaultFonts(signal).then((loaded) => acquireSharedExportShaping(loaded.configuration)),
    options
  );
  return openCoreDocumentForExport(source, {
    ...coreOptions,
    reuseAcrossRevisions: options.reuseAcrossRevisions,
    measurer: shared.createMeasurer(),
    producer: options.producer ?? shared.producer,
  });
}

/** Translate an existing shared export session without reopening or re-laying out it. @public */
export function exportMarkdownFrom(
  session: ExportSession,
  options: MarkdownTranslationOptions = {}
): Promise<MarkdownExportResult> {
  return translateMarkdown(session, options);
}

/** Translate a detached immutable core layout after its producer session is disposed. @public */
export function exportMarkdownLayout(
  layout: ExportSemanticLayout,
  options: MarkdownTranslationOptions = {}
): MarkdownExportResult {
  return translateMarkdownLayout(layout, options);
}

/** Convert untrusted DOCX bytes with Node-safe fonts, shaping, and image decoding defaults. @public */
export async function exportMarkdown(
  source: ExportDocumentSource,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = await openDocumentForExport(source, options);
  if (!opened.ok) {
    throw new DocumentOpenError(opened.reason, opened.detail);
  }
  let layout: ExportSemanticLayout;
  try {
    layout = await opened.session.layout();
  } finally {
    opened.session.dispose();
  }
  return translateMarkdownLayout(layout, options);
}

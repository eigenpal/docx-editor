/**
 * Server-first DOCX to Markdown conversion over the shared semantic layout engine.
 *
 * @packageDocumentation
 * @public
 */
import {
  acquireSharedExportShaping,
  ExportResourceError,
  openFontBackedDocumentForExport,
  openDocumentForExport as openCoreDocumentForExport,
  type ExportDocumentSource,
  type ExportFontResolutionReport,
  type ExportSemanticLayout,
  type ExportSession,
  type OpenDocumentForExportResult,
  type OpenFontBackedDocumentForExportResult,
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
  SemanticArtifactRootStoryKind,
  SemanticArtifactStoryKind,
  SemanticCommentArtifactRecord,
  SemanticDrawingVisit,
  SemanticLayout,
  SemanticReviewArtifactOccurrence,
  SemanticReviewArtifactPosition,
  SemanticReviewArtifactRecord,
  SemanticReviewArtifactSource,
  SemanticTrackedChangeArtifactRecord,
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
  MarkdownPage,
  MarkdownPaginationInfo,
  OpenMarkdownDocumentForExportOptions,
} from './markdown-types.ts';
export type {
  MarkdownComment,
  MarkdownReviewCoverage,
  MarkdownReviewArtifact,
  MarkdownReviewBinding,
  MarkdownReviewOccurrence,
  MarkdownReviewProjection,
  MarkdownReviewRange,
  MarkdownReviewRangePrecision,
  MarkdownReviewUnmappedReason,
  MarkdownTrackedChange,
} from './markdown-review-bindings.ts';

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

/** Reusable Markdown session with the font evidence captured while it opened. @public */
export interface MarkdownExportSession extends ExportSession {
  /**
   * Non-null for document-aware byte sessions opened by Markdown or Core; null for detached
   * layouts, caller-supplied measurers, ordinary Core sessions, and live shared-shaping sessions.
   */
  readonly fontResolution: ExportFontResolutionReport | null;
}

/** Open result whose successful session retains its structured font-resolution report. @public */
export type OpenMarkdownDocumentForExportResult =
  | { readonly ok: true; readonly session: MarkdownExportSession }
  | Exclude<OpenDocumentForExportResult, { readonly ok: true }>;

function markdownSession(
  session: ExportSession,
  fontResolution: ExportFontResolutionReport | null
): MarkdownExportSession {
  return Object.freeze({
    fontResolution,
    layout: () => session.layout(),
    layoutFor: (displayMode: Parameters<ExportSession['layoutFor']>[0]) =>
      session.layoutFor(displayMode),
    validatedImageBytes: (drawing: Parameters<ExportSession['validatedImageBytes']>[0]) =>
      session.validatedImageBytes(drawing),
    dispose: () => session.dispose(),
  });
}

function markdownOpenResult(
  result: OpenDocumentForExportResult,
  fontResolution: ExportFontResolutionReport | null
): OpenMarkdownDocumentForExportResult {
  return result.ok
    ? { ok: true, session: markdownSession(result.session, fontResolution) }
    : result;
}

function markdownFontBackedOpenResult(
  result: OpenFontBackedDocumentForExportResult
): OpenMarkdownDocumentForExportResult {
  return result.ok ? { ok: true, session: result.session } : result;
}

function withFontResolution(
  result: MarkdownExportResult,
  fontResolution: ExportFontResolutionReport | null
): MarkdownExportResult {
  return Object.freeze({ ...result, fontResolution });
}

/** Open a reusable export session with packaged fonts and HarfBuzz shaping by default. @public */
export async function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenMarkdownDocumentForExportOptions = {}
): Promise<OpenMarkdownDocumentForExportResult> {
  const { fonts: _fonts, fallbackFonts: _fallbackFonts, ...coreOptions } = options;
  if (options.measurer) {
    if (options.fontPolicy !== undefined || options.onFontResolution !== undefined) {
      throw new TypeError(
        'fontPolicy and onFontResolution cannot verify a caller-supplied measurer; ' +
          'omit measurer to use document-aware Core font resolution'
      );
    }
    return markdownOpenResult(await openCoreDocumentForExport(source, coreOptions), null);
  }
  const callerFonts = fontOrigins(options.fonts);
  const missingFonts = fontOrigins(options.fallbackFonts);
  const hasCustomFontPolicy =
    callerFonts.length > 0 ||
    missingFonts.length > 0 ||
    options.fontPolicy !== undefined ||
    options.onFontResolution !== undefined;
  if (isByteSource(source)) {
    if (options.reuseAcrossRevisions === true) {
      throw new TypeError(
        'reuseAcrossRevisions requires a live view or caller-supplied measurer; ' +
          'document-aware byte sessions are immutable'
      );
    }
    const opened = await openFontBackedDocumentForExport(source, {
      ...coreOptions,
      reuseAcrossRevisions: false,
      fonts: [...callerFonts, packagedExportFonts, ...missingFonts],
      onFontResolution: options.onFontResolution,
    });
    return markdownFontBackedOpenResult(opened);
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
  return markdownOpenResult(
    await openCoreDocumentForExport(source, {
      ...coreOptions,
      reuseAcrossRevisions: options.reuseAcrossRevisions,
      measurer: shared.createMeasurer(),
      producer: options.producer ?? shared.producer,
    }),
    null
  );
}

/** Translate an existing shared export session without reopening or re-laying out it. @public */
export function exportMarkdownFrom(session: ExportSession): Promise<MarkdownExportResult> {
  return translateMarkdown(session).then((result) =>
    withFontResolution(
      result,
      'fontResolution' in session
        ? (session as MarkdownExportSession).fontResolution
        : result.fontResolution
    )
  );
}

/** Translate a detached immutable core layout after its producer session is disposed. @public */
export function exportMarkdownLayout(layout: ExportSemanticLayout): MarkdownExportResult {
  return translateMarkdownLayout(layout);
}

/** Convert untrusted DOCX bytes with Node-safe resource and shaping defaults. @public */
export async function exportMarkdown(
  source: ExportDocumentSource,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = await openDocumentForExport(source, options);
  if (!opened.ok) {
    if (opened.reason === 'aborted') {
      throw new ExportResourceError('aborted', 'Export was aborted before layout', {
        cause: options.signal?.reason,
      });
    }
    throw new DocumentOpenError(opened.reason, opened.detail);
  }
  let layout: ExportSemanticLayout;
  try {
    layout = await opened.session.layout();
  } finally {
    opened.session.dispose();
  }
  return withFontResolution(translateMarkdownLayout(layout), opened.session.fontResolution);
}

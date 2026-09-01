/**
 * Server-first DOCX to Markdown conversion over the shared semantic layout engine.
 *
 * @packageDocumentation
 * @public
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  acquireSharedExportShaping,
  openDocumentForExport as openCoreDocumentForExport,
  type ExportDocumentSource,
  type ExportSemanticLayout,
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from '@docx-editor.dev/core/export';
import {
  HARD_MAX_FONT_BYTES,
  prepareLayoutFontConfiguration,
  type LayoutFontConfiguration,
  type PreparedLayoutFontConfiguration,
} from '@docx-editor.dev/core/layout';
import { openHeadlessDocument } from '@docx-editor.dev/core/store';
import type { HeadlessDocumentRejection } from '@docx-editor.dev/core/store';
import { loadDefaultFonts } from '@docx-editor.dev/fonts';
import {
  exportMarkdownFrom as translateMarkdown,
  exportMarkdownLayout as translateMarkdownLayout,
  type MarkdownExportOptions,
  type MarkdownExportResult,
  type MarkdownTranslationOptions,
} from './markdown.ts';
import { createRetryingLoader } from './retrying-loader.ts';

export { ExportResourceError } from '@docx-editor.dev/core/export';
export { forEachSemanticDrawing } from '@docx-editor.dev/core/layout';

export type {
  ExportDocumentSource,
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
  MarkdownImageResult,
  MarkdownComment,
  MarkdownPage,
  MarkdownPaginationInfo,
  MarkdownReviewArtifact,
  MarkdownReviewOccurrence,
  MarkdownTrackedChange,
  MarkdownTranslationOptions,
} from './markdown.ts';

/** Typed one-shot failure for bytes that cannot be opened as a supported DOCX. @public */
export class DocumentOpenError extends Error {
  constructor(
    readonly reason: HeadlessDocumentRejection,
    readonly detail?: string
  ) {
    super(`Unable to open DOCX for export: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'DocumentOpenError';
  }
}

const packagedFileFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const value =
    input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (value.protocol !== 'file:') {
    throw new TypeError(`Packaged font URL must use file:, received ${value.protocol}`);
  }
  try {
    return new Response(await readFile(fileURLToPath(value)), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

interface DefaultExportFonts {
  readonly configuration: PreparedLayoutFontConfiguration;
}

const defaultFonts = createRetryingLoader(async (): Promise<DefaultExportFonts> => {
  const fragment = await loadDefaultFonts({ fetcher: packagedFileFetch });
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

function isByteSource(source: ExportDocumentSource): source is Uint8Array {
  return ArrayBuffer.isView(source);
}

/** Open a reusable export session with packaged fonts and HarfBuzz shaping by default. @public */
export async function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenDocumentForExportOptions = {}
): Promise<OpenDocumentForExportResult> {
  if (options.measurer) return openCoreDocumentForExport(source, options);
  // Reject attacker-controlled junk before loading or admitting any packaged font bytes.
  const prepared = isByteSource(source)
    ? openHeadlessDocument(source)
    : { ok: true as const, view: source };
  if (!prepared.ok) return prepared;
  const defaults = await defaultFonts();
  const shared = await acquireSharedExportShaping(defaults.configuration);
  return openCoreDocumentForExport(prepared.view, {
    ...options,
    reuseAcrossRevisions: isByteSource(source)
      ? (options.reuseAcrossRevisions ?? false)
      : options.reuseAcrossRevisions,
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

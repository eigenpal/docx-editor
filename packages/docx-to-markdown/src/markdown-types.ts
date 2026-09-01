import type { AnchoredDrawingRecord, InlineDrawingRecord } from '@docx-editor.dev/core/layout';
import type {
  ExportFontResolutionReport,
  ExportSemanticLayout,
  OpenDocumentForExportOptions,
} from '@docx-editor.dev/core/export';
import type { FontOrigin } from '@docx-editor.dev/core/export';
import type {
  MarkdownComment,
  MarkdownReviewArtifact,
  MarkdownReviewBinding,
  MarkdownTrackedChange,
} from './markdown-review-bindings.ts';

/** Markdown emitted for one physical layout page. @public */
export interface MarkdownPage {
  /** Identifier for this page within this export result. */
  readonly id: string;
  /** One-based physical page number. */
  readonly number: number;
  /** Body projection, plus local note definitions or labelled continuation blocks. */
  readonly markdown: string;
  /** Header story for this page, kept separate from logical document content. */
  readonly headerMarkdown: string;
  /** Footer story for this page, kept separate from logical document content. */
  readonly footerMarkdown: string;
  /**
   * Document-wide comment records with at least one occurrence on this page. Filter each
   * artifact's occurrences by `pageIndex === number - 1` for page-local provenance.
   */
  readonly comments: readonly MarkdownComment[];
  /**
   * Document-wide tracked-change records with at least one occurrence on this page. Filter each
   * artifact's occurrences by `pageIndex === number - 1` for page-local provenance.
   */
  readonly trackedChanges: readonly MarkdownTrackedChange[];
}

/** Machine-readable scope of the page numbers returned by this export. @public */
export interface MarkdownPaginationInfo {
  /** Pages come from the docx-editor semantic layout engine, not stale DOCX page-break hints. */
  readonly source: 'layout-engine';
  /** Page numbers describe this exact export result. */
  readonly scope: 'export-snapshot';
  /** Core store revision from which this layout snapshot was produced. */
  readonly layoutRevision: number;
  /** Tracked-change projection used to paginate and translate this snapshot. */
  readonly revisionView: NonNullable<ExportSemanticLayout['displayMode']>;
}

/** Full logical document plus page-scoped projections. @public */
export interface MarkdownExportResult {
  /** Primary physical page projections, preserving Word layout boundaries and furniture. */
  readonly pages: readonly MarkdownPage[];
  /** Every normalized comment and tracked change, including artifacts with no page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Markdown offsets for every representable review-artifact occurrence. */
  readonly reviewBindings: readonly MarkdownReviewBinding[];
  /** How page numbers and tracked changes were projected for this result. */
  readonly pagination: MarkdownPaginationInfo;
  /** Convenience logical Markdown with split records joined and repeated furniture excluded. */
  readonly markdown: string;
}

/** Caller decision for a laid-out image. @public */
export type MarkdownImageResult = { readonly url: string } | { readonly skip: true };

/** Translation-only controls over already-published layout records. @public */
export interface MarkdownTranslationOptions {
  /**
   * Map a laid-out drawing to a destination. Without a mapper (or when skipped), only its
   * escaped accessibility label is emitted. This callback is synchronous: perform uploads
   * first and return a precomputed URL. Reading validated bytes requires a live reusable
   * session; copy or upload them before disposal, then this mapper can translate its detached
   * immutable layout using the retained drawing-to-URL mapping.
   */
  readonly image?: (drawing: InlineDrawingRecord | AnchoredDrawingRecord) => MarkdownImageResult;
}

/** One caller-controlled font origin used for headless pagination. @public */
export type MarkdownFontOrigin = FontOrigin;

/** One font origin, or an ordered first-wins list of origins. @public */
export type MarkdownFontsSource = MarkdownFontOrigin | readonly MarkdownFontOrigin[];

/** Layout controls for a reusable Markdown export session. @public */
export interface OpenMarkdownDocumentForExportOptions extends OpenDocumentForExportOptions {
  /**
   * Caller-supplied font bytes or resolvers, in first-wins order. These take precedence over the
   * package's bundled metric-compatible Word substitutes. A resolver is invoked after the DOCX is
   * parsed with the bounded family list layout can render. Custom origins require immutable DOCX
   * bytes; for a live view, supply a revision-stable `measurer` instead. An explicit measurer takes
   * precedence and font origins are not invoked.
   */
  readonly fonts?: MarkdownFontsSource;
  /**
   * Opt-in origins consulted only after caller fonts and bundled substitutes. Put
   * `googleFonts()` here to fetch catalogued families the local origins cannot paint. This has the
   * same immutable-bytes restriction and explicit-measurer precedence as {@link fonts}.
   */
  readonly fallbackFonts?: MarkdownFontsSource;
  /** `strict` refuses failed origins or any requested family missing one of four static faces. */
  readonly fontPolicy?: 'best-effort' | 'strict';
  /**
   * Fire-and-forget evidence for the exact direct/substituted faces behind page breaks. Returned
   * promises are observed for rejection but do not delay export.
   */
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
}

/** One-shot options combine neutral layout provisioning with translation. @public */
export interface MarkdownExportOptions
  extends OpenMarkdownDocumentForExportOptions, MarkdownTranslationOptions {}

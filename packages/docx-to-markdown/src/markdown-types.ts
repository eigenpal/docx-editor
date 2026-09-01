import type {
  ExportFontResolutionReport,
  OpenDocumentForExportOptions,
} from '@docx-editor.dev/core/export';
import type { FontOrigin } from '@docx-editor.dev/core/export';
import type { RevisionDisplayMode } from '@docx-editor.dev/core/layout';
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
   * Membership view of comments occurring on this page. Each entry is the complete document-wide
   * artifact and can contain occurrences from other pages. For page-local provenance, filter with
   * `occurrence.pageIndex === page.number - 1`.
   */
  readonly comments: readonly MarkdownComment[];
  /**
   * Membership view of tracked changes occurring on this page. Each entry is the complete
   * document-wide artifact and can contain occurrences from other pages. For page-local
   * provenance, filter with `occurrence.pageIndex === page.number - 1`.
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
  /** Tracked-change display mode used to paginate and translate this snapshot. */
  readonly displayMode: RevisionDisplayMode;
}

/** Full logical document plus page-scoped projections. @public */
export interface MarkdownExportResult {
  /** Primary physical page projections, preserving Word layout boundaries and furniture. */
  readonly pages: readonly MarkdownPage[];
  /**
   * Every normalized comment and tracked change, including artifacts without a page occurrence.
   * Artifact IDs are opaque and stable only within this result.
   */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Markdown offsets valid only within this immutable result, with explicit mapping fidelity. */
  readonly reviewBindings: readonly MarkdownReviewBinding[];
  /** Structured font-resolution evidence, or null when the layout's font origin is unavailable. */
  readonly fontResolution: ExportFontResolutionReport | null;
  /** How page numbers and tracked changes were projected for this result. */
  readonly pagination: MarkdownPaginationInfo;
  /** Convenience logical Markdown with split records joined and repeated furniture excluded. */
  readonly markdown: string;
}

/** One caller-controlled font origin used for headless pagination. @public */
export type MarkdownFontOrigin = FontOrigin;

/** One font origin, or an ordered first-wins list of origins. @public */
export type MarkdownFontsSource = MarkdownFontOrigin | readonly MarkdownFontOrigin[];

/** Layout controls for a reusable Markdown export session. @public */
export interface OpenMarkdownDocumentForExportOptions extends OpenDocumentForExportOptions {
  /**
   * Retains incremental state for a live view or caller-measured session. Document-aware byte
   * sessions are immutable and reject `true` instead of silently ignoring it.
   */
  readonly reuseAcrossRevisions?: boolean;
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

/** Layout and resource controls for one-shot Markdown export. @public */
export interface MarkdownExportOptions extends OpenMarkdownDocumentForExportOptions {}

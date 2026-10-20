import type { SemanticDrawingVisit } from '@docx-editor.dev/core/layout';

/** One physical occurrence of an extracted image. @public */
export interface MarkdownImageOccurrence {
  readonly pageNumber: number;
  readonly story: SemanticDrawingVisit['story'];
  readonly rootStory: SemanticDrawingVisit['rootStory'];
  readonly partName: string;
  readonly drawingNodeId: string;
  readonly paragraphId: string;
  /** Source offset within the paragraph, in UTF-16 code units. */
  readonly start: number;
  /** Word's extent width in CSS pixels (96 px per inch), before crop or rotation. */
  readonly displayWidthPx: number;
  /** Word's extent height in CSS pixels (96 px per inch), before crop or rotation. */
  readonly displayHeightPx: number;
  /** Anchored images render at their paragraph position; Markdown does not reproduce text wrapping. */
  readonly kind: 'inline' | 'anchored';
  readonly decorative: boolean;
  readonly alt: string;
}

/** Image bytes and provenance supplied to a URL resolver. @public */
export interface MarkdownImageData {
  /** Core's SHA-256 content identifier for the exported bytes. */
  readonly id: string;
  /** Portable relative filename, independent of the resolved URL. */
  readonly path: string;
  readonly mimeType: string;
  /** Owned bytes. Treat as read-only to preserve the content identifier. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  /** Intrinsic pixel width of the exported bytes; use occurrence dimensions for display. */
  readonly pixelWidth: number;
  /** Intrinsic pixel height of the exported bytes; use occurrence dimensions for display. */
  readonly pixelHeight: number;
  readonly occurrences: readonly MarkdownImageOccurrence[];
}

/** One unique image returned by a Markdown export. @public */
export interface MarkdownImageAsset extends MarkdownImageData {
  /** Raw URL; Markdown output escapes destination syntax separately. */
  readonly url: string;
}

/** Portable image extraction and optional application-owned storage. @public */
export interface MarkdownImageOptions {
  /**
   * Default: `markdown` emits standard image links without dimensions.
   * `html` emits an escaped `<img>` with each occurrence's display width and height,
   * rounded to whole CSS pixels. Your renderer must allow HTML and these attributes.
   * Neither syntax reproduces cropping, rotation, or floating text wrapping.
   */
  readonly syntax?: 'markdown' | 'html';
  /**
   * Called sequentially once per unique image, after all extraction succeeds. Receives a
   * separate byte copy; mutations cannot change result bytes. Return a relative path or HTTP(S)
   * URL. The application owns completed uploads, their cleanup, and signed-URL expiry.
   */
  readonly resolveUrl?: (
    image: MarkdownImageData,
    context: { readonly signal?: AbortSignal }
  ) => string | Promise<string>;
  /** Unique extracted bytes; default 64 MiB. Not a total parsing/layout memory limit. */
  readonly maxTotalBytes?: number;
}

/** Projection controls for an already-open export session. @public */
export interface MarkdownProjectionOptions {
  /** `true` or `{}` extracts images with portable relative URLs. Default: false. */
  readonly images?: boolean | MarkdownImageOptions;
  /** Cancels export waits; cannot interrupt synchronous parsing or layout. */
  readonly signal?: AbortSignal;
}

// The document compare engine contract. DOM-free and behavior-free, so the headless
// automation lane can name it.
import type { OoxmlPackage } from '@docx-editor.dev/core/store';

/** Options of one document compare. @public */
export interface CompareDocumentsEngineOptions {
  /** Author recorded on every revision. The engine picks a default when absent. */
  readonly authorName?: string;
  /** Record formatting differences as property-change revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Omit the revision timestamps. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/** Why a document compare was refused. @public */
export type CompareDocumentsErrorCode =
  /** The original document is not a readable DOCX package. */
  | 'invalid-original'
  /** The revised document is not a readable DOCX package. */
  | 'invalid-revised'
  /** The documents exceed the compare's size limits. */
  | 'too-large'
  /**
   * The original document enforces protection that the compare would break: read-only,
   * comments, or forms protection. Tracked-changes protection refuses too when the original
   * holds tracked changes, which a compare accepts, or when formatting detection is off, which
   * writes formatting differences untracked.
   */
  | 'protected'
  /** The differences include content that no tracked change can record. */
  | 'unsupported-content';

/** Result of one document compare. @public */
export type CompareDocumentsEngineResult =
  | {
      readonly ok: true;
      /** The original package with the differences recorded as tracked changes. */
      readonly package: OoxmlPackage;
      readonly revisionCount: number;
    }
  | {
      readonly ok: false;
      readonly code: CompareDocumentsErrorCode;
      readonly message: string;
    };

/**
 * Compares the open document (the original) with a revised DOCX and returns the original with
 * the differences as tracked changes. Synchronous, DOM-free, and free of side effects.
 *
 * @public
 */
export type CompareDocumentsEngine = (
  original: OoxmlPackage,
  revised: Uint8Array,
  options: CompareDocumentsEngineOptions
) => CompareDocumentsEngineResult;

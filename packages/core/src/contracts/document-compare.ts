// The document compare engine contract. DOM-free and behavior-free, so the headless
// automation lane can name it.
import type { OoxmlPackage } from '@docx-editor.dev/core/store';

/** Options of one document compare. @public */
export interface DocumentCompareOptions {
  /** Author recorded on every revision. The engine picks a default when absent. */
  readonly authorName?: string;
  /** Record formatting differences as property-change revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Omit the revision timestamps. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/** Why a document compare was refused. @public */
export type DocumentCompareErrorCode =
  | 'invalid-original'
  | 'invalid-revised'
  | 'too-large'
  | 'unsupported-content';

/** Result of one document compare. @public */
export type DocumentCompareResult =
  | {
      readonly ok: true;
      /** The original package with the differences recorded as tracked changes. */
      readonly package: OoxmlPackage;
      readonly revisionCount: number;
    }
  | {
      readonly ok: false;
      readonly code: DocumentCompareErrorCode;
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
  options: DocumentCompareOptions
) => DocumentCompareResult;

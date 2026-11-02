// The document compare engine contract. DOM-free and behavior-free, so the headless
// automation lane can name it.
import type { OoxmlPackage } from '@docx-editor.dev/core/store';

/** Options of one document compare. @public */
export interface CompareDocumentsEngineOptions {
  /**
   * Author recorded on every revision. The engine picks a default when absent, empty, or only
   * white space.
   */
  readonly authorName?: string;
  /** Record formatting differences as formatting revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Omit the revision timestamps. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/**
 * Why a document compare was refused. The same codes name the editor's refusals
 * (`CompareDocumentsRefusal`), and `compareDocuments.errors.<code>` in
 * `@docx-editor.dev/i18n` translates each one.
 *
 * @public
 */
export type CompareDocumentsErrorCode =
  /** An option has a value of the wrong type, such as a `date` that is not a valid date. */
  | 'invalidOptions'
  /** The original document is not a readable DOCX package. */
  | 'invalidOriginal'
  /** The revised document is not a readable DOCX package. */
  | 'invalidRevised'
  /** The documents exceed the compare's size limits. */
  | 'tooLarge'
  /**
   * The original document enforces protection that the compare would break: read-only,
   * comments, or forms protection. Tracked-changes protection refuses too when the original
   * holds tracked changes, which a compare accepts, or when formatting detection is off, which
   * writes formatting differences untracked.
   */
  | 'protected'
  /** The differences include content that no tracked change can record. */
  | 'unsupportedContent';

/** Result of one document compare. @public */
export type CompareDocumentsEngineResult =
  | {
      readonly ok: true;
      /**
       * The original package with the differences recorded as tracked changes. When nothing
       * changed, this is the original package itself.
       */
      readonly package: OoxmlPackage;
      /**
       * Revision elements written. A replacement counts its deletion and its insertion, and a
       * move counts both ends, so this is not the number of review items.
       */
      readonly revisionCount: number;
      /**
       * Whether the result differs from the original. False when the documents have no
       * differences. True with no revisions when the only differences are written untracked,
       * such as formatting with `detectFormatChanges: false`, or the original's own tracked
       * changes, which a compare accepts.
       */
      readonly changed: boolean;
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

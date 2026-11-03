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
 * Why a compare was refused, as a stable code. `compareDocuments.errors.<code>` in
 * `@docx-editor.dev/i18n` translates every code. Every entry point uses this one type: the
 * engine and `compareDocuments` return the first six codes, and the editor command and dialog
 * can also return the last six.
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
  | 'unsupportedContent'
  /** Editor only: no review module, no open document, or no mount. */
  | 'unavailable'
  /** Editor only: a collaboration session is attached. */
  | 'collaboration'
  /** Editor only: the document is open for viewing only. */
  | 'viewing'
  /** Editor only: the dialog closed, or the compare was canceled, before it finished. */
  | 'closed'
  /** Editor only: the revised file is empty. */
  | 'empty'
  /** Editor only: any other failure. */
  | 'failed';

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
       * Tracked changes recorded, one per review decision: the items that `revisions`
       * collections and the review pane list, summed over the body, headers, footers, and
       * notes. A replaced word counts its deletion and its insertion.
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

/**
 * A step of a compare that runs in the background, in order: `reading` the two documents,
 * `comparing` them, `checking` that the result reproduces both, and `applying` it to the
 * open document.
 *
 * @public
 */
export type CompareDocumentsPhase = 'reading' | 'comparing' | 'checking' | 'applying';

/** How far a background compare is. @public */
export interface CompareDocumentsProgress {
  /** The step that runs now. */
  readonly phase: CompareDocumentsPhase;
  /** The share of the work done, from 0 to 1. It never decreases. */
  readonly fraction: number;
}

/** Result of one background compare: like {@link CompareDocumentsEngineResult}, as bytes. @public */
export type CompareDocumentsBackgroundResult =
  | {
      readonly ok: true;
      /** The original with the differences as tracked changes, or `null` when unchanged. */
      readonly bytes: Uint8Array | null;
      /** Tracked changes recorded, one per review decision. */
      readonly revisionCount: number;
      /** Whether the result differs from the original. */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: CompareDocumentsErrorCode;
      readonly message: string;
    };

/**
 * Runs a compare off the page's main thread, for example in a worker. The editor's Compare
 * documents dialog uses it when the review module provides one. It reports progress, and it
 * stops when `signal` aborts: the promise then rejects with the signal's reason.
 *
 * @public
 */
export type CompareDocumentsBackgroundEngine = (
  original: Uint8Array,
  revised: Uint8Array,
  options: CompareDocumentsEngineOptions,
  control: {
    readonly signal: AbortSignal;
    readonly onProgress: (progress: CompareDocumentsProgress) => void;
  }
) => Promise<CompareDocumentsBackgroundResult>;

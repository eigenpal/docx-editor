/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Public types of the document compare engine. */

import type {
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
} from '@docx-editor.dev/core/editor';

export type { CompareDocumentsErrorCode, CompareDocumentsRefusalReason };

/** Options for {@link compareDocuments}. @public */
export interface CompareDocumentsOptions {
  /**
   * Author recorded on every revision. When absent, empty, or only white space, the revised
   * document's last author (`cp:lastModifiedBy`, then `dc:creator`), else `Comparison`.
   */
  readonly authorName?: string;
  /**
   * Record formatting differences as formatting revisions. Default `true`. When `false`, the
   * result takes the revised formatting untracked, so rejecting all changes gives the
   * original text with the revised formatting.
   */
  readonly detectFormatChanges?: boolean;
  /** Write the revisions without dates. Default `false`. */
  readonly removeDateAndTime?: boolean;
  /**
   * Revision timestamp. Defaults to the current time, truncated to the minute. A value that is
   * not a valid date refuses with `invalidOptions`.
   */
  readonly date?: Date;
}

/** Result of {@link compareDocuments}. @public */
export type CompareDocumentsResult =
  | {
      readonly ok: true;
      /**
       * The original document with the differences recorded as tracked changes. When nothing
       * changed, these are the original bytes.
       */
      readonly bytes: Uint8Array;
      /**
       * Tracked changes recorded, one per review decision: the items that `revisions`
       * collections and the review pane list, summed over the body, headers, footers, and
       * notes. A replaced word counts its deletion and its insertion.
       */
      readonly revisionCount: number;
      /**
       * Whether the result differs from the original. False when the documents have no
       * differences. True with no revisions when the only differences are written untracked:
       * formatting with `detectFormatChanges: false`, or the original's own tracked changes,
       * which a compare accepts.
       */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      /** Why the compare was refused. `compareDocuments.errors.<code>` translates it. */
      readonly code: CompareDocumentsErrorCode;
      /**
       * Set with `unsupportedContent`: what the refusal is about.
       * `compareDocuments.reasons.<reason>` translates it.
       */
      readonly reason?: CompareDocumentsRefusalReason;
      /** Diagnostic detail, in English; not for display. */
      readonly message: string;
    };

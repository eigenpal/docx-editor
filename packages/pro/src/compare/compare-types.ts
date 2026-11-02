/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Public types of the document compare engine. */

import type {
  CompareDocumentsEngineOptions,
  CompareDocumentsErrorCode,
} from '@docx-editor.dev/core/editor';

export type { CompareDocumentsEngineOptions, CompareDocumentsErrorCode };

/** Options for {@link compareDocuments}. @public */
export interface CompareDocumentsOptions extends CompareDocumentsEngineOptions {
  /**
   * Author recorded on every revision. Defaults to the revised document's last author
   * (`cp:lastModifiedBy`, then `dc:creator`), else `Comparison`.
   */
  readonly authorName?: string;
  /** Revision timestamp. Defaults to the current time, truncated to the minute. */
  readonly date?: Date;
}

/** Result of {@link compareDocuments}. @public */
export type CompareDocumentsResult =
  | {
      readonly ok: true;
      /** The original document with the differences recorded as tracked changes. */
      readonly bytes: Uint8Array;
      /** Number of revision elements written. */
      readonly revisionCount: number;
    }
  | {
      readonly ok: false;
      readonly code: CompareDocumentsErrorCode;
      readonly message: string;
    };

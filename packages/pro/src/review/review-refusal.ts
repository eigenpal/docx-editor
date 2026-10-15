/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

// Why a review write did not land, for the review UI of both adapters.
//
// The editor names the cause of a refused accept, reply or delete (an external refresh, viewing,
// protection, a collaboration session that is not ready). The review hooks used to reduce each
// answer to a boolean, so a card's button did nothing and said nothing.

import { diagnosticCodeOfRefusal } from '@docx-editor.dev/core';
import type { EditDiagnosticCode } from '@docx-editor.dev/core/contracts/editor';
import type { ExecResult } from '@docx-editor.dev/core/contracts/types';
import type { TranslationKey } from '@docx-editor.dev/i18n';

/**
 * The review write a refusal answered.
 *
 * @public
 */
export type ReviewWriteAction =
  | 'accept'
  | 'reject'
  | 'resolve'
  | 'reopen'
  | 'remove'
  | 'reply'
  | 'comment';

/**
 * A review write the editor refused.
 *
 * @public
 */
export interface ReviewWriteRefusal {
  /** Which write was refused. */
  readonly action: ReviewWriteAction;
  /** The card the write addressed, or null for a new comment on the selection. */
  readonly key: string | null;
  /** The public diagnostic code, the same one `onDiagnostic` reports for the refusal. */
  readonly code: EditDiagnosticCode;
}

/** The refusal behind a write's result, or null when the write landed. */
export function reviewWriteRefusalOf(
  action: ReviewWriteAction,
  key: string | null,
  result: ExecResult
): ReviewWriteRefusal | null {
  if (result.ok) return null;
  return { action, key, code: diagnosticCodeOfRefusal(result.reason, result.code) };
}

/**
 * The packaged sentence for a refusal: its cause when the editor named one, else `fallback`.
 *
 * A cause a reader can act on (wait for a refresh, leave viewing) gets its own sentence; any
 * other refusal keeps the action's own sentence, because the code names an engine condition
 * the reader cannot change.
 */
export function reviewRefusalLabelKey(
  code: EditDiagnosticCode | undefined,
  fallback: TranslationKey
): TranslationKey {
  switch (code) {
    case 'edit.refresh-in-progress':
      return 'review.refusedRefresh';
    case 'edit.read-only':
      return 'review.refusedViewing';
    case 'edit.protected-content':
      return 'review.refusedProtected';
    case 'edit.collaboration-not-ready':
      return 'review.refusedCollaboration';
    default:
      return fallback;
  }
}

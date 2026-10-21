/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The one error type the rewrite helper throws. Its `code` says what to do next: send the
// message back to the model, decide changes first, or prepare the paragraph again. The helper
// never calls a model, so a failed model call is the caller's own error, never a code here.

/**
 * Why a rewrite was refused or failed.
 *
 * - The model text broke a rule, and nothing was written. `draft.check()` returns these too.
 *   Send `error.message` back to the model and ask again with the same draft:
 *   `invalid-output`, `placeholder-missing`, `placeholder-unknown`, `placeholder-moved`,
 *   `placeholder-repeated`, `placeholder-grouped`.
 * - The request context is in use, and nothing was written: `busy` when another helper call
 *   runs on it, such as two `apply()` calls at once, and `context-used` when commands are
 *   queued on it that are not synced.
 * - The paragraph cannot take a rewrite now, and nothing was written: `pending-changes`,
 *   `tracking-unavailable`, `draft-used`, `too-long`, `unsupported-text`, `read-failed`.
 * - A write or the final check failed, and the helper rejected the changes it had written:
 *   `stale`, `locked`, `write-failed`, `verification-failed`. After `stale` or
 *   `verification-failed`, another edit moved the paragraph: prepare it again, and ask the model
 *   again with the new draft.
 * - The rollback failed too, or could not find the paragraph after another edit joined or
 *   removed it, so the document can hold some of the proposal: `rollback-failed`. Do not retry
 *   automatically.
 *
 * @public
 */
export type RewriteErrorCode =
  | 'invalid-output'
  | 'placeholder-missing'
  | 'placeholder-unknown'
  | 'placeholder-moved'
  | 'placeholder-repeated'
  | 'placeholder-grouped'
  | 'context-used'
  | 'busy'
  | 'pending-changes'
  | 'tracking-unavailable'
  | 'draft-used'
  | 'too-long'
  | 'unsupported-text'
  | 'read-failed'
  | 'stale'
  | 'locked'
  | 'write-failed'
  | 'verification-failed'
  | 'rollback-failed';

const MODEL_OUTPUT_CODES: ReadonlySet<RewriteErrorCode> = new Set([
  'invalid-output',
  'placeholder-missing',
  'placeholder-unknown',
  'placeholder-moved',
  'placeholder-repeated',
  'placeholder-grouped',
]);

/**
 * A refused or failed rewrite. Every code except `rollback-failed` leaves the paragraph as it
 * was before the rewrite.
 *
 * @example
 * ```ts
 * try {
 *   const draft = await prepareRewrite(context, paragraph);
 *   await draft.apply(await callModel(`${draft.legend}\n\n${draft.text}`));
 * } catch (error) {
 *   if (error instanceof RewriteError && error.code === 'pending-changes') {
 *     // Decide the tracked changes in the paragraph first.
 *   } else throw error;
 * }
 * ```
 *
 * @public
 */
export class RewriteError extends Error {
  /** Always `'RewriteError'`. */
  override readonly name = 'RewriteError';
  /** What went wrong. See {@link RewriteErrorCode} for what to do next. */
  readonly code: RewriteErrorCode;
  /**
   * Whether the model output broke a rule. The message then explains the rule in words that you
   * can send back to the model.
   */
  readonly isModelError: boolean;
  /**
   * A second error that happened while the helper cleaned up after this one, such as a failure
   * to turn tracking off again. It never replaces this error.
   */
  suppressed?: unknown;

  constructor(code: RewriteErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.isModelError = MODEL_OUTPUT_CODES.has(code);
  }
}

/** The message of any thrown value, for an error that wraps it. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

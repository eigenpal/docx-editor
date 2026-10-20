/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The one error type the rewrite helper throws. Its `code` says what to do next: send the
// message back to the model, decide changes first, or prepare the paragraph again.

/**
 * Why a rewrite was refused or failed.
 *
 * - The model output broke a rule, and nothing was written. Send `error.message` back to the
 *   model and ask again: `invalid-output`, `placeholder-missing`, `placeholder-unknown`,
 *   `placeholder-moved`, `placeholder-repeated`, `placeholder-grouped`.
 * - Your `rewrite` function failed, and nothing was written: `model-failed` when it threw or
 *   timed out on every attempt, `context-used` when it used the request context, and `aborted`
 *   when `options.signal` aborted.
 * - The request context is in use, and nothing was written: `busy` when another helper call
 *   runs on it, and `context-used` when commands are queued on it that are not synced.
 * - The paragraph cannot take a rewrite now, and nothing was written: `pending-changes`,
 *   `tracking-unavailable`, `draft-used`, `too-long`, `unsupported-text`, `read-failed`.
 * - A write or the final check failed, and the helper rejected the changes it had written:
 *   `stale`, `locked`, `write-failed`, `verification-failed`.
 * - The rollback failed too, so the paragraph can hold some of the proposal: `rollback-failed`.
 *
 * @beta
 */
export type RewriteErrorCode =
  | 'invalid-output'
  | 'placeholder-missing'
  | 'placeholder-unknown'
  | 'placeholder-moved'
  | 'placeholder-repeated'
  | 'placeholder-grouped'
  | 'model-failed'
  | 'context-used'
  | 'aborted'
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
 *   await proposeRewrite(context, paragraph, rewrite);
 * } catch (error) {
 *   if (error instanceof RewriteError && error.code === 'pending-changes') {
 *     // Decide the tracked changes in the paragraph first.
 *   } else throw error;
 * }
 * ```
 *
 * @beta
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

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
 *   `placeholder-moved`, `placeholder-repeated`.
 * - Your `rewrite` function failed, and nothing was written: `model-failed` when it threw on
 *   every attempt, and `context-used` when it called `context.sync()`, which it must not do.
 * - The paragraph cannot take a rewrite now, and nothing was written: `pending-changes`,
 *   `tracking-unavailable`, `draft-used`, `too-long`, `unsupported-text`, `read-failed`.
 * - A write or the final check failed, and the helper rejected the changes it had written:
 *   `stale`, `locked`, `write-failed`, `verification-failed`.
 * - The rollback failed too, so the paragraph can hold some of the proposal: `rollback-failed`.
 *
 * @public
 */
export type RewriteErrorCode =
  | 'invalid-output'
  | 'placeholder-missing'
  | 'placeholder-unknown'
  | 'placeholder-moved'
  | 'placeholder-repeated'
  | 'model-failed'
  | 'context-used'
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

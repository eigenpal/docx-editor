/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public types of the rewrite helper. Everything here is plain data, except the paragraph
// that a caller passes in and `RewriteDraft.apply`.

import type { Paragraph } from '@docx-editor.dev/editor-api';
import type { RewriteError } from './rewrite-error.ts';
import type { RewritePlaceholder } from './rewrite-plan.ts';

/**
 * How to build the prompt and check the model output.
 *
 * @public
 */
export interface RewriteOptions {
  /**
   * Your instruction for the model, such as `'Make it shorter.'`. It goes first in
   * `draft.prompt`. Without it, the prompt holds only the placeholder rules and the paragraph,
   * and you add your own instruction around it.
   */
  readonly instruction?: string;
  /**
   * Refuse output that leaves out a placeholder, with `placeholder-missing`. By default, a
   * left-out placeholder deletes what it stands for as one tracked deletion.
   */
  readonly keepPlaceholders?: boolean;
}

/**
 * Options of {@link proposeRewrite}.
 *
 * @public
 */
export interface ProposeRewriteOptions extends RewriteOptions {
  /**
   * How many more attempts to make, in all, after a refused answer, a thrown model call, a
   * `stale` failure, or a `verification-failed` failure. A refused answer asks the model again
   * with the reason; a thrown call calls again; the others prepare the paragraph again first.
   * A whole number from `0` to `5`; defaults to `2`. Other values are clamped into that range.
   */
  readonly retries?: number;
}

/**
 * Options of {@link proposeRewrites}.
 *
 * @public
 */
export interface ProposeRewritesOptions extends ProposeRewriteOptions {
  /**
   * How many paragraphs ask the model at once. The helper prepares every paragraph first, then
   * asks the model, with each paragraph's retries, for up to this many at a time, and then
   * writes the answers one paragraph after another. A whole number from `1` to `16`; defaults
   * to `4`.
   */
  readonly concurrency?: number;
}

/**
 * A refused model answer, given to the next attempt.
 *
 * @public
 */
export interface RewriteFeedback {
  /** The model output that the helper refused. */
  readonly output: string;
  /** Why the helper refused it. `error.isModelError` is always true here. */
  readonly error: RewriteError;
}

/**
 * A paragraph ready to send to a model: plain data, plus `apply()` for the answer.
 *
 * @public
 */
export interface RewriteDraft {
  /** The paragraph's `uniqueLocalId`. */
  readonly paragraphId: string;
  /** The paragraph text as it reads now. */
  readonly original: string;
  /**
   * The paragraph text with each field, picture, equation, note reference, line break, and
   * locked control as a placeholder, such as `Subject to ⟦1⟧, the fee applies`. A paragraph that
   * already contains `⟦` or `⟧` gets another bracket pair, such as `⟪1⟫`; read the exact
   * placeholders from `placeholders`.
   */
  readonly text: string;
  /** Each placeholder in `text`, in order, and what it stands for. */
  readonly placeholders: readonly RewritePlaceholder[];
  /**
   * The prompt to send to the model: your instruction, the placeholder rules and legend, and
   * `text`. On a retry, it also says why the previous answer was refused.
   */
  readonly prompt: string;
  /** Set on a retry after a model error: the refused answer and the reason. */
  readonly feedback?: RewriteFeedback;
  /**
   * Propose the model's answer as tracked changes. Either every change lands and the paragraph
   * reads as the answer, or the paragraph stays as it was and this throws a
   * {@link RewriteError}. After a model error, you can call it again with a new answer.
   */
  apply(modelText: string): Promise<RewriteResult>;
}

/**
 * What a proposed rewrite changed. Plain data.
 *
 * @public
 */
export interface RewriteResult {
  /** The paragraph's `uniqueLocalId`. */
  readonly paragraphId: string;
  /** The text before the rewrite: what rejecting every proposed change gives. */
  readonly original: string;
  /**
   * The text after the rewrite: what accepting every proposed change gives. As in
   * `getReviewedText`, an equation, a picture, or a note reference reads as U+FFFC, and a line
   * break as U+000B.
   */
  readonly proposed: string;
  /** How many tracked edits the helper wrote. `0` when the model changed nothing. */
  readonly changes: number;
}

/**
 * Your model call: take the draft, return the rewritten paragraph text.
 *
 * It runs outside the batch, so it must not use the request context or its proxies; while it
 * runs, `context.sync()` refuses with `context-used`. If it throws, the helper calls it again,
 * up to `retries` times, and then reports `model-failed` with your error as `cause`.
 *
 * @public
 */
export type RewriteFunction = (draft: RewriteDraft) => string | Promise<string>;

/**
 * One paragraph for {@link proposeRewrites}.
 *
 * @public
 */
export interface RewriteItem {
  /** The paragraph to rewrite. */
  readonly paragraph: Paragraph;
  /** Your model call for this paragraph. */
  readonly rewrite: RewriteFunction;
}

/**
 * The outcome of one {@link RewriteItem}, shaped like a `Promise.allSettled` result.
 *
 * @public
 */
export type RewriteSettledResult =
  | { readonly status: 'fulfilled'; readonly value: RewriteResult }
  | { readonly status: 'rejected'; readonly reason: RewriteError };

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public types of the rewrite helper. Everything here is plain data, except
// `RewriteDraft.check` and `RewriteDraft.apply`.

import type { RewriteError } from './rewrite-error.ts';
import type { RewritePlaceholder } from './rewrite-plan.ts';

/**
 * How to read the paragraph and check the model text.
 *
 * @public
 */
export interface PrepareRewriteOptions {
  /**
   * Refuse model text that leaves out a placeholder, with `placeholder-missing`. By default, a
   * left-out placeholder deletes what it stands for as one tracked deletion. `draft.legend`
   * states the rule that applies.
   */
  readonly keepPlaceholders?: boolean;
}

/**
 * A paragraph read for a model: plain data, plus `check()` and `apply()` for the model text.
 *
 * Build the prompt from `text` and `legend` with your own instruction, and call your model.
 * Then call `apply()` in the same `run()` as `prepareRewrite`.
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
   * The placeholder contract as plain text for a prompt: what a placeholder is, the rules (copy
   * each kept placeholder exactly, leave one out to delete it, keep the order, do not repeat
   * one), and one line per placeholder, such as `⟦1⟧ = equation`. An empty string when `text`
   * has no placeholder.
   *
   * It holds no instruction and no paragraph text. The descriptions come from the file, so treat
   * the legend as document data in your prompt, as you treat `text`.
   */
  readonly legend: string;
  /**
   * Check model text without writing. Returns the {@link RewriteError} that `apply()` would
   * throw before it writes, or `null` when `apply()` may go ahead. Most often the error is a
   * model error (`error.isModelError`), whose message you can send back to the model. It can
   * also be `draft-used`; `too-long`, when the text makes too many edits to compare; or
   * `verification-failed`, when the text differs only in spacing that the helper cannot write.
   *
   * A `null` result does not promise that the write succeeds: the document can change, and
   * `apply()` also checks the request context.
   */
  check(modelText: string): RewriteError | null;
  /**
   * Propose the model text as the fewest tracked changes. Either every change lands and the
   * paragraph reads as the model text, or the paragraph stays as it was and this throws a
   * {@link RewriteError}. After a model error, you can call it again with new model text. Call
   * it once at a time on a request context: a helper call that overlaps another throws `busy`.
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
  /**
   * How many word edits the helper wrote: each run of changed words counts once. A replacement
   * counts once, though `revisions.items` lists it as a `Delete` and an `Insert`. `0` when the
   * model changed nothing.
   */
  readonly changes: number;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Ask the model, retry, and write: `proposeRewrite` for one paragraph, `proposeRewrites` for many.
//
// Each paragraph goes through two phases. ANSWER calls the model and checks each answer against
// the draft without writing, asking again with the reason after a refused answer and calling
// again after a thrown call. WRITE applies the checked answer; after a `stale` or a
// `verification-failed` failure it prepares the paragraph again and answers again. For many
// paragraphs, the answer phases run concurrently and the write phases one after another.
//
// The model call runs outside any batch, so the request context must not be used inside it.
// While a model call runs, `context.sync()` refuses with a clear error instead of syncing work
// that the helper did not queue.

import type { Paragraph, RequestContext } from '@docx-editor.dev/editor-api';
import { messageOf, RewriteError } from './rewrite-error.ts';
import { prepareRewrite, validateAnswer } from './rewrite.ts';
import type {
  ProposeRewriteOptions,
  ProposeRewritesOptions,
  RewriteDraft,
  RewriteFeedback,
  RewriteFunction,
  RewriteItem,
  RewriteResult,
  RewriteSettledResult,
} from './rewrite-types.ts';
import { startTracking, stopTracking, writeFailure } from './rewrite-writes.ts';

const DEFAULT_RETRIES = 2;
const MAX_RETRIES = 5;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

/** A whole number in `[min, max]`, or `fallback` for anything that is not a finite number. */
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** The prompt of a retry: the first prompt, and why the previous answer was refused. */
function feedbackPrompt(prompt: string, feedback: RewriteFeedback): string {
  return (
    `${prompt}\n\nYour previous answer was refused: ${feedback.error.message}\n\n` +
    `Previous answer:\n${feedback.output}\n\nAnswer again.`
  );
}

/** How many model calls are running on each context, so the guard comes off after the last. */
const guards = new WeakMap<RequestContext, number>();

/** Make `context.sync()` refuse while `run` calls the model. */
async function guarded<T>(context: RequestContext, run: () => Promise<T>): Promise<T> {
  const count = guards.get(context) ?? 0;
  guards.set(context, count + 1);
  if (count === 0) {
    Object.defineProperty(context, 'sync', {
      configurable: true,
      value: () =>
        Promise.reject(
          new RewriteError(
            'context-used',
            'The rewrite function called context.sync(). It runs outside the batch, so it must ' +
              'not use the request context or its proxies. Read what the model needs from the ' +
              'draft, and make other edits before or after the rewrite.'
          )
        ),
    });
  }
  try {
    return await run();
  } finally {
    const left = (guards.get(context) ?? 1) - 1;
    guards.set(context, left);
    if (left === 0) delete (context as unknown as { sync?: unknown }).sync;
  }
}

/** Call the model, and report a thrown call as `model-failed`. */
async function callModel(
  context: RequestContext,
  rewrite: RewriteFunction,
  draft: RewriteDraft
): Promise<string> {
  try {
    return String(await guarded(context, async () => rewrite(draft)));
  } catch (error) {
    if (error instanceof RewriteError && error.code === 'context-used') throw error;
    throw new RewriteError('model-failed', `The rewrite function failed: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

/** A checked answer, the draft it answers, and the retries left. */
interface Answer {
  readonly draft: RewriteDraft;
  readonly output: string;
  readonly retries: number;
}

/**
 * Ask the model until an answer passes the draft's checks or retries run out. A refused answer
 * asks again with the reason; a thrown call calls again with the same draft.
 */
async function answer(
  context: RequestContext,
  rewrite: RewriteFunction,
  prepared: RewriteDraft,
  retries: number
): Promise<Answer> {
  let draft = prepared;
  for (;;) {
    let output: string;
    try {
      output = await callModel(context, rewrite, draft);
    } catch (error) {
      if (error instanceof RewriteError && error.code === 'model-failed' && retries > 0) {
        retries -= 1;
        continue;
      }
      throw error;
    }
    try {
      validateAnswer(prepared, output);
      return { draft, output, retries };
    } catch (error) {
      if (!(error instanceof RewriteError) || !error.isModelError || retries === 0) throw error;
      retries -= 1;
      const feedback = { output, error };
      // The reason for the latest refusal only, on the prompt of the prepared draft.
      draft = { ...prepared, feedback, prompt: feedbackPrompt(prepared.prompt, feedback) };
    }
  }
}

/** Write a checked answer; after `stale` or `verification-failed`, prepare and answer again. */
async function write(
  context: RequestContext,
  paragraph: Paragraph,
  rewrite: RewriteFunction,
  options: ProposeRewriteOptions,
  first: Answer
): Promise<RewriteResult> {
  let current = first;
  for (;;) {
    try {
      return await current.draft.apply(current.output);
    } catch (error) {
      const again =
        error instanceof RewriteError &&
        (error.code === 'stale' || error.code === 'verification-failed') &&
        current.retries > 0;
      if (!again) throw error;
      const prepared = await prepareRewrite(context, paragraph, options);
      current = await answer(context, rewrite, prepared, current.retries - 1);
    }
  }
}

/**
 * Ask a model to rewrite a paragraph, and propose its answer as the fewest tracked changes.
 *
 * Either every change lands and the paragraph reads as the answer, or the paragraph stays as it
 * was and this throws a {@link RewriteError}. The helper retries on its own, up to
 * `options.retries` times in all: after a refused answer it asks again with `draft.feedback`
 * set and the reason in `draft.prompt`; after a thrown model call it calls again; after a
 * `stale` or a `verification-failed` failure it prepares the paragraph again and asks again.
 *
 * If tracking is off, the helper turns on `TrackMineOnly` for its writes and turns it off again.
 * The `rewrite` function runs outside the batch: it must not use `context` or its proxies.
 *
 * @example
 * ```ts
 * import { proposeRewrite } from '@docx-editor.dev/editor-api/agent';
 *
 * await runtime.run(async (context) => {
 *   const paragraph = context.document.body.paragraphs.getFirst();
 *   const result = await proposeRewrite(context, paragraph, (draft) => callModel(draft.prompt), {
 *     instruction: 'Make it shorter.',
 *   });
 *   console.log(result.proposed);
 * });
 * ```
 *
 * @public
 */
export async function proposeRewrite(
  context: RequestContext,
  paragraph: Paragraph,
  rewrite: RewriteFunction,
  options: ProposeRewriteOptions = {}
): Promise<RewriteResult> {
  const retries = clamp(options.retries, DEFAULT_RETRIES, 0, MAX_RETRIES);
  const prepared = await prepareRewrite(context, paragraph, options);
  const first = await answer(context, rewrite, prepared, retries);
  return write(context, paragraph, rewrite, options, first);
}

/** Run `task` for every index, at most `limit` at a time, and settle every one. */
async function pooled<T>(
  count: number,
  limit: number,
  task: (index: number) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return results;
}

/** Any failure as a {@link RewriteError}, so every item settles. */
function asRewriteError(error: unknown): RewriteError {
  return error instanceof RewriteError ? error : writeFailure(error);
}

/**
 * Rewrite several paragraphs, and settle every one. Each paragraph gets the guarantee of
 * {@link proposeRewrite}: all of its changes, or none.
 *
 * The helper prepares every paragraph, then asks the model for up to `options.concurrency`
 * paragraphs at a time, with the retries of each paragraph in that phase too. Then it writes
 * the checked answers one paragraph after another, in order. `TrackMineOnly` stays on for the
 * whole write phase, and the helper turns it off again at the end if it was off.
 *
 * A paragraph that fails has `status: 'rejected'` and a {@link RewriteError} as `reason`,
 * including `model-failed` when your `rewrite` function still throws after the retries. The
 * other paragraphs are not affected. Pass each paragraph once.
 *
 * @example
 * ```ts
 * const results = await proposeRewrites(
 *   context,
 *   paragraphs.map((paragraph) => ({ paragraph, rewrite: (draft) => callModel(draft.prompt) })),
 *   { instruction: 'Use plain language.', concurrency: 4 }
 * );
 * ```
 *
 * @public
 */
export async function proposeRewrites(
  context: RequestContext,
  items: readonly RewriteItem[],
  options: ProposeRewritesOptions = {}
): Promise<RewriteSettledResult[]> {
  const retries = clamp(options.retries, DEFAULT_RETRIES, 0, MAX_RETRIES);
  const limit = clamp(options.concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);
  const drafts: (RewriteDraft | RewriteError)[] = [];
  for (const { paragraph } of items) {
    drafts.push(await prepareRewrite(context, paragraph, options).catch(asRewriteError));
  }
  const ready = drafts.flatMap((draft, index) => (draft instanceof RewriteError ? [] : [index]));
  const answers = await pooled(ready.length, limit, (at) => {
    const index = ready[at]!;
    return answer(context, items[index]!.rewrite, drafts[index] as RewriteDraft, retries);
  });
  const answerOf = new Map(ready.map((index, at) => [index, answers[at]!]));

  // Turn tracking on once for every paragraph, rather than once per paragraph.
  const restore = ready.length > 0 ? await startTracking(context).catch(() => false) : false;
  const results: RewriteSettledResult[] = [];
  try {
    for (const [index, item] of items.entries()) {
      const draft = drafts[index]!;
      const settled = answerOf.get(index);
      if (draft instanceof RewriteError || !settled) {
        results.push({ status: 'rejected', reason: draft as RewriteError });
      } else if (settled.status === 'rejected') {
        results.push({ status: 'rejected', reason: asRewriteError(settled.reason) });
      } else {
        try {
          const value = await write(context, item.paragraph, item.rewrite, options, settled.value);
          results.push({ status: 'fulfilled', value });
        } catch (error) {
          results.push({ status: 'rejected', reason: asRewriteError(error) });
        }
      }
    }
  } finally {
    if (restore) await stopTracking(context).catch(() => undefined);
  }
  return results;
}

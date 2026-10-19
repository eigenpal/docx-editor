/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Propose a model's rewrite of a paragraph as the fewest tracked changes.
//
// A helper NEXT TO the object model, not a member of it: every document call here is an
// Office.js-shaped public call (`getTextRanges`, `search`, `getRange`, `expandTo`, `insertText`,
// `delete`, `getReviewedText`, `Revision.reject`). Two non-enumerable hooks are the exception: the
// request context answers the runtime's author, so a caller never passes it twice, and a revision
// answers an identity key, so a rollback rejects exactly the changes this rewrite made.
//
// ALL OR NOTHING. The paragraph must hold no tracked change when the draft is prepared. Each
// write records the identity of the revisions it made; when a write or the final check fails,
// the helper rejects exactly those and throws. In collaboration, a participant's edit between
// two writes makes the next write fail with `StaleDocument`; the rollback re-reads the document
// first, so it rejects on the current revision.
//
// Type imports only, through the package's root entry. This entry is its own bundle, and a value
// import would carry a second copy of the runtime into it. Naming the root entry's types keeps
// one declaration of each, so a `Paragraph` from the root or the browser entry fits.

import type { Paragraph, RequestContext } from '@docx-editor.dev/editor-api';
import { messageOf, RewriteError } from './rewrite-error.ts';
import {
  checkOutput,
  draftText,
  expandedOutput,
  hunksOf,
  placeholderOf,
  promptOf,
  type RewritePlaceholder,
} from './rewrite-plan.ts';
import type {
  ProposeRewriteOptions,
  ProposeRewritesOptions,
  RewriteDraft,
  RewriteFeedback,
  RewriteFunction,
  RewriteItem,
  RewriteOptions,
  RewriteResult,
  RewriteSettledResult,
} from './rewrite-types.ts';
import { readUnits } from './rewrite-units.ts';
import {
  rollback,
  startTracking,
  stopTracking,
  writeFailure,
  writeHunks,
} from './rewrite-writes.ts';

const AUTHOR_HOOK = Symbol.for('@docx-editor.dev/editor-api/author');
const DEFAULT_RETRIES = 2;
const MAX_RETRIES = 5;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

/** The runtime's author, from the request context's hook. */
function authorOf(context: RequestContext): string | undefined {
  const author = (context as unknown as Record<symbol, unknown>)[AUTHOR_HOOK];
  return typeof author === 'string' ? author : undefined;
}

/** A whole number in `[min, max]`, or `fallback` for anything that is not a finite number. */
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

const concurrentEdit = () =>
  new RewriteError(
    'stale',
    'Another edit changed the paragraph during the rewrite. Prepare the paragraph again and retry.'
  );

const notProposed = () =>
  new RewriteError(
    'verification-failed',
    'The proposed paragraph would not read as the model output.'
  );

/** The prompt of a retry: the first prompt, and why the previous answer was refused. */
function feedbackPrompt(prompt: string, feedback: RewriteFeedback): string {
  return (
    `${prompt}\n\nYour previous answer was refused: ${feedback.error.message}\n\n` +
    `Previous answer:\n${feedback.output}\n\nAnswer again.`
  );
}

/** Call the model, and report its failure as `model-failed`. */
async function callModel(rewrite: RewriteFunction, draft: RewriteDraft): Promise<string> {
  try {
    return String(await rewrite(draft));
  } catch (error) {
    throw new RewriteError('model-failed', `The rewrite function failed: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

/**
 * Read a paragraph for a model. The draft is plain data: send `draft.prompt` to the model, then
 * pass its answer to `draft.apply()` in the same `run()`.
 *
 * Throws a {@link RewriteError}: `pending-changes` when the paragraph has tracked changes,
 * `tracking-unavailable` when the runtime has no author, and `read-failed` when the document
 * refuses a read.
 *
 * @example
 * ```ts
 * const draft = await prepareRewrite(context, paragraph, { instruction: 'Make it formal.' });
 * const result = await draft.apply(await callModel(draft.prompt));
 * ```
 *
 * @public
 */
export async function prepareRewrite(
  context: RequestContext,
  paragraph: Paragraph,
  options: RewriteOptions = {}
): Promise<RewriteDraft> {
  const author = authorOf(context);
  if (author === undefined) {
    throw new RewriteError(
      'tracking-unavailable',
      'The runtime has no author, so it cannot record tracked changes. Pass `author` when you ' +
        'create the runtime.'
    );
  }
  const { units, paragraphId } = await readUnits(context, paragraph).catch((error: unknown) => {
    if (error instanceof RewriteError) throw error;
    throw new RewriteError('read-failed', `The document refused a read: ${messageOf(error)}`, {
      cause: error,
    });
  });
  const placeholders: RewritePlaceholder[] = units.flatMap((unit) =>
    unit.atom === null || unit.kind === null
      ? []
      : [
          {
            placeholder: placeholderOf(unit.atom),
            kind: unit.kind,
            text: unit.text,
            description: unit.description,
          },
        ]
  );
  const original = units.map((unit) => unit.text).join('');
  const text = draftText(units);
  const keepPlaceholders = options.keepPlaceholders === true;
  let used = false;

  const write = async (output: string, expected: string): Promise<RewriteResult> => {
    const hunks = hunksOf(units, output);
    if (hunks.length === 0) {
      if (expected !== original.trim()) throw notProposed();
      return { paragraphId, original, proposed: original, changes: 0 };
    }
    used = true;
    const own = new Map<string, number>();
    try {
      await writeHunks(context, paragraph, units, hunks, author, own);
      const proposed = paragraph.getReviewedText('Current');
      const before = paragraph.getReviewedText('Original');
      await context.sync();
      // Another participant's edit can land between the writes without making one of them
      // stale, when it is after every range the writes use. The original text then moved.
      if (before.value !== original) throw concurrentEdit();
      if (proposed.value.trim() !== expected) throw notProposed();
      return { paragraphId, original, proposed: proposed.value, changes: hunks.length };
    } catch (error) {
      const failure = writeFailure(error);
      try {
        await rollback(context, paragraph, paragraphId, own);
      } catch (rollbackError) {
        throw new RewriteError(
          'rollback-failed',
          `${failure.message} Rejecting the rewrite's changes failed too, so the paragraph can ` +
            'hold some of them.',
          { cause: new AggregateError([failure, rollbackError]) }
        );
      }
      throw failure;
    }
  };

  const apply = async (modelText: string): Promise<RewriteResult> => {
    if (used) {
      throw new RewriteError(
        'draft-used',
        'This draft already wrote to the paragraph. Prepare the paragraph again.'
      );
    }
    const output = String(modelText).trim();
    checkOutput(output, placeholders, keepPlaceholders);
    const expected = expandedOutput(output, placeholders);
    const restore = await startTracking(context);
    let result: RewriteResult;
    try {
      result = await write(output, expected);
    } catch (error) {
      if (restore) {
        // Never let the cleanup replace the real error.
        await stopTracking(context).catch((stopError: unknown) => {
          if (error instanceof RewriteError) error.suppressed = stopError;
        });
      }
      throw error;
    }
    // The proposal stands even if turning tracking off again fails. The runtime then keeps
    // `TrackMineOnly`, which `document.changeTrackingMode` reads.
    if (restore) await stopTracking(context).catch(() => undefined);
    return result;
  };

  return {
    paragraphId,
    original,
    text,
    placeholders,
    prompt: promptOf(text, placeholders, options.instruction),
    apply,
  };
}

/**
 * Apply answers to one paragraph until one lands or retries run out. `first` is a draft and a
 * model answer that are already on their way.
 */
async function settle(
  context: RequestContext,
  paragraph: Paragraph,
  rewrite: RewriteFunction,
  options: ProposeRewriteOptions,
  first?: { readonly draft: RewriteDraft; readonly output: Promise<string> }
): Promise<RewriteResult> {
  let retries = clamp(options.retries, DEFAULT_RETRIES, 0, MAX_RETRIES);
  let prepared = first?.draft ?? (await prepareRewrite(context, paragraph, options));
  let draft = prepared;
  let pending = first?.output;
  for (;;) {
    const output = await (pending ?? callModel(rewrite, draft));
    pending = undefined;
    try {
      return await draft.apply(output);
    } catch (error) {
      if (!(error instanceof RewriteError) || retries === 0) throw error;
      if (error.code === 'stale' || error.code === 'verification-failed') {
        retries -= 1;
        prepared = await prepareRewrite(context, paragraph, options);
        draft = prepared;
        continue;
      }
      if (!error.isModelError) throw error;
      retries -= 1;
      const feedback = { output, error };
      // The reason for the latest refusal only, on the prompt of the prepared draft.
      draft = { ...prepared, feedback, prompt: feedbackPrompt(prepared.prompt, feedback) };
    }
  }
}

/**
 * Ask a model to rewrite a paragraph, and propose its answer as the fewest tracked changes.
 *
 * Either every change lands and the paragraph reads as the answer, or the paragraph stays as it
 * was and this throws a {@link RewriteError}. After a model error, the helper calls `rewrite`
 * again with `draft.feedback` set and the reason in `draft.prompt`. After a `stale` or a
 * `verification-failed` failure, it prepares the paragraph again and calls `rewrite` again.
 * `options.retries` caps both, and defaults to `2`.
 *
 * If tracking is off, the helper turns on `TrackMineOnly` for its writes and turns it off again.
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
  return settle(context, paragraph, rewrite, options);
}

/** Start `task` for every index, at most `limit` at a time. Each promise settles on its own. */
function pooled<T>(count: number, limit: number, task: (index: number) => Promise<T>) {
  const results: Promise<T>[] = [];
  const starts: (() => void)[] = [];
  let running = 0;
  const pump = () => {
    while (running < limit && starts.length > 0) starts.shift()!();
  };
  for (let index = 0; index < count; index += 1) {
    results.push(
      new Promise<T>((resolve, reject) => {
        starts.push(() => {
          running += 1;
          task(index)
            .then(resolve, reject)
            .finally(() => {
              running -= 1;
              pump();
            });
        });
      })
    );
  }
  pump();
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
 * The helper prepares every paragraph first, calls the model for up to `options.concurrency`
 * paragraphs at a time, and writes the answers one paragraph after another, in order. Model
 * errors are retried per paragraph, as in {@link proposeRewrite}. A paragraph that still fails
 * has `status: 'rejected'` and a {@link RewriteError} as `reason`, including `model-failed` when
 * your `rewrite` function throws. The other paragraphs are not affected. Pass each paragraph
 * once.
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
  const drafts: (RewriteDraft | RewriteError)[] = [];
  for (const { paragraph } of items) {
    drafts.push(await prepareRewrite(context, paragraph, options).catch(asRewriteError));
  }
  const limit = clamp(options.concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);
  const ready = drafts.flatMap((draft, index) => (draft instanceof RewriteError ? [] : [index]));
  const answers = new Map<number, Promise<string>>();
  pooled(ready.length, limit, (at) => {
    const index = ready[at]!;
    return callModel(items[index]!.rewrite, drafts[index] as RewriteDraft);
  }).forEach((answer, at) => {
    // Observed now, so a failed call is never an unhandled rejection; awaited in order below.
    answer.catch(() => undefined);
    answers.set(ready[at]!, answer);
  });

  // Turn tracking on once for every paragraph, rather than once per paragraph.
  const restore = ready.length > 0 ? await startTracking(context).catch(() => false) : false;
  const results: RewriteSettledResult[] = [];
  try {
    for (const [index, item] of items.entries()) {
      const draft = drafts[index]!;
      if (draft instanceof RewriteError) {
        results.push({ status: 'rejected', reason: draft });
        continue;
      }
      try {
        const value = await settle(context, item.paragraph, item.rewrite, options, {
          draft,
          output: answers.get(index)!,
        });
        results.push({ status: 'fulfilled', value });
      } catch (error) {
        results.push({ status: 'rejected', reason: asRewriteError(error) });
      }
    }
  } finally {
    if (restore) await stopTracking(context).catch(() => undefined);
  }
  return results;
}

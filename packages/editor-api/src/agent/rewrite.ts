/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Propose a model's rewrite of a paragraph as the fewest tracked changes.
//
// A helper NEXT TO the object model, not a member of it: every document call here is an
// Office.js-shaped public call (`getTextRanges`, `expandTo`, `insertText`, `delete`,
// `getReviewedText`, `Revision.reject`). The one exception is the author, which the helper reads
// through a non-enumerable hook on the request context, so a caller never passes it twice.
//
// ALL OR NOTHING. The paragraph must hold no tracked change when the draft is prepared, so every
// change by the runtime's author in it afterwards is one this helper wrote. When a write or the
// final check fails, the helper rejects exactly those changes and throws. In collaboration, a
// participant's edit between two writes makes the next write fail with `StaleDocument`; the
// rollback re-reads the document first, so it rejects on the current revision.
//
// Type imports only, through the package's root entry. This entry is its own bundle, and a value
// import would carry a second copy of the runtime into it. Naming the root entry's types keeps
// one declaration of each, so a `Paragraph` from either entry fits these signatures.

import type { Paragraph, Range, RequestContext } from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';
import {
  checkOutput,
  coreOf,
  draftText,
  expandedOutput,
  hunksOf,
  placeholderOf,
  promptOf,
  type RewritePlaceholder,
  type RewritePlaceholderKind,
} from './rewrite-plan.ts';
import {
  queueHunk,
  rollback,
  startTracking,
  stopTracking,
  writeFailure,
} from './rewrite-writes.ts';

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
 * Options of {@link proposeRewrite} and {@link proposeRewrites}.
 *
 * @public
 */
export interface ProposeRewriteOptions extends RewriteOptions {
  /**
   * How many more times to ask the model after a model error, or to prepare the paragraph again
   * after a `stale` failure. Each retry calls your `rewrite` function again. Defaults to `2`;
   * `0` turns retries off.
   */
  readonly retries?: number;
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
  /** The paragraph text with each field, picture, equation, note reference, and locked control as `⟦n⟧`. */
  readonly text: string;
  /** Each placeholder in `text`, in order, and the text it stands for. */
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
  /** The text after the rewrite: what accepting every proposed change gives. */
  readonly proposed: string;
  /** How many tracked edits the helper wrote. `0` when the model changed nothing. */
  readonly changes: number;
}

/**
 * Your model call: take the draft, return the rewritten paragraph text.
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

/** One word, or one atom that the model must keep whole, as a run of word ranges. */
interface Unit {
  readonly first: Range;
  readonly last: Range;
  /** The text the paragraph reads for this unit, with its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for a word. */
  readonly atom: number | null;
  readonly kind: RewritePlaceholderKind | null;
}

const AUTHOR_HOOK = Symbol.for('@docx-editor.dev/editor-api/author');
const DEFAULT_RETRIES = 2;

/** The runtime's author, from the request context's hook. */
function authorOf(context: RequestContext): string | undefined {
  const author = (context as unknown as Record<symbol, unknown>)[AUTHOR_HOOK];
  return typeof author === 'string' ? author : undefined;
}

/** The kind of atom a word range is, or null for a plain word. */
function kindOf(
  word: Range,
  fields: number,
  pictures: number,
  locked: boolean
): RewritePlaceholderKind | null {
  if (locked) return 'content-control';
  if (fields > 0) return 'field';
  if (pictures > 0) return 'picture';
  return word.text.includes('\uFFFC') ? 'equation-or-note' : null;
}

/** Read the paragraph as units: words, and atoms that change whole. Two syncs. */
async function readUnits(
  context: RequestContext,
  paragraph: Paragraph
): Promise<{ units: Unit[]; paragraphId: string; tracking: string }> {
  const words = paragraph.getTextRanges([' ', '\t']);
  const revisions = paragraph.getRange('Whole').revisions;
  words.load('items/text');
  revisions.load('items');
  paragraph.load('uniqueLocalId');
  context.document.load('changeTrackingMode');
  await context.sync();
  // The rollback rejects the author's changes in the paragraph, so it must start with none.
  if (revisions.items.length > 0) {
    throw new RewriteError(
      'pending-changes',
      'The paragraph has tracked changes. Accept or reject them before you rewrite it.'
    );
  }

  // One sync reads the fields, pictures, and content controls of every word.
  const reads = words.items.map((word) => {
    const fields = word.fields;
    const pictures = word.inlinePictures;
    const controls = word.contentControls;
    fields.load('items');
    pictures.load('items');
    controls.load('items/tag,items/cannotEdit,items/text');
    return { word, fields, pictures, controls };
  });
  await context.sync();

  const units: Unit[] = [];
  let atoms = 0;
  let lockedKey: string | null = null;
  for (const { word, fields, pictures, controls } of reads) {
    const locked = controls.items.find((control) => control.cannotEdit);
    const key = locked ? `${locked.tag}\u0000${locked.text}` : null;
    const previous = units[units.length - 1];
    if (key !== null && key === lockedKey && previous) {
      // The words of one locked control form one atom.
      units[units.length - 1] = { ...previous, last: word, text: previous.text + word.text };
      continue;
    }
    lockedKey = key;
    const kind = kindOf(word, fields.items.length, pictures.items.length, locked !== undefined);
    const atom = kind === null ? null : ++atoms;
    units.push({ first: word, last: word, text: word.text, atom, kind });
  }
  return {
    units,
    paragraphId: paragraph.uniqueLocalId,
    tracking: context.document.changeTrackingMode,
  };
}

const concurrentEdit = () =>
  new RewriteError(
    'stale',
    'Another edit changed the paragraph during the rewrite. Prepare the paragraph again and retry.'
  );

const notProposed = () =>
  new RewriteError(
    'verification-failed',
    'The proposed paragraph would not read as the model output. Keep the spacing around each ' +
      'placeholder as the paragraph has it.'
  );

/** The prompt of a retry: the first prompt, and why the previous answer was refused. */
function feedbackPrompt(prompt: string, feedback: RewriteFeedback): string {
  return (
    `${prompt}\n\nYour previous answer was refused: ${feedback.error.message}\n\n` +
    `Previous answer:\n${feedback.output}\n\nAnswer again.`
  );
}

/**
 * Read a paragraph for a model. The draft is plain data: send `draft.prompt` to the model, then
 * pass its answer to `draft.apply()` in the same `run()`.
 *
 * Throws a {@link RewriteError}: `pending-changes` when the paragraph has tracked changes, and
 * `tracking-unavailable` when the runtime has no author.
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
  const { units, paragraphId, tracking } = await readUnits(context, paragraph);
  const placeholders: RewritePlaceholder[] = units.flatMap((unit) =>
    unit.atom === null || unit.kind === null
      ? []
      : [{ placeholder: placeholderOf(unit.atom), kind: unit.kind, text: coreOf(unit.text) }]
  );
  const original = units.map((unit) => unit.text).join('');
  const text = draftText(units);
  const keepPlaceholders = options.keepPlaceholders === true;
  let used = false;

  const apply = async (modelText: string): Promise<RewriteResult> => {
    if (used) {
      throw new RewriteError(
        'draft-used',
        'This draft already wrote to the paragraph. Prepare the paragraph again.'
      );
    }
    const output = String(modelText).trim();
    checkOutput(output, placeholders, keepPlaceholders);
    const hunks = hunksOf(units, output);
    const expected = expandedOutput(output, placeholders);
    if (hunks.length === 0) {
      // Only spacing that an atom keeps can differ here, and the helper cannot write it.
      if (expected !== original.trim()) throw notProposed();
      return { paragraphId, original, proposed: original, changes: 0 };
    }
    used = true;

    const restore = await startTracking(context, tracking);
    let wrote = false;
    try {
      // From the last hunk to the first, so the ranges before each edit stay valid.
      for (const hunk of [...hunks].reverse()) {
        queueHunk(paragraph, units, hunk);
        // Set before the sync: a sync that fails after it commits still leaves a change.
        wrote = true;
        await context.sync();
      }
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
      if (wrote) {
        try {
          await rollback(context, paragraph, paragraphId, author);
        } catch (rollbackError) {
          throw new RewriteError(
            'rollback-failed',
            `${failure.message} Rejecting the rewrite's changes failed too, so the paragraph can ` +
              `hold some of the changes by ${author}.`,
            { cause: new AggregateError([failure, rollbackError]) }
          );
        }
      }
      throw failure;
    } finally {
      if (restore) await stopTracking(context, tracking);
    }
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
 * Ask a model to rewrite a paragraph, and propose its answer as the fewest tracked changes.
 *
 * Either every change lands and the paragraph reads as the answer, or the paragraph stays as it
 * was and this throws a {@link RewriteError}. After a model error, the helper calls `rewrite`
 * again with `draft.feedback` set and the reason in `draft.prompt`. After a `stale` failure, it
 * prepares the paragraph again and calls `rewrite` again. `options.retries` caps both, and
 * defaults to `2`.
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
  let retries = Math.max(0, Math.floor(options.retries ?? DEFAULT_RETRIES));
  for (;;) {
    const prepared = await prepareRewrite(context, paragraph, options);
    let draft = prepared;
    for (;;) {
      const output = await rewrite(draft);
      try {
        return await draft.apply(output);
      } catch (error) {
        if (!(error instanceof RewriteError) || retries === 0) throw error;
        if (error.code === 'stale') {
          retries -= 1;
          break;
        }
        if (!error.isModelError) throw error;
        retries -= 1;
        const feedback = { output: String(output), error };
        // The reason for the latest refusal only, on the prompt of the prepared draft.
        draft = { ...prepared, feedback, prompt: feedbackPrompt(prepared.prompt, feedback) };
      }
    }
  }
}

/**
 * Rewrite several paragraphs, one after another. Each paragraph gets the guarantee of
 * {@link proposeRewrite}: all of its changes, or none. A refused paragraph does not stop the
 * others; its result has `status: 'rejected'`. An error that is not a {@link RewriteError}, such
 * as one your `rewrite` function throws, stops the batch and propagates. The paragraphs before
 * it keep their proposals.
 *
 * @public
 */
export async function proposeRewrites(
  context: RequestContext,
  items: readonly RewriteItem[],
  options: ProposeRewriteOptions = {}
): Promise<RewriteSettledResult[]> {
  const results: RewriteSettledResult[] = [];
  for (const { paragraph, rewrite } of items) {
    try {
      const value = await proposeRewrite(context, paragraph, rewrite, options);
      results.push({ status: 'fulfilled', value });
    } catch (error) {
      if (!(error instanceof RewriteError)) throw error;
      results.push({ status: 'rejected', reason: error });
    }
  }
  return results;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Prepare a paragraph for a model, and propose the model's answer as the fewest tracked changes.
//
// A helper NEXT TO the object model, not a member of it: every document call here is an
// Office.js-shaped public call (`getTextRanges`, `search`, `getRange`, `expandTo`, `insertText`,
// `delete`, `getReviewedText`, `Revision.reject`). The one exception is the author, which the
// request context answers through a non-enumerable hook, so a caller never passes it twice.
//
// ALL OR NOTHING. The paragraph must hold no tracked change when the draft is prepared. Each
// write records the signatures of the revisions it made; when a write or the final check fails,
// the helper rejects exactly those, checks that the paragraph reads as it did, and throws.
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
  syntaxFor,
  type Hunk,
  type RewritePlaceholder,
} from './rewrite-plan.ts';
import type { RewriteDraft, RewriteOptions, RewriteResult } from './rewrite-types.ts';
import { assertNothingQueued, exclusive } from './rewrite-guard.ts';
import { readUnits } from './rewrite-units.ts';
import {
  rollback,
  startTracking,
  stopTracking,
  writeFailure,
  writeHunks,
} from './rewrite-writes.ts';

const AUTHOR_HOOK = Symbol.for('@docx-editor.dev/editor-api/author');

/** Each prepared draft's internals, for the helpers that answer before writing. */
const internals = new WeakMap<
  RewriteDraft,
  { readonly validate: (modelText: string) => void; readonly apply: RewriteDraft['apply'] }
>();

/**
 * Check a model answer against a prepared draft without writing: throws the model error that
 * `apply()` would throw before it writes.
 */
export function validateAnswer(draft: RewriteDraft, modelText: string): void {
  internals.get(draft)?.validate(modelText);
}

/** Apply an answer from inside a helper call that already holds the context. */
export function applyHeld(draft: RewriteDraft, modelText: string): Promise<RewriteResult> {
  const held = internals.get(draft);
  return held ? held.apply(modelText) : draft.apply(modelText);
}

/** The runtime's author, from the request context's hook. */
function authorOf(context: RequestContext): string | undefined {
  const author = (context as unknown as Record<symbol, unknown>)[AUTHOR_HOOK];
  return typeof author === 'string' ? author : undefined;
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
  return exclusive(context, () => prepareHeld(context, paragraph, options));
}

/** {@link prepareRewrite} from inside a helper call that already holds the context. */
export async function prepareHeld(
  context: RequestContext,
  paragraph: Paragraph,
  options: RewriteOptions
): Promise<RewriteDraft> {
  assertNothingQueued(context);
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
  const original = units.map((unit) => unit.text).join('');
  const syntax = syntaxFor(original);
  const placeholders: RewritePlaceholder[] = units.flatMap((unit) =>
    unit.atom === null || unit.kind === null
      ? []
      : [
          {
            placeholder: placeholderOf(unit.atom, syntax),
            kind: unit.kind,
            text: unit.text,
            description: unit.description,
          },
        ]
  );
  const text = draftText(units, syntax);
  const keepPlaceholders = options.keepPlaceholders === true;
  let used = false;

  /** The answer's hunks and the text it should read as, or the model error it breaks. */
  const plan = (modelText: string): { output: string; hunks: Hunk[]; expected: string } => {
    const output = String(modelText).trim();
    checkOutput(output, placeholders, keepPlaceholders, syntax, original);
    const hunks = hunksOf(units, output, syntax);
    const expected = expandedOutput(output, placeholders, syntax);
    // Only spacing an atom keeps can differ without a hunk, and the helper cannot write it.
    if (hunks.length === 0 && expected !== original.trim()) throw notProposed();
    return { output, hunks, expected };
  };

  const write = async (hunks: Hunk[], expected: string): Promise<RewriteResult> => {
    used = true;
    const own = new Map<string, number>();
    const progress = { wrote: false };
    try {
      await writeHunks(context, paragraph, units, hunks, author, own, progress);
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
        await rollback(context, paragraph, paragraphId, own, original, progress.wrote);
      } catch (rollbackError) {
        throw new RewriteError(
          'rollback-failed',
          `${failure.message} Rejecting the rewrite's changes failed too: ` +
            `${messageOf(rollbackError)}`,
          { cause: new AggregateError([failure, rollbackError]) }
        );
      }
      throw failure;
    }
  };

  const applyNow = async (modelText: string): Promise<RewriteResult> => {
    assertNothingQueued(context);
    if (used) {
      throw new RewriteError(
        'draft-used',
        'This draft already wrote to the paragraph. Prepare the paragraph again.'
      );
    }
    const { hunks, expected } = plan(modelText);
    if (hunks.length === 0) return { paragraphId, original, proposed: original, changes: 0 };
    const restore = await startTracking(context);
    let result: RewriteResult;
    try {
      result = await write(hunks, expected);
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

  const draft: RewriteDraft = {
    paragraphId,
    original,
    text,
    placeholders,
    prompt: promptOf(text, placeholders, options.instruction, syntax),
    apply: (modelText) => exclusive(context, () => applyNow(modelText)),
  };
  internals.set(draft, { validate: (modelText) => void plan(modelText), apply: applyNow });
  return draft;
}

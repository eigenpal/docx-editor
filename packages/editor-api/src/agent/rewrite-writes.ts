/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The writes of the rewrite helper: one hunk per sync, the tracking mode around them, and the
// rollback that rejects only the helper's own changes. Every call is an Office.js-shaped public
// call; refusals are read by shape, because this entry is its own bundle.
//
// OWN CHANGES BY SIGNATURE. The helper reads the paragraph's revisions before its first write and
// after each write. The revisions that are new after a write and carry the runtime's author are
// the ones the write made; their signatures (type, author, date, and text) are recorded. A
// rollback rejects exactly those, so a worker or a person who shares the author name keeps the
// changes they make before the rewrite, during the model call, or after a failed write.

import type { Paragraph, Revision, RequestContext } from '@docx-editor.dev/editor-api';
import { helperSync } from './rewrite-guard.ts';
import { messageOf, RewriteError } from './rewrite-error.ts';
import type { Hunk } from './rewrite-plan.ts';
import type { Unit } from './rewrite-units.ts';

/** How many times a write tries again after another participant's edit. */
const MAX_STALE_ATTEMPTS = 3;

/** The error code and rule of a refused sync, or null for any other error. */
export function refusalOf(error: unknown): { code: string; rule: string | undefined } | null {
  if (typeof error !== 'object' || error === null) return null;
  const { name, code, debugInfo } = error as {
    name?: unknown;
    code?: unknown;
    debugInfo?: { innerError?: { code?: unknown } };
  };
  if (name !== 'DocxEditorError' || typeof code !== 'string') return null;
  const rule = debugInfo?.innerError?.code;
  return { code, rule: typeof rule === 'string' ? rule : undefined };
}

const isStale = (error: unknown): boolean => refusalOf(error)?.code === 'StaleDocument';

/** A failed write as a {@link RewriteError}. */
export function writeFailure(error: unknown): RewriteError {
  if (error instanceof RewriteError) return error;
  const refusal = refusalOf(error);
  if (refusal?.code === 'StaleDocument') {
    return new RewriteError(
      'stale',
      'Another edit changed the document during the rewrite. Prepare the paragraph again and ' +
        'retry.',
      { cause: error }
    );
  }
  if (refusal?.rule === 'edit.protected-content') {
    return new RewriteError(
      'locked',
      'The rewrite edits protected content, such as part of a locked content control.',
      { cause: error }
    );
  }
  const reason = refusal
    ? `${refusal.code}${refusal.rule === undefined ? '' : ` (${refusal.rule})`}`
    : messageOf(error);
  return new RewriteError('write-failed', `The document refused an edit: ${reason}`, {
    cause: error,
  });
}

/**
 * Queue a write and sync, after a read that brings the context up to date. A read-only sync
 * never fails on another participant's edit, so only an edit between the read and the write
 * makes this try again. `queue` answers false when there is nothing to write.
 */
async function writeFresh(context: RequestContext, queue: () => boolean): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    context.document.load('changeTrackingMode');
    await helperSync(context);
    if (!queue()) return;
    try {
      await helperSync(context);
      return;
    } catch (error) {
      if (attempt === MAX_STALE_ATTEMPTS || !isStale(error)) throw error;
    }
  }
}

/** Turn on `TrackMineOnly` if it is off. Answers whether the helper changed the mode. */
export async function startTracking(context: RequestContext): Promise<boolean> {
  let changed = false;
  try {
    await writeFresh(context, () => {
      if (context.document.changeTrackingMode === 'TrackMineOnly') return false;
      context.document.changeTrackingMode = 'TrackMineOnly';
      changed = true;
      return true;
    });
  } catch (error) {
    if (isStale(error)) throw writeFailure(error);
    throw new RewriteError(
      'tracking-unavailable',
      'This runtime cannot record tracked changes. In a page, give the editor the review module.',
      { cause: error }
    );
  }
  return changed;
}

/** Turn tracking off again, after {@link startTracking} turned it on. */
export async function stopTracking(context: RequestContext): Promise<void> {
  await writeFresh(context, () => {
    context.document.changeTrackingMode = 'Off';
    return true;
  });
}

/** Queue one hunk as one tracked edit. */
function queueHunk(paragraph: Paragraph, units: readonly Unit[], hunk: Hunk): void {
  if (hunk.to > hunk.from) {
    const first = units[hunk.from]!.range;
    const last = units[hunk.to - 1]!.range;
    const target = first === last ? first : first.expandTo(last);
    if (hunk.text === '') target.delete();
    else target.insertText(hunk.text, 'Replace');
    return;
  }
  if (units.length === 0) {
    paragraph.insertText(hunk.text, 'Start');
    return;
  }
  // Insert beside text rather than beside an atom, so the new text never lands inside a field
  // result or a content control.
  const next = units[hunk.from];
  const previous = units[hunk.from - 1];
  if (next && (next.atom === null || !previous || previous.atom !== null)) {
    next.range.insertText(hunk.text, 'Before');
  } else {
    previous!.range.insertText(hunk.text, 'After');
  }
}

/**
 * A revision's signature: its type, author, date, and text. Every field is part of the file, so
 * a signature survives another participant's edits, which can renumber the change itself.
 */
function signatureOf(revision: Revision, text: string): string {
  return [revision.type, revision.author, revision.date?.toISOString() ?? '', text].join('\u0000');
}

/** The paragraph's revisions, each with its signature. Two syncs. */
async function revisionsOf(
  context: RequestContext,
  paragraph: Paragraph
): Promise<{ revision: Revision; signature: string; author: string }[]> {
  const revisions = paragraph.getRange('Whole').revisions;
  revisions.load('items/author,items/type,items/date');
  await helperSync(context);
  const ranges = revisions.items.map((revision) => {
    const range = revision.range;
    range.load('text');
    return range;
  });
  if (ranges.length > 0) await helperSync(context);
  return revisions.items.map((revision, index) => ({
    revision,
    signature: signatureOf(revision, ranges[index]!.text),
    author: revision.author,
  }));
}

/** Signatures as counts, so two equal changes stay two. */
function counted(signatures: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  return counts;
}

/**
 * Write the hunks from the last to the first, so the ranges before each edit stay valid. Each
 * write is framed by reads of the paragraph's revisions; the ones that are new after the write
 * and carry the runtime's author are the write's own, and their signatures go into `own`.
 * Throws what the write threw.
 */
export async function writeHunks(
  context: RequestContext,
  paragraph: Paragraph,
  units: readonly Unit[],
  hunks: readonly Hunk[],
  author: string,
  own: Map<string, number>,
  progress: { wrote: boolean }
): Promise<void> {
  let known = counted((await revisionsOf(context, paragraph)).map((item) => item.signature));
  const collect = async () => {
    const after = await revisionsOf(context, paragraph);
    const left = new Map(known);
    for (const { signature, author: by } of after) {
      const count = left.get(signature) ?? 0;
      if (count > 0) left.set(signature, count - 1);
      else if (by === author) own.set(signature, (own.get(signature) ?? 0) + 1);
    }
    known = counted(after.map((item) => item.signature));
  };
  for (const hunk of [...hunks].reverse()) {
    queueHunk(paragraph, units, hunk);
    progress.wrote = true;
    try {
      await helperSync(context);
    } catch (error) {
      // A refused sync wrote nothing. Any other failure may have written, so read what is new.
      if (refusalOf(error) === null) await collect().catch(() => undefined);
      throw error;
    }
    await collect();
  }
}

/** The paragraph again, by its identity: the same proxy, or the body paragraph with that id. */
async function reacquire(
  context: RequestContext,
  paragraph: Paragraph,
  paragraphId: string
): Promise<Paragraph | null> {
  try {
    paragraph.load('uniqueLocalId');
    await helperSync(context);
    if (paragraph.uniqueLocalId === paragraphId) return paragraph;
  } catch {
    // The proxy no longer addresses the paragraph. Look for it by its identity.
  }
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items/uniqueLocalId');
  await helperSync(context);
  return paragraphs.items.find((item) => item.uniqueLocalId === paragraphId) ?? null;
}

/**
 * Reject the revisions whose signatures are in `own`, and only those, then check the result.
 * Each attempt reads the paragraph again first, so it rejects on the current revision.
 *
 * Throws when the paragraph or a recorded change is not found, or when the helper wrote and the
 * paragraph still does not read as `original` although no other edit moved its original text.
 * Each means the paragraph can still hold part of the rewrite.
 */
export async function rollback(
  context: RequestContext,
  paragraph: Paragraph,
  paragraphId: string,
  own: ReadonlyMap<string, number>,
  original: string,
  wrote: boolean
): Promise<void> {
  const expected = [...own.values()].reduce((sum, count) => sum + count, 0);
  let target: Paragraph | null = paragraph;
  let found = 0;
  for (let attempt = 1; expected > 0; attempt += 1) {
    target = await reacquire(context, paragraph, paragraphId);
    // Another participant can join the paragraph into another one, and the changes move with it.
    // The rollback cannot tell that from a deletion, so it must not report success.
    if (!target) {
      throw new Error(
        `The rollback could not find the paragraph to reject its ${expected} recorded ` +
          `${expected === 1 ? 'change' : 'changes'}. Another edit joined it into another ` +
          'paragraph or removed it.'
      );
    }
    const left = new Map(own);
    const mine = (await revisionsOf(context, target)).filter(({ signature }) => {
      const count = left.get(signature) ?? 0;
      if (count === 0) return false;
      left.set(signature, count - 1);
      return true;
    });
    found = mine.length;
    for (const { revision } of mine) revision.reject();
    try {
      await helperSync(context);
      break;
    } catch (error) {
      // Another participant edited again between the read and the reject. Read again.
      if (attempt === MAX_STALE_ATTEMPTS || !isStale(error)) throw error;
    }
  }
  if (!wrote || !target) return;
  const current = target.getReviewedText('Current');
  const before = target.getReviewedText('Original');
  await helperSync(context);
  if (found < expected) {
    throw new Error(
      `The rollback found ${found} of the ${expected} changes the rewrite made. The paragraph ` +
        `reads ${JSON.stringify(current.value)}.`
    );
  }
  if (before.value === original && current.value !== original) {
    // Only a tracked change can make the two views differ. If it is not another participant's,
    // it is one the rollback did not find.
    const left = (await revisionsOf(context, target)).length;
    if (left === 0 || expected === 0) {
      throw new Error(
        `The paragraph reads ${JSON.stringify(current.value)} after the rollback, not ` +
          `${JSON.stringify(original)}.`
      );
    }
  }
}

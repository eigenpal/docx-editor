/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The writes of the rewrite helper: one hunk per sync, the tracking mode around them, and the
// rollback that rejects only the helper's own changes. Every call is an Office.js-shaped public
// call; refusals are read by shape, because this entry is its own bundle.

import type { Paragraph, Range, RequestContext } from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';
import type { Hunk } from './rewrite-plan.ts';

/** How many times a write tries again after another participant's edit. */
const MAX_STALE_ATTEMPTS = 3;

/** A run of word ranges that the helper edits as one unit. */
export interface UnitRanges {
  readonly first: Range;
  readonly last: Range;
}

/** The error code and rule of a refused sync, or null for any other error. */
function refusalOf(error: unknown): { code: string; rule: string | undefined } | null {
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
    : String(error);
  return new RewriteError('write-failed', `The document refused an edit: ${reason}.`, {
    cause: error,
  });
}

/**
 * Queue a write and sync, after a read that brings the context up to date. A read-only sync
 * never fails on another participant's edit, so only an edit between the read and the write
 * makes this try again.
 */
async function writeFresh(context: RequestContext, queue: () => boolean): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    context.document.load('changeTrackingMode');
    await context.sync();
    if (!queue()) return;
    try {
      await context.sync();
      return;
    } catch (error) {
      if (attempt === MAX_STALE_ATTEMPTS || !isStale(error)) throw error;
    }
  }
}

/** Turn on `TrackMineOnly` for the writes. Answers whether the helper changed the mode. */
export async function startTracking(context: RequestContext, mode: string): Promise<boolean> {
  if (mode === 'TrackMineOnly') return false;
  try {
    await writeFresh(context, () => {
      context.document.changeTrackingMode = 'TrackMineOnly';
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
  return true;
}

/** Put the tracking mode back as the caller had it. */
export async function stopTracking(context: RequestContext, mode: string): Promise<void> {
  await writeFresh(context, () => {
    context.document.changeTrackingMode = mode === 'TrackMineOnly' ? 'TrackMineOnly' : 'Off';
    return true;
  });
}

/** Queue one hunk as one tracked edit. */
export function queueHunk(paragraph: Paragraph, units: readonly UnitRanges[], hunk: Hunk): void {
  if (hunk.to > hunk.from) {
    const first = units[hunk.from]!.first;
    const last = units[hunk.to - 1]!.last;
    const target = first === last ? first : first.expandTo(last);
    if (hunk.text === '') target.delete();
    else target.insertText(hunk.text, 'Replace');
  } else if (units.length === 0) {
    paragraph.insertText(hunk.text, 'Start');
  } else if (hunk.from === 0) {
    units[0]!.first.insertText(hunk.text, 'Before');
  } else {
    units[hunk.from - 1]!.last.insertText(hunk.text, 'After');
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
    await context.sync();
    if (paragraph.uniqueLocalId === paragraphId) return paragraph;
  } catch {
    // The proxy no longer addresses the paragraph. Look for it by its identity.
  }
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items/uniqueLocalId');
  await context.sync();
  return paragraphs.items.find((item) => item.uniqueLocalId === paragraphId) ?? null;
}

/**
 * Reject the tracked changes that this author made in the paragraph. The paragraph had none when
 * the draft was prepared, so they are the ones the draft wrote; other participants' changes stay.
 * Each attempt reads the paragraph again first, so it rejects on the current revision.
 */
export async function rollback(
  context: RequestContext,
  paragraph: Paragraph,
  paragraphId: string,
  author: string
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const target = await reacquire(context, paragraph, paragraphId);
    if (!target) return;
    const revisions = target.getRange('Whole').revisions;
    revisions.load('items/author');
    await context.sync();
    const own = revisions.items.filter((revision) => revision.author === author);
    if (own.length === 0) return;
    for (const revision of own) revision.reject();
    try {
      await context.sync();
      return;
    } catch (error) {
      // Another participant edited again between the read and the reject. Read again.
      if (attempt === MAX_STALE_ATTEMPTS || !isStale(error)) throw error;
    }
  }
}

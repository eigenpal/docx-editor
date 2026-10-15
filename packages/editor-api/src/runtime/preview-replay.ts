/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Replaying a preview's recorded batches against the live host.
//
// A batch is transport data that names objects by host-scoped handle refs and stamps endpoints
// with the revision they were read at. Neither means anything to another host, so each recorded
// request is rewritten with the live host's refs and revisions, learned from the live answers to
// the batches before it. A ref or a revision with no live counterpart is a divergence, never
// passed through.
//
// The live answers must say what the fork's said: the same shape, and the same values. Only the
// values one host mints on its own (handle refs, revision stamps, dates, paragraph identities)
// may differ. That is what keeps a replay from ever being blind: a search that finds other text,
// or a range whose offsets moved, refuses the commit instead of editing something else.

import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationOperation,
} from '@docx-editor.dev/core/automation';
import { hostFailure } from './batch.ts';
import { DocxEditorError } from './errors.ts';

/** One batch the preview callback sent, with the fork's answer. @internal */
export interface PreviewEntry {
  readonly request: AutomationBatchRequest;
  readonly response: AutomationBatchResponse;
  /** The fork's revision when the batch was sent. */
  readonly before: number;
}

/** Reads whose answer each host mints for itself, so their values are not compared. */
const HOST_MINTED_READS: ReadonlySet<string> = new Set([
  'getRevisionDate',
  'getCommentDate',
  'getParagraphId',
]);

/** Thrown inside the replay when a live answer disagrees with the fork's. */
class Divergence extends Error {}

/** What a replay needs: one executor and the revision the live host is at now. */
export interface ReplayTarget {
  execute(request: AutomationBatchRequest): AutomationBatchResponse | null;
  revision(): number;
}

/**
 * Replay `log` against `target`, which starts at `liveBase`, the counterpart of `forkBase`.
 *
 * A failure carries the live host's own refusal when it refused a batch, or `null` when an
 * answer disagreed, and `wrote`: whether earlier replayed batches changed the live document,
 * which the caller must then take back.
 */
export function replayPreview(
  log: readonly PreviewEntry[],
  target: ReplayTarget,
  forkBase: number,
  liveBase: number
):
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: DocxEditorError | null; readonly wrote: boolean } {
  const refs = new Map<string, string>();
  const revisions = new Map<number, number>([[forkBase, liveBase]]);
  let wrote = false;
  try {
    for (const entry of log) {
      // A refused batch wrote nothing and minted nothing in the fork: there is nothing to replay.
      if (!entry.response.ok) continue;
      const live = target.revision();
      const known = revisions.get(entry.before);
      if (known !== undefined && known !== live) throw new Divergence();
      revisions.set(entry.before, live);
      const answer = target.execute(
        translate(entry.request, refs, revisions) as AutomationBatchRequest
      );
      if (answer === null) throw new Divergence();
      if (!answer.ok) {
        const failed = answer.results.find((result) => result.status === 'error');
        throw failed?.status === 'error'
          ? hostFailure(failed.error, { target: 'preview' })
          : new DocxEditorError({ code: 'GeneralException', target: 'preview' });
      }
      if (answer.changed) wrote = true;
      if (answer.results.length !== entry.response.results.length) throw new Divergence();
      entry.request.operations.forEach((operation: AutomationOperation, index) =>
        agree(
          entry.response.results[index],
          answer.results[index],
          refs,
          HOST_MINTED_READS.has(operation.op)
        )
      );
      revisions.set(entry.response.revision, answer.revision);
    }
  } catch (error) {
    if (error instanceof DocxEditorError) return { ok: false, refusal: error, wrote };
    if (error instanceof Divergence) return { ok: false, refusal: null, wrote };
    throw error;
  }
  return { ok: true };
}

/** A recorded request with the fork's refs and revisions replaced by the live host's. */
function translate(
  value: unknown,
  refs: ReadonlyMap<string, string>,
  revisions: ReadonlyMap<number, number>
): unknown {
  if (Array.isArray(value)) return value.map((item) => translate(item, refs, revisions));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'ref' && typeof item === 'string') {
      const live = refs.get(item);
      if (live === undefined) throw new Divergence();
      out[key] = live;
    } else if ((key === 'readAt' || key === 'expectedRevision') && typeof item === 'number') {
      const live = revisions.get(item);
      if (live === undefined) throw new Divergence();
      out[key] = live;
    } else out[key] = translate(item, refs, revisions);
  }
  return out;
}

/**
 * Require the live answer to match the fork's, pairing handle refs as it goes. Revision stamps
 * never compare; with `minted`, no primitive value compares, only the shape.
 */
function agree(fork: unknown, live: unknown, refs: Map<string, string>, minted: boolean): void {
  if (Array.isArray(fork)) {
    if (!Array.isArray(live) || live.length !== fork.length) throw new Divergence();
    fork.forEach((item, index) => agree(item, live[index], refs, minted));
    return;
  }
  if (fork === null || typeof fork !== 'object') {
    if (!minted && fork !== live) throw new Divergence();
    return;
  }
  if (live === null || typeof live !== 'object' || Array.isArray(live)) throw new Divergence();
  const other = live as Record<string, unknown>;
  for (const [key, item] of Object.entries(fork)) {
    if (key === 'ref' && typeof item === 'string') {
      const paired = other[key];
      if (typeof paired !== 'string') throw new Divergence();
      refs.set(item, paired);
    } else if (key === 'readAt') continue;
    else agree(item, other[key], refs, minted);
  }
}

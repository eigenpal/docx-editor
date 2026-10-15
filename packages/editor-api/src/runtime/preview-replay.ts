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
// may differ, and endpoint offsets, which pair instead: an edit earlier in a paragraph shifts
// where the same words sit. That is what keeps a replay from ever being blind: a search that
// finds a different number of matches, text that reads differently, or a paragraph that would
// pair two ways refuses the commit instead of editing something else. Before each write batch,
// the text of every span and paragraph it overwrites is read on both hosts and must match, so a
// rebase never strikes or reformats words a peer added there after the preview was taken.

import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationHandle,
  AutomationOperation,
} from '@docx-editor.dev/core/automation';
import { isAutomationCommand } from '@docx-editor.dev/core/automation';
import { hostFailure } from './batch.ts';
import { DocxEditorError } from './errors.ts';

/** One batch the preview callback sent, with the fork's answer. @internal */
export interface PreviewEntry {
  readonly request: AutomationBatchRequest;
  readonly response: AutomationBatchResponse;
  /** The fork's revision when the batch was sent. */
  readonly before: number;
  /**
   * What the batch's writes were about to overwrite, read from the fork just before them:
   * replayed first, and required to read the same on the live host.
   */
  readonly guards?: {
    readonly request: AutomationBatchRequest;
    readonly response: AutomationBatchResponse;
  };
}

const isHandle = (value: unknown): value is AutomationHandle =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === 'string' &&
  typeof (value as { ref?: unknown }).ref === 'string';

/**
 * Reads of the content `operations` overwrite: the text of every span a command names, and of
 * every paragraph it names whole. A replay compares them before it writes, so a rebase never
 * overwrites words the preview did not show, whatever form the command addressed them in.
 * Insertion points are not guarded: an insertion overwrites nothing.
 *
 * @internal
 */
export function contentGuards(operations: readonly AutomationOperation[]): AutomationOperation[] {
  const guards: AutomationOperation[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (isEndpoint(value)) return;
    const keys = Object.keys(record);
    const wholeSpan =
      keys.length === 1 &&
      (keys[0] === 'paragraph' || keys[0] === 'body') &&
      isHandle(record[keys[0]]);
    const endpointSpan =
      typeof record.start === 'object' &&
      record.start !== null &&
      isEndpoint(record.start) &&
      typeof record.end === 'object' &&
      record.end !== null &&
      isEndpoint(record.end);
    if (wholeSpan || endpointSpan) {
      guards.push({
        op: 'getSpanText',
        span: (endpointSpan ? { start: record.start, end: record.end } : value) as never,
        projection: 'model',
      });
      return;
    }
    if (isHandle(value) && value.kind === 'paragraph') {
      guards.push({ op: 'getText', target: value, projection: 'model' });
      return;
    }
    Object.values(record).forEach(walk);
  };
  for (const operation of operations) {
    if (isAutomationCommand(operation) && operation.op !== 'setChangeTrackingMode') walk(operation);
  }
  return guards;
}

/** Reads whose answer each host mints for itself, so their values are not compared. */
const HOST_MINTED_READS: ReadonlySet<string> = new Set([
  'getRevisionDate',
  'getCommentDate',
  'getCommentId',
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
  const pairs = new Pairs(forkBase, liveBase);
  let wrote = false;
  try {
    for (const entry of log) {
      // A refused batch wrote nothing and minted nothing in the fork: there is nothing to replay.
      if (!entry.response.ok) continue;
      pairs.revision(entry.before, target.revision());
      if (entry.guards) {
        const read = target.execute(
          pairs.translate(entry.guards.request) as AutomationBatchRequest
        );
        if (read === null || read.ok !== entry.guards.response.ok) throw new Divergence();
        if (read.results.length !== entry.guards.response.results.length) throw new Divergence();
        entry.guards.response.results.forEach((result, index) =>
          pairs.agree(result, read.results[index], false)
        );
      }
      const answer = target.execute(pairs.translate(entry.request) as AutomationBatchRequest);
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
        pairs.agree(
          entry.response.results[index],
          answer.results[index],
          HOST_MINTED_READS.has(operation.op)
        )
      );
      pairs.revision(entry.response.revision, answer.revision);
    }
  } catch (error) {
    if (error instanceof DocxEditorError) return { ok: false, refusal: error, wrote };
    if (error instanceof Divergence) return { ok: false, refusal: null, wrote };
    throw error;
  }
  return { ok: true };
}

/** An endpoint as it travels: a paragraph handle, an offset, and the revision it was read at. */
interface EndpointShape {
  readonly paragraph: { readonly ref: string };
  readonly offset: number;
  readonly readAt?: number;
}

function isEndpoint(value: object): value is EndpointShape {
  const candidate = value as Partial<EndpointShape>;
  return (
    typeof candidate.offset === 'number' &&
    typeof candidate.paragraph === 'object' &&
    candidate.paragraph !== null &&
    typeof candidate.paragraph.ref === 'string'
  );
}

const endpointKey = (endpoint: EndpointShape): string =>
  `${endpoint.paragraph.ref}\u0000${endpoint.offset}\u0000${endpoint.readAt ?? ''}`;

/**
 * What the fork's names mean on the live host, learned answer by answer.
 *
 * Handle refs pair one to one; a ref that would pair with a second counterpart is a divergence.
 * Revisions pair as each batch starts and ends. Endpoint offsets pair per read: a peer's edit
 * earlier in the same paragraph shifts every offset after it, so a later request means the live
 * answer's offset, never the fork's.
 */
class Pairs {
  readonly #refs = new Map<string, string>();
  readonly #liveRefs = new Map<string, string>();
  readonly #revisions = new Map<number, number>();
  /** Fork endpoint (ref, offset, readAt) to live offset. */
  readonly #offsets = new Map<string, number>();

  constructor(forkBase: number, liveBase: number) {
    this.#revisions.set(forkBase, liveBase);
  }

  revision(fork: number, live: number): void {
    const known = this.#revisions.get(fork);
    if (known !== undefined && known !== live) throw new Divergence();
    this.#revisions.set(fork, live);
  }

  /** A recorded request with the fork's refs, revisions, and offsets replaced by the live host's. */
  translate(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.translate(item));
    if (value === null || typeof value !== 'object') return value;
    const offset = isEndpoint(value) ? this.#liveOffset(value) : undefined;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'ref' && typeof item === 'string') {
        const live = this.#refs.get(item);
        if (live === undefined) throw new Divergence();
        out[key] = live;
      } else if ((key === 'readAt' || key === 'expectedRevision') && typeof item === 'number') {
        const live = this.#revisions.get(item);
        if (live === undefined) throw new Divergence();
        out[key] = live;
      } else if (key === 'offset' && offset !== undefined) out[key] = offset;
      else out[key] = this.translate(item);
    }
    return out;
  }

  /**
   * Require the live answer to match the fork's, pairing names as it goes. Revision stamps and
   * endpoint offsets pair rather than compare, and a `date` is each host's own clock; with
   * `minted`, no other value compares either, only the shape.
   */
  agree(fork: unknown, live: unknown, minted: boolean): void {
    if (Array.isArray(fork)) {
      if (!Array.isArray(live) || live.length !== fork.length) throw new Divergence();
      fork.forEach((item, index) => this.agree(item, live[index], minted));
      return;
    }
    if (fork === null || typeof fork !== 'object') {
      if (!minted && fork !== live) throw new Divergence();
      return;
    }
    if (live === null || typeof live !== 'object' || Array.isArray(live)) throw new Divergence();
    const other = live as Record<string, unknown>;
    const endpoint = isEndpoint(fork);
    if (endpoint) {
      if (!isEndpoint(other)) throw new Divergence();
      this.#pairOffset(fork, other.offset);
    }
    for (const [key, item] of Object.entries(fork)) {
      if (key === 'ref' && typeof item === 'string') {
        const paired = other[key];
        if (typeof paired !== 'string') throw new Divergence();
        this.#pairRef(item, paired);
      } else if (key === 'readAt' || key === 'date' || (key === 'offset' && endpoint)) continue;
      else this.agree(item, other[key], minted);
    }
  }

  #pairRef(fork: string, live: string): void {
    const known = this.#refs.get(fork);
    const back = this.#liveRefs.get(live);
    if ((known !== undefined && known !== live) || (back !== undefined && back !== fork)) {
      throw new Divergence();
    }
    this.#refs.set(fork, live);
    this.#liveRefs.set(live, fork);
  }

  #pairOffset(fork: EndpointShape, live: number): void {
    const key = endpointKey(fork);
    const known = this.#offsets.get(key);
    if (known !== undefined && known !== live) throw new Divergence();
    this.#offsets.set(key, live);
  }

  /**
   * The live offset for a request endpoint: the one its read answered. An endpoint stamped with
   * a revision that no answer paired is a divergence; one built by hand, with no stamp, keeps
   * its offset, and the content guards check what a write at it would overwrite.
   */
  #liveOffset(fork: EndpointShape): number {
    const paired = this.#offsets.get(endpointKey(fork));
    if (paired !== undefined) return paired;
    if (fork.readAt !== undefined) throw new Divergence();
    return fork.offset;
  }
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The action queue: what a proxy call leaves behind instead of doing something.
//
// A queued action is a closure pair — how to say it to the host (`plan`), and what to do with
// the answer (`settle`) — plus the label an error may name. Keeping both halves on one object
// is what makes hydration positional rather than guessed: the answer at index i belongs to the
// action at index i, and there is no lookup table to get out of step with the request.
//
// `take()` is the important method. Dispatching a batch REMOVES its actions from the queue and
// nothing ever puts them back, including when the batch fails. A queue that re-queued a failed
// batch would replay writes the consumer had already been told about, at a revision they never
// saw; a queue that kept them would send them twice. So a failed sync loses its batch, says so
// with a typed error, and whatever is queued afterwards is a new batch that can succeed on its
// own.

import type { AutomationOperation, AutomationValue } from '@docx-editor.dev/core/automation';

/** Whether an action reads or writes. Drives the conditional-revision rule in `sync()`. */
export type ActionSort = 'read' | 'write';

import type { ObjectPath } from './object-path.ts';

export interface QueuedAction {
  readonly sort: ActionSort;
  /** Paths that must resolve before this action can be planned. */
  readonly dependencies?: readonly ObjectPath[];
  /** A scalar load on an OrNullObject proxy is skipped if its lookup resolves null. */
  readonly nullableLoad?: ObjectPath;
  /** The consumer-facing name of what this action is for, for errors. Never a handle. */
  readonly label: string;
  /**
   * A runtime setting, not a document edit: an agent helper's own first sync may carry it. Set
   * only for tracking-mode assignments the runtime accepts (`Off`, `TrackMineOnly`).
   */
  readonly runtimeSetting?: true;
  /**
   * The answer queues reads for the same sync: a listing whose items load properties named
   * with `items/`. A sync that writes sends such a listing, and those reads, before its writes.
   */
  readonly continues?: boolean;
  /** Detach coalesced setters when sync captures this action, before asynchronous reads. */
  capture?(): void;
  /** Release coalesced state when a batch completes or is discarded. */
  dispose?(): void;
  /**
   * The host operation for this action.
   *
   * Called once, at dispatch. May throw `InvalidObjectPath` if the object it addresses stopped
   * being addressable between the call that queued it and the sync — which refuses the batch
   * before anything is sent.
   */
  plan(): AutomationOperation;
  /** The host's answer for this action, in batch order. */
  settle(value: AutomationValue): void;
}

export class ActionQueue {
  #actions: QueuedAction[] = [];
  /** Where `push` puts an action while `collect` or `continuing` runs. */
  #sink: QueuedAction[] | null = null;
  /** Reads queued while a sync settled an answer, sent by that same sync. */
  #continuations: QueuedAction[] = [];

  get size(): number {
    return this.#actions.length;
  }

  /** What is queued right now, for tests and for the empty-batch shortcut. */
  get pending(): readonly QueuedAction[] {
    return this.#actions;
  }

  push(action: QueuedAction): void {
    (this.#sink ?? this.#actions).push(action);
  }

  /**
   * Run `work` and return what it queued instead of queueing it.
   *
   * Synchronous on purpose: nothing a consumer writes can run while `work` does, so no call of
   * theirs can land in the returned list.
   */
  collect(work: () => void): QueuedAction[] {
    const previous = this.#sink;
    const sink: QueuedAction[] = [];
    this.#sink = sink;
    try {
      work();
    } finally {
      this.#sink = previous;
    }
    return sink;
  }

  /**
   * Run `work` while a sync settles an answer, and keep what it queued for that same sync.
   *
   * This is how `load('items/text')` reads each item: the items are known only once the listing
   * has answered, and the sync that sent the listing sends their reads before it resolves.
   */
  continuing(work: () => void): void {
    this.#continuations.push(...this.collect(work));
  }

  /** Hand over the reads `continuing` kept, and forget them. */
  takeContinuations(): readonly QueuedAction[] {
    const taken = this.#continuations;
    this.#continuations = [];
    for (const action of taken) action.capture?.();
    return taken;
  }

  /** Hand over everything queued and forget it. Never replayed — see the file header. */
  take(): readonly QueuedAction[] {
    const taken = this.#actions;
    this.#actions = [];
    for (const action of taken) action.capture?.();
    return taken;
  }

  /** Drop everything queued: what a finished run does with actions nobody synced. */
  clear(): void {
    for (const action of this.#actions) action.dispose?.();
    for (const action of this.#continuations) action.dispose?.();
    this.#actions = [];
    this.#continuations = [];
  }
}

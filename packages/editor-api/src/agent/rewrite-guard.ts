/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What keeps the helper's batches its own.
//
// - ONE AT A TIME. A helper call holds its context until it ends; a second call on the same
//   context refuses with `busy`. Waiting instead would deadlock a rewrite function that calls the
//   helper itself, and the batch helper already runs many paragraphs in one call.
// - ONLY ITS OWN SYNCS. While a helper call holds the context, `context.sync()` from other code
//   refuses: with `context-used` during a model call, and with `busy` otherwise. The helper syncs
//   through `helperSync`, which the guard lets through.
// - NO FOREIGN COMMANDS. The helper reads the context's queue through a non-enumerable hook. At
//   each entry it refuses when edits are queued, because its first sync would send them; after
//   each model call it discards what the call queued and refuses, because the call runs outside
//   the batch.

import type { RequestContext } from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';

const QUEUE_HOOK = Symbol.for('@docx-editor.dev/editor-api/queue');

interface QueueHook {
  /** How many queued commands write. Queued reads cannot change the document. */
  writes(): number;
  discard(): void;
}

function queueOf(context: RequestContext): QueueHook | null {
  const hook = (context as unknown as Record<symbol, unknown>)[QUEUE_HOOK];
  return typeof hook === 'object' && hook !== null ? (hook as QueueHook) : null;
}

/** Per context: whether the helper is calling sync now, model calls running, discards seen. */
interface Hold {
  entering: boolean;
  calls: number;
  discards: number;
}

const holds = new WeakMap<RequestContext, Hold>();

const syncDuringCall = () =>
  new RewriteError(
    'context-used',
    'The rewrite function called context.sync(). It runs outside the batch, so it must not use ' +
      'the request context or its proxies. Read what the model needs from the draft, and make ' +
      'other edits before or after the rewrite.'
  );

const syncDuringHelper = () =>
  new RewriteError(
    'busy',
    'A helper call is in progress on this request context. Await it before you call ' +
      'context.sync().'
  );

/** Run `work` as the only helper call on `context`. */
export async function exclusive<T>(context: RequestContext, work: () => Promise<T>): Promise<T> {
  if (holds.has(context)) {
    throw new RewriteError(
      'busy',
      'Another rewrite runs on this request context. Await it before you start the next one, ' +
        'and use proposeRewrites to rewrite several paragraphs.'
    );
  }
  assertNothingQueued(context);
  const hold: Hold = { entering: false, calls: 0, discards: 0 };
  holds.set(context, hold);
  const original = (Object.getPrototypeOf(context) as { sync: () => Promise<void> }).sync;
  Object.defineProperty(context, 'sync', {
    configurable: true,
    // A function, not an arrow: `this` is the context itself even when a proxy forwards to it.
    value: function guardedSync(this: RequestContext): Promise<void> {
      if (hold.entering) return original.call(this);
      return Promise.reject(hold.calls > 0 ? syncDuringCall() : syncDuringHelper());
    },
  });
  try {
    return await work();
  } finally {
    delete (context as unknown as { sync?: unknown }).sync;
    holds.delete(context);
  }
}

/**
 * Sync as the helper, through the guard that `exclusive` installs. The guard lets a sync through
 * only while this call starts it, so any other caller is refused, even while this sync runs.
 */
export async function helperSync(context: RequestContext): Promise<void> {
  const hold = holds.get(context);
  let pending: Promise<void>;
  if (hold) hold.entering = true;
  try {
    pending = context.sync();
  } finally {
    if (hold) hold.entering = false;
  }
  await pending;
}

/** Refuse when edits are queued that the helper's next sync would send. */
export function assertNothingQueued(context: RequestContext): void {
  const size = queueOf(context)?.writes() ?? 0;
  if (size === 0) return;
  throw new RewriteError(
    'context-used',
    `${size} edit${size === 1 ? ' is' : 's are'} queued on the request context. Sync them ` +
      'before you call the helper, so that its tracked writes never send them.'
  );
}

/**
 * Run a model call. While it runs, `context.sync()` refuses. After it, anything queued on the
 * context is discarded, and the call fails with `context-used`. Model calls that run at once
 * share one queue, so every call that overlapped a discard fails too. When `abandon` rejects,
 * the call is given up at once with that error.
 */
export async function asModelCall<T>(
  context: RequestContext,
  run: () => Promise<T>,
  abandon: Promise<never>
): Promise<T> {
  const hold = holds.get(context) ?? { entering: false, calls: 0, discards: 0 };
  const seen = hold.discards;
  hold.calls += 1;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    // An aborted call is abandoned at once, so the guard comes off even if it never settles.
    const call = run();
    call.catch(() => undefined);
    outcome = { ok: true, value: await Promise.race([call, abandon]) };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    hold.calls -= 1;
  }
  const queue = queueOf(context);
  const queued = queue?.writes() ?? 0;
  if (queued > 0) {
    queue!.discard();
    hold.discards += 1;
  }
  if (queued > 0 || hold.discards !== seen) {
    throw new RewriteError(
      'context-used',
      'The rewrite function queued commands on the request context, such as an insertText ' +
        'call. It runs outside the batch, so the helper discarded them. Make other edits ' +
        'before or after the rewrite.'
    );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

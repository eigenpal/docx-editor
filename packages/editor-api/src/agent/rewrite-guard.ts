/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What keeps the helper's batches its own.
//
// - ONE AT A TIME. A helper call (`prepareRewrite` or `draft.apply`) holds its context until it
//   ends; a second call on the same context refuses with `busy`, rather than interleave its
//   syncs with the first call's writes.
// - ONLY ITS OWN SYNCS. While a helper call holds the context, `context.sync()` from other code
//   refuses with `busy`. The helper syncs through `helperSync`, which the guard lets through.
// - NO FOREIGN COMMANDS. The helper reads the context's queue through a non-enumerable hook. At
//   each entry it refuses when edits are queued, because its first sync would send them.

import type { RequestContext } from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';

const QUEUE_HOOK = Symbol.for('@docx-editor.dev/editor-api/queue');

interface QueueHook {
  /**
   * How many queued commands edit the document. Queued reads cannot change it, and a queued
   * `changeTrackingMode` assignment is a runtime setting, so neither counts.
   */
  writes(): number;
}

function queueOf(context: RequestContext): QueueHook | null {
  const hook = (context as unknown as Record<symbol, unknown>)[QUEUE_HOOK];
  return typeof hook === 'object' && hook !== null ? (hook as QueueHook) : null;
}

/** Per context: whether the helper is calling sync now. */
interface Hold {
  entering: boolean;
}

const holds = new WeakMap<RequestContext, Hold>();

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
      'Another rewrite helper call runs on this request context. Await it before you start ' +
        'the next one: apply drafts one after another.'
    );
  }
  assertNothingQueued(context);
  const hold: Hold = { entering: false };
  holds.set(context, hold);
  // A host can wrap `sync` with an own property, such as a tracing wrapper. The helper's syncs
  // go through that wrapper, and the property comes back exactly as it was.
  const previous = Object.getOwnPropertyDescriptor(context, 'sync');
  const underlying = (
    previous
      ? (previous.value ?? previous.get?.call(context))
      : (Object.getPrototypeOf(context) as { sync: unknown }).sync
  ) as (this: RequestContext) => Promise<void>;
  const guard = !previous || previous.configurable === true;
  if (guard) {
    Object.defineProperty(context, 'sync', {
      configurable: true,
      // A function, not an arrow: `this` is the context itself even when a proxy forwards to it.
      value: function guardedSync(this: RequestContext): Promise<void> {
        if (hold.entering) return underlying.call(this);
        return Promise.reject(syncDuringHelper());
      },
    });
  }
  try {
    return await work();
  } finally {
    if (guard) {
      if (previous) Object.defineProperty(context, 'sync', previous);
      else delete (context as unknown as { sync?: unknown }).sync;
    }
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
    size === 1
      ? '1 edit is queued on the request context. Sync it before you call the helper, so ' +
          'that its tracked writes never send it.'
      : `${size} edits are queued on the request context. Sync them before you call the ` +
          'helper, so that its tracked writes never send them.'
  );
}

// Deferred primitive-journal publication.
//
// Freeze, observer notify, Yjs translation, encode, and send must not run inside the
// keystroke transaction. The queue is FIFO per store and never coalesces two journals.
// `setTimeout(0)` matches the surface input-pressure seam: queued keys outrank the timer.
// Discrete `isInputPending` reschedules, so a held key does not pay replication.

import {
  freezeCanonicalPrimitiveJournal,
  type CanonicalPrimitiveEffect,
  type CanonicalPrimitiveJournal,
} from './canonical-primitive-journal.ts';

interface PendingJournal {
  readonly store: object;
  readonly effects: CanonicalPrimitiveEffect[];
}

type JournalListener = (journal: CanonicalPrimitiveJournal) => void;

/**
 * The timer is reached through `globalThis`, not the DOM or Node types.
 *
 * `store` is a DOM-free lane, and the headless runtime compiles it without the DOM lib, so a
 * bare `setTimeout` does not type there. A host with no timer falls back to a microtask, which
 * still leaves the keystroke transaction — the property this queue exists for.
 */
interface TimerHost {
  readonly setTimeout?: (handler: () => void, timeout: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

const pending: PendingJournal[] = [];
let flushHandle: unknown = null;
let flushScheduled = false;
const flushingStores = new Set<object>();
let listenersOf: (store: object) => ReadonlySet<JournalListener> | undefined = () => undefined;

export function bindCanonicalPrimitiveJournalListeners(
  lookup: (store: object) => ReadonlySet<JournalListener> | undefined
): void {
  listenersOf = lookup;
}

function hasPendingDiscreteInput(): boolean {
  const navigatorLike = (
    globalThis as {
      navigator?: {
        scheduling?: {
          isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
        };
      };
    }
  ).navigator;
  return navigatorLike?.scheduling?.isInputPending?.({ includeContinuous: false }) ?? false;
}

function notifyStore(store: object, journal: CanonicalPrimitiveJournal): void {
  const listeners = listenersOf(store);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) listener(journal);
}

function takePending(store?: object): PendingJournal[] {
  if (store === undefined) return pending.splice(0);
  const taken: PendingJournal[] = [];
  let index = 0;
  while (index < pending.length) {
    const item = pending[index]!;
    if (item.store === store) {
      taken.push(item);
      pending.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return taken;
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const host = globalThis as TimerHost;
  if (host.setTimeout) {
    flushHandle = host.setTimeout(onFlushDue, 0);
    return;
  }
  void Promise.resolve().then(onFlushDue);
}

function onFlushDue(): void {
  flushScheduled = false;
  flushHandle = null;
  // A queued key outranks the timer, so a held key does not pay replication per keystroke.
  if (hasPendingDiscreteInput()) {
    scheduleFlush();
    return;
  }
  flushPendingCanonicalJournals();
}

function cancelScheduledFlush(): void {
  if (!flushScheduled) return;
  const host = globalThis as TimerHost;
  if (flushHandle !== null) host.clearTimeout?.(flushHandle);
  flushHandle = null;
  flushScheduled = false;
}

/** True when this store has journals that have not been frozen or notified yet. */
export function storeHasPendingCanonicalJournals(store: object): boolean {
  return pending.some((item) => item.store === store);
}

/** How many journals wait in the FIFO. Tests use this to watch for unbounded growth. */
export function pendingCanonicalJournalCount(store?: object): number {
  if (store === undefined) return pending.length;
  let count = 0;
  for (const item of pending) if (item.store === store) count += 1;
  return count;
}

/**
 * Freeze and notify queued journals in the order they were produced.
 *
 * Pass a store to flush only that document. Tests and teardown call this instead of
 * waiting for the timer.
 */
export function flushPendingCanonicalJournals(store?: object): void {
  cancelScheduledFlush();
  if (pending.length === 0) return;
  if (store !== undefined) flushStore(store);
  else for (const queued of distinctPendingStores()) flushStore(queued);
  if (pending.length > 0) scheduleFlush();
}

function distinctPendingStores(): object[] {
  const stores: object[] = [];
  for (const item of pending) if (!stores.includes(item.store)) stores.push(item.store);
  return stores;
}

/**
 * Re-entrancy is per store, not global.
 *
 * A listener that edits the store it is flushing would recurse, so that is refused. A second
 * document flushing inside the first one's listener is not recursion: two replicas in one
 * process relay through each other, and a global guard dropped the second one's queue on the
 * floor. A server host holding two documents lost the same way.
 */
function flushStore(store: object): void {
  if (flushingStores.has(store)) return;
  flushingStores.add(store);
  try {
    for (const item of takePending(store)) {
      notifyStore(store, freezeCanonicalPrimitiveJournal(item.effects));
    }
  } finally {
    flushingStores.delete(store);
  }
}

/** Queue one committed journal. No-op cost is the caller never reaching here. */
export function enqueuePendingCanonicalJournal(
  store: object,
  effects: CanonicalPrimitiveEffect[]
): void {
  pending.push({ store, effects });
  scheduleFlush();
}

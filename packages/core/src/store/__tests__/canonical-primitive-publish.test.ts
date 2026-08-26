// Deferred journal publication (input-pressure scheduling).

import { afterEach, describe, expect, test } from 'bun:test';
import {
  flushPendingCanonicalJournals,
  observeCanonicalPrimitiveJournal,
  storeHasPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import {
  packageTransactionPublished,
  recordMoveNode,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';

afterEach(() => {
  flushPendingCanonicalJournals();
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stubInputPending(): () => void {
  const current = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { scheduling: { isInputPending: () => true } },
  });
  return () => {
    if (current === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
      return;
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: current });
  };
}

describe('canonical primitive journal publication', () => {
  test('discrete input pending keeps freeze and notify off the current turn', async () => {
    const host = {};
    const journals: unknown[] = [];
    observeCanonicalPrimitiveJournal(host, (journal) => journals.push(journal));
    const restore = stubInputPending();
    try {
      runObservedStoreTransaction(
        host,
        () => {
          recordMoveNode('n1', 'parent', 0);
          return { ok: true, change: true };
        },
        packageTransactionPublished
      );
      expect(storeHasPendingCanonicalJournals(host)).toBe(true);
      await tick();
      await tick();
      expect(journals).toHaveLength(0);
      flushPendingCanonicalJournals(host);
      expect(journals).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test('without observers a committed transaction schedules nothing', () => {
    const host = {};
    runObservedStoreTransaction(
      host,
      () => {
        recordMoveNode('n1', 'parent', 0);
        return { ok: true, change: true };
      },
      packageTransactionPublished
    );
    expect(storeHasPendingCanonicalJournals(host)).toBe(false);
  });
});

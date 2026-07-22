/** @spike-features insert-delete-split-join-operations, origin-metadata */
import { describe, expect, test } from 'bun:test';
import {
  createAwarenessOrigin,
  createMutationOrigin,
  createProjectionOrigin,
  createSynchronousTransactionContext,
  createSynchronousTransactionExecutor,
  originDomainsMatchBindingOracleV2,
  type MutationOrigin,
  type SynchronousTransactionContext,
  type SynchronousTransactionExecutor,
  type SynchronousTransactionResult,
  type TransactionMutationCapability,
  type TransactionRejectionReason,
} from '../src/contracts';

type Stage = { text: string };
type Published = { revision: number; text: string };

type EffectKind =
  | 'canonical'
  | 'yjs'
  | 'revision'
  | 'update'
  | 'notification'
  | 'history'
  | 'repair'
  | 'audit';

interface EffectLedger {
  readonly counts: Record<EffectKind, number>;
  record(kind: EffectKind): void;
  snapshot(): Record<EffectKind, number>;
}

function createEffectLedger(): EffectLedger {
  const counts: Record<EffectKind, number> = {
    canonical: 0,
    yjs: 0,
    revision: 0,
    update: 0,
    notification: 0,
    history: 0,
    repair: 0,
    audit: 0,
  };
  return {
    counts,
    record(kind) {
      counts[kind] += 1;
    },
    snapshot() {
      return { ...counts };
    },
  };
}

function thenable<T>(value: T): { then: (onFulfilled: (value: T) => void) => void } {
  return {
    then(onFulfilled) {
      onFulfilled(value);
    },
  };
}

function humanContext(
  overrides: Partial<{ actorId: string; sessionId: string; groupId: string; transactionId: string }> = {}
): SynchronousTransactionContext {
  const actorId = overrides.actorId ?? 'actor-alice';
  const sessionId = overrides.sessionId ?? 'session-alice-1';
  return createSynchronousTransactionContext({
    actorId,
    sessionId,
    groupId: overrides.groupId ?? 'group-alice-1',
    transactionId: overrides.transactionId ?? 'txn-alice-1',
    origin: createMutationOrigin('human', { actorId, sessionId }),
  });
}

function createHarness(ledger: EffectLedger): {
  executor: SynchronousTransactionExecutor<Stage, Published>;
  rollbackCalls: Stage[];
} {
  const rollbackCalls: Stage[] = [];
  const executor = createSynchronousTransactionExecutor<Stage, Published>({
    preflight(stage) {
      if (stage.text.includes('PREFLIGHT_FAIL')) {
        throw new Error('preflight rejected');
      }
      if (stage.text.includes('PREFLIGHT_ASYNC')) {
        return thenable(undefined) as unknown as void;
      }
    },
    publish(stage) {
      if (stage.text.includes('PUBLISH_THROW')) {
        throw new Error('publish failed');
      }
      if (stage.text.includes('PUBLISH_ASYNC')) {
        return thenable({ revision: 1, text: stage.text }) as unknown as Published;
      }
      ledger.record('canonical');
      ledger.record('yjs');
      ledger.record('revision');
      ledger.record('update');
      ledger.record('notification');
      return { revision: 1, text: stage.text };
    },
    rollback(stage) {
      rollbackCalls.push({ ...stage });
      if (stage.text.includes('ROLLBACK_THROW')) {
        throw new Error('rollback failed');
      }
    },
  });
  return { executor, rollbackCalls };
}

function assertRejectedWithZeroEffects(
  result: SynchronousTransactionResult<Published>,
  ledger: EffectLedger,
  baseline: Record<EffectKind, number>,
  reason?: TransactionRejectionReason
): void {
  expect(result.ok).toBe(false);
  if (reason !== undefined) {
    expect(result.ok === false && result.reason).toBe(reason);
  }
  expect(ledger.snapshot()).toEqual(baseline);
}

describe('task 2.6 synchronous transaction executor', () => {
  test('origin domains align with binding-oracle.v2.json', () => {
    expect(originDomainsMatchBindingOracleV2()).toBe(true);
  });

  test('commits once on success with frozen capability origin', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);
    const context = humanContext();
    let observedOrigin: MutationOrigin | undefined;

    const result = executor.transact(context, { text: 'hello' }, (capability, stage) => {
      observedOrigin = capability.origin;
      expect(Object.isFrozen(capability)).toBe(true);
      expect(Object.isFrozen(capability.origin)).toBe(true);
      capability.assertMutationOrigin(capability.origin);
      stage.value.text = 'hello world';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.published).toEqual({ revision: 1, text: 'hello world' });
    }
    expect(observedOrigin).toEqual(context.origin);
    expect(rollbackCalls).toEqual([]);
    expect(ledger.snapshot()).toEqual({
      ...baseline,
      canonical: 1,
      yjs: 1,
      revision: 1,
      update: 1,
      notification: 1,
    });
  });

  test('rejects failed preflight without staging, publishing, or rollback', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'PREFLIGHT_FAIL' }, () => {});

    assertRejectedWithZeroEffects(result, ledger, baseline, 'preflight-failure');
    expect(rollbackCalls).toEqual([]);
  });

  test('rejects async preflight without staging or rollback', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'PREFLIGHT_ASYNC' }, () => {});

    assertRejectedWithZeroEffects(result, ledger, baseline, 'async-callback');
    expect(rollbackCalls).toEqual([]);
  });

  test('rejects stage throw with rollback exactly once and zero publish effects', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'stage' }, () => {
      throw new Error('stage exploded');
    });

    assertRejectedWithZeroEffects(result, ledger, baseline);
    expect(result.ok === false && result.message).toContain('stage exploded');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects async stage callback with rollback exactly once', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'stage' }, () => {
      return thenable(undefined);
    });

    assertRejectedWithZeroEffects(result, ledger, baseline, 'async-callback');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects publish throw with rollback exactly once', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'PUBLISH_THROW' }, () => {});

    assertRejectedWithZeroEffects(result, ledger, baseline);
    expect(result.ok === false && result.message).toContain('publish failed');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects async publish with rollback exactly once', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'PUBLISH_ASYNC' }, () => {});

    assertRejectedWithZeroEffects(result, ledger, baseline, 'async-callback');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects uncaught nested transaction during stage', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'outer' }, (capability, stage) => {
      executor.transact(humanContext({ transactionId: 'txn-nested' }), { text: 'inner' }, () => {});
      stage.value.text = 'mutated';
    });

    assertRejectedWithZeroEffects(result, ledger, baseline, 'nested-transaction');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('poisons outer transaction when nested attempt is caught during stage', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'outer' }, (capability, stage) => {
      try {
        executor.transact(humanContext({ transactionId: 'txn-nested' }), { text: 'inner' }, () => {});
      } catch {
        // swallowed
      }
      stage.value.text = 'still poisoned';
    });

    assertRejectedWithZeroEffects(result, ledger, baseline, 'nested-transaction');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects reentrant transaction during publish', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    let nestedDuringPublish = false;
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight() {},
      publish(stage) {
        executor.transact(humanContext({ transactionId: 'txn-reentrant' }), { text: 'nested' }, () => {});
        nestedDuringPublish = true;
        return { revision: 1, text: stage.text };
      },
      rollback() {},
    });

    const result = executor.transact(humanContext(), { text: 'publish' }, () => {});
    expect(nestedDuringPublish).toBe(true);
    assertRejectedWithZeroEffects(result, ledger, baseline, 'reentrant-transaction');
  });

  test('rejects reentrant transaction during rollback', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    let nestedDuringRollback = false;
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight() {},
      publish() {
        throw new Error('force rollback');
      },
      rollback() {
        executor.transact(humanContext({ transactionId: 'txn-reentrant' }), { text: 'nested' }, () => {});
        nestedDuringRollback = true;
      },
    });

    const result = executor.transact(humanContext(), { text: 'rollback-path' }, () => {});
    expect(nestedDuringRollback).toBe(true);
    assertRejectedWithZeroEffects(result, ledger, baseline);
    expect(result.ok === false && result.message).toContain('force rollback');
  });

  test('rejects mixed mutation origin via assertMutationOrigin', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);
    const otherOrigin = createMutationOrigin('agent', {
      actorId: 'actor-bob',
      sessionId: 'session-bob-1',
    });

    const result = executor.transact(humanContext(), { text: 'outer' }, (capability) => {
      capability.assertMutationOrigin(otherOrigin);
    });

    assertRejectedWithZeroEffects(result, ledger, baseline, 'mixed-origin');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('rejects projection and awareness domains as mixed-origin', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);
    const projection = createProjectionOrigin('binding-reconciliation', {
      changeCommitId: 'commit-proj-1',
    });
    const awareness = createAwarenessOrigin('presence', { actorId: 'actor-alice' });

    const projectionResult = executor.transact(humanContext(), { text: 'outer' }, (capability) => {
      capability.assertMutationOrigin(projection);
    });
    assertRejectedWithZeroEffects(projectionResult, ledger, baseline, 'mixed-origin');
    expect(rollbackCalls).toHaveLength(1);

    rollbackCalls.length = 0;
    const awarenessResult = executor.transact(humanContext(), { text: 'outer' }, (capability) => {
      capability.assertMutationOrigin(awareness);
    });
    assertRejectedWithZeroEffects(awarenessResult, ledger, baseline, 'mixed-origin');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('poisons outer transaction when mixed-origin assert is caught', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);
    const otherOrigin = createMutationOrigin('agent', {
      actorId: 'actor-bob',
      sessionId: 'session-bob-1',
    });

    const result = executor.transact(humanContext(), { text: 'outer' }, (capability, stage) => {
      try {
        capability.assertMutationOrigin(otherOrigin);
      } catch {
        // swallowed
      }
      stage.value.text = 'poisoned';
    });

    assertRejectedWithZeroEffects(result, ledger, baseline, 'mixed-origin');
    expect(rollbackCalls).toHaveLength(1);
  });

  test('preserves primary rejection reason when rollback throws and exposes diagnostic', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'ROLLBACK_THROW' }, () => {
      throw new Error('stage failed');
    });

    assertRejectedWithZeroEffects(result, ledger, baseline);
    expect(result.ok === false && result.message).toContain('stage failed');
    expect(result.ok === false && result.rollbackFailure?.message).toContain('rollback failed');
  });

  test('separate executor instances transact independently', () => {
    const ledgerA = createEffectLedger();
    const ledgerB = createEffectLedger();
    const harnessA = createHarness(ledgerA);
    const harnessB = createHarness(ledgerB);
    let innerDone = false;

    const outer = harnessA.executor.transact(humanContext(), { text: 'outer' }, () => {
      const inner = harnessB.executor.transact(
        humanContext({ actorId: 'actor-bob', sessionId: 'session-bob-1', transactionId: 'txn-bob' }),
        { text: 'inner' },
        () => {
          innerDone = true;
        }
      );
      expect(inner.ok).toBe(true);
    });

    expect(innerDone).toBe(true);
    expect(outer.ok).toBe(true);
    expect(harnessA.rollbackCalls).toEqual([]);
    expect(harnessB.rollbackCalls).toEqual([]);
  });

  test('documents non-atomic callback side effects: stage operates on caller isolated state only', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const external = { leaked: 'before' };
    const { executor, rollbackCalls } = createHarness(ledger);

    const result = executor.transact(humanContext(), { text: 'reject' }, (_capability, stage) => {
      external.leaked = 'during-stage';
      stage.value.text = 'PUBLISH_THROW';
    });

    assertRejectedWithZeroEffects(result, ledger, baseline);
    expect(external.leaked).toBe('during-stage');
    expect(rollbackCalls).toHaveLength(1);
    expect(rollbackCalls[0]?.text).toBe('PUBLISH_THROW');
  });
});

/** @spike-features insert-delete-split-join-operations, origin-metadata */
import { describe, expect, test } from 'bun:test';
import {
  AWARENESS_ORIGIN_KINDS,
  MUTATION_ORIGIN_KINDS,
  PROJECTION_ORIGIN_KINDS,
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
  restore(snapshot: Record<EffectKind, number>): void;
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
    restore(snapshot) {
      for (const kind of Object.keys(counts) as EffectKind[]) {
        counts[kind] = snapshot[kind];
      }
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

describe('task 2.6 mandatory review regressions', () => {
  test('rejects native, inherited, accessor, and hostile proxy thenables without invoking accessors', () => {
    const rejectedValues: unknown[] = [
      Promise.resolve(undefined),
      Object.create({ then() {} }),
    ];
    let accessorCalls = 0;
    rejectedValues.push(
      Object.defineProperty({}, 'then', {
        get() {
          accessorCalls += 1;
          return () => {};
        },
      }),
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error('descriptor trap');
          },
        }
      ),
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('prototype trap');
          },
        }
      )
    );

    for (const value of rejectedValues) {
      const ledger = createEffectLedger();
      const baseline = ledger.snapshot();
      const { executor, rollbackCalls } = createHarness(ledger);
      const result = executor.transact(humanContext(), { text: 'stage' }, () => value);
      assertRejectedWithZeroEffects(result, ledger, baseline, 'async-callback');
      expect(rollbackCalls).toHaveLength(1);
    }
    expect(accessorCalls).toBe(0);
  });

  test('validates candidate origins through snapshots without invoking getters or proxy traps', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    const { executor, rollbackCalls } = createHarness(ledger);
    const same = {
      domain: 'mutation',
      kind: 'human',
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
    };
    const accepted = executor.transact(humanContext(), { text: 'same' }, (capability) => {
      capability.assertMutationOrigin(same);
    });
    expect(accepted.ok).toBe(true);

    let getterCalls = 0;
    const accessor = Object.defineProperty(
      {
        kind: 'human',
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      },
      'domain',
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'mutation';
        },
      }
    );
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('origin descriptor trap');
        },
      }
    );
    for (const candidate of [accessor, hostile, { domain: 'mutation', kind: 'human' }]) {
      const result = executor.transact(humanContext(), { text: 'bad' }, (capability) => {
        try {
          capability.assertMutationOrigin(candidate);
        } catch {
          // The outer transaction must remain poisoned.
        }
      });
      expect(result.ok === false && result.reason).toBe('mixed-origin');
    }
    expect(getterCalls).toBe(0);
    expect(rollbackCalls).toHaveLength(3);
    expect(ledger.snapshot()).toEqual({
      ...baseline,
      canonical: 1,
      yjs: 1,
      revision: 1,
      update: 1,
      notification: 1,
    });
  });

  test('checks nested poison after preflight without staging or rollback', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    let stageCalls = 0;
    let rollbackCalls = 0;
    let executor: SynchronousTransactionExecutor<Stage, Published>;
    executor = createSynchronousTransactionExecutor({
      preflight() {
        executor.transact(
          humanContext({ transactionId: 'txn-preflight-nested' }),
          { text: 'inner' },
          () => {}
        );
      },
      publish(stage) {
        return { revision: 1, text: stage.text };
      },
      rollback() {
        rollbackCalls += 1;
      },
    });

    const result = executor.transact(humanContext(), { text: 'outer' }, () => {
      stageCalls += 1;
    });
    assertRejectedWithZeroEffects(result, ledger, baseline, 'nested-transaction');
    expect(stageCalls).toBe(0);
    expect(rollbackCalls).toBe(0);
  });

  test('checks caught mixed-origin poison after preflight without staging or rollback', () => {
    const ledger = createEffectLedger();
    const baseline = ledger.snapshot();
    let stageCalls = 0;
    let rollbackCalls = 0;
    const different = createMutationOrigin('agent', {
      actorId: 'actor-bob',
      sessionId: 'session-bob-1',
    });
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight(_stage, capability) {
        try {
          capability.assertMutationOrigin(different);
        } catch {
          // The poison must be observed before stage.
        }
      },
      publish(stage) {
        return { revision: 1, text: stage.text };
      },
      rollback() {
        rollbackCalls += 1;
      },
    });

    const result = executor.transact(humanContext(), { text: 'outer' }, () => {
      stageCalls += 1;
    });
    assertRejectedWithZeroEffects(result, ledger, baseline, 'mixed-origin');
    expect(stageCalls).toBe(0);
    expect(rollbackCalls).toBe(0);
  });

  test('rollback restores every effect after publish throws or returns a thenable', () => {
    for (const mode of ['throw', 'thenable'] as const) {
      const ledger = createEffectLedger();
      ledger.record('audit');
      const baseline = ledger.snapshot();
      let rollbackCalls = 0;
      const executor = createSynchronousTransactionExecutor<Stage, Published>({
        preflight() {},
        publish(stage) {
          for (const kind of Object.keys(ledger.counts) as EffectKind[]) {
            ledger.record(kind);
          }
          if (mode === 'throw') throw new Error('publish failed after effects');
          return thenable({ revision: 2, text: stage.text }) as unknown as Published;
        },
        rollback() {
          rollbackCalls += 1;
          ledger.restore(baseline);
        },
      });

      const result = executor.transact(humanContext(), { text: mode }, () => {});
      expect(result.ok).toBe(false);
      if (mode === 'thenable') {
        expect(result.ok === false && result.reason).toBe('async-callback');
      }
      expect(rollbackCalls).toBe(1);
      expect(ledger.snapshot()).toEqual(baseline);
    }
  });

  test('hostile rollback failure preserves typed reason, diagnoses non-atomicity, and resets executor', () => {
    let failRollback = true;
    let publishThenable = true;
    let messageCalls = 0;
    let toStringCalls = 0;
    const hostile = Object.defineProperties(
      {},
      {
        message: {
          get() {
            messageCalls += 1;
            return 'hostile message';
          },
        },
        toString: {
          value() {
            toStringCalls += 1;
            return 'hostile string';
          },
        },
      }
    );
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight() {},
      publish(stage) {
        if (publishThenable) {
          return thenable({ revision: 1, text: stage.text }) as unknown as Published;
        }
        return { revision: 2, text: stage.text };
      },
      rollback() {
        if (failRollback) throw hostile;
      },
    });

    const rejected = executor.transact(humanContext(), { text: 'first' }, () => {});
    expect(rejected.ok === false && rejected.reason).toBe('async-callback');
    expect(rejected.ok === false && rejected.rollbackFailure?.message).toBe(
      'rollback failed with an unsafe thrown value'
    );
    expect(rejected.ok === false && rejected.rollbackFailure?.nonAtomic).toBe(true);
    expect(messageCalls).toBe(0);
    expect(toStringCalls).toBe(0);

    failRollback = false;
    publishThenable = false;
    const recovered = executor.transact(
      humanContext({ transactionId: 'txn-after-hostile-rollback' }),
      { text: 'second' },
      () => {}
    );
    expect(recovered.ok).toBe(true);
  });

  test('origin-kind arrays are runtime frozen and remain oracle-aligned after mutation attempts', () => {
    for (const kinds of [
      MUTATION_ORIGIN_KINDS,
      PROJECTION_ORIGIN_KINDS,
      AWARENESS_ORIGIN_KINDS,
    ]) {
      expect(Object.isFrozen(kinds)).toBe(true);
      expect(() => (kinds as unknown as string[]).push('hostile-kind')).toThrow();
    }
    expect(originDomainsMatchBindingOracleV2()).toBe(true);
  });
});

describe('task 2.6 final descriptor-safe boundary', () => {
  function virtualThenProxy<T extends object>(
    target: T,
    onGetThen: () => void
  ): T {
    return new Proxy(target, {
      get(inner, key, receiver) {
        if (key === 'then') {
          onGetThen();
          return () => {};
        }
        return Reflect.get(inner, key, receiver);
      },
    });
  }

  test('rejects get-only virtual then from every void phase without invoking its get trap', () => {
    for (const phase of ['preflight', 'callback', 'rollback'] as const) {
      let getThenCalls = 0;
      let stageCalls = 0;
      let rollbackCalls = 0;
      const virtual = virtualThenProxy({}, () => {
        getThenCalls += 1;
      });
      const executor = createSynchronousTransactionExecutor<Stage, Published>({
        preflight() {
          if (phase === 'preflight') return virtual as unknown as void;
        },
        publish(stage) {
          return { revision: 1, text: stage.text };
        },
        rollback() {
          rollbackCalls += 1;
          if (phase === 'rollback') return virtual as unknown as void;
        },
      });

      const result = executor.transact(humanContext(), { text: phase }, () => {
        stageCalls += 1;
        if (phase === 'callback' || phase === 'rollback') return virtual;
      });

      expect(result.ok).toBe(false);
      if (phase !== 'rollback') {
        expect(result.ok === false && result.reason).toBe('async-callback');
      } else {
        expect(result.ok === false && result.reason).toBe('async-callback');
        expect(result.ok === false && result.rollbackFailure).toEqual({
          message: 'rollback must return exactly undefined',
          nonAtomic: true,
        });
      }
      expect(stageCalls).toBe(phase === 'preflight' ? 0 : 1);
      expect(rollbackCalls).toBe(phase === 'preflight' ? 0 : 1);
      expect(getThenCalls).toBe(0);
    }
  });

  test('does not assimilate opaque published values with get-only virtual then', () => {
    let getThenCalls = 0;
    const published = virtualThenProxy(
      { revision: 1, text: 'opaque' },
      () => {
        getThenCalls += 1;
      }
    );
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight() {},
      publish() {
        return published;
      },
      rollback() {
        throw new Error('rollback must not run');
      },
    });

    const result = executor.transact(humanContext(), { text: 'opaque' }, () => {});

    expect(result.ok).toBe(true);
    expect(result.ok && result.published === published).toBe(true);
    expect(getThenCalls).toBe(0);
  });

  test('rejects a native Promise from publish and rolls back exactly once', () => {
    let rollbackCalls = 0;
    const executor = createSynchronousTransactionExecutor<Stage, Published>({
      preflight() {},
      publish() {
        return Promise.resolve({ revision: 1, text: 'async' }) as unknown as Published;
      },
      rollback() {
        rollbackCalls += 1;
      },
    });

    const result = executor.transact(humanContext(), { text: 'async' }, () => {});

    expect(result.ok === false && result.reason).toBe('async-callback');
    expect(rollbackCalls).toBe(1);
  });
});

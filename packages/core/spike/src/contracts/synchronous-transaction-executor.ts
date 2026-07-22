/** @spike-features insert-delete-split-join-operations, origin-metadata */
import {
  snapshotAndValidateAwarenessOrigin,
  snapshotAndValidateMutationOrigin,
  snapshotAndValidateProjectionOrigin,
  type MutationOrigin,
} from './origins';
import {
  createTransactionRejection,
  type SynchronousTransactionContext,
  type TransactionRejection,
  type TransactionRejectionReason,
} from './transaction-context';

type ExecutorPhase = 'idle' | 'preflight' | 'stage' | 'publish' | 'rollback';

export interface TransactionMutationCapability {
  readonly origin: MutationOrigin;
  assertMutationOrigin(candidate: unknown): void;
}

export interface SynchronousTransactionStage<TStage> {
  readonly value: TStage;
}

export interface SynchronousTransactionRollbackDiagnostic {
  readonly message: string;
  readonly nonAtomic: true;
}

export type SynchronousTransactionSuccess<TPublished> = {
  readonly ok: true;
  readonly published: TPublished;
};

export type SynchronousTransactionFailure = {
  readonly ok: false;
  readonly reason?: TransactionRejectionReason;
  readonly message: string;
  readonly rollbackFailure?: SynchronousTransactionRollbackDiagnostic;
};

export type SynchronousTransactionResult<TPublished> =
  | SynchronousTransactionSuccess<TPublished>
  | SynchronousTransactionFailure;

export interface SynchronousTransactionExecutorHooks<TStage, TPublished> {
  readonly preflight: (stage: TStage, capability: TransactionMutationCapability) => void;
  readonly publish: (stage: TStage) => TPublished;
  readonly rollback: (stage: TStage) => void;
}

export interface SynchronousTransactionExecutor<TStage, TPublished> {
  transact(
    context: SynchronousTransactionContext,
    stage: TStage,
    callback: (
      capability: TransactionMutationCapability,
      staged: SynchronousTransactionStage<TStage>
    ) => void
  ): SynchronousTransactionResult<TPublished>;
}

/**
 * Stage/preflight operate only on caller-provided isolated state. Rollback restores
 * any publish attempt; arbitrary callback side effects outside that isolated state
 * are not magically atomic. Preflight, callback, and rollback must return exactly
 * `undefined`.
 *
 * Publish returns `TPublished`. The executor descriptor-classifies that value but
 * never Promise-assimilates or awaits it. A proxy whose `then` exists only through
 * a virtual `get` trap is therefore an opaque synchronous published value: detecting
 * it would require executing attacker code, which this boundary never does.
 */
export function createSynchronousTransactionExecutor<TStage, TPublished>(
  hooks: SynchronousTransactionExecutorHooks<TStage, TPublished>
): SynchronousTransactionExecutor<TStage, TPublished> {
  let active: ActiveTransaction<TStage> | null = null;

  const invokeRollback = (current: ActiveTransaction<TStage>): SynchronousTransactionRollbackDiagnostic | undefined => {
    if (current.rollbackInvoked || current.phase === 'preflight') return undefined;
    current.phase = 'rollback';
    current.rollbackInvoked = true;
    let outcome: unknown;
    try {
      outcome = hooks.rollback(current.stage);
    } catch (error) {
      return {
        message: safeThrownMessage(error, 'rollback failed with an unsafe thrown value'),
        nonAtomic: true,
      };
    }
    if (outcome !== undefined) {
      return {
        message: 'rollback must return exactly undefined',
        nonAtomic: true,
      };
    }
    return undefined;
  };

  const finishRejected = (
    current: ActiveTransaction<TStage>,
    rejection: TransactionRejection,
    shouldRollback: boolean
  ): SynchronousTransactionFailure => {
    const rollbackFailure = shouldRollback ? invokeRollback(current) : undefined;
    return failureFromRejection(rejection, rollbackFailure);
  };

  const finishThrown = (
    current: ActiveTransaction<TStage>,
    thrown: unknown
  ): SynchronousTransactionFailure => {
    const rollbackFailure = invokeRollback(current);
    return {
      ok: false,
      message: safeThrownMessage(thrown, 'transaction phase threw an unsafe value'),
      rollbackFailure,
    };
  };

  const rejectConcurrent = (
    current: ActiveTransaction<TStage>
  ): SynchronousTransactionFailure => {
    const reason =
      current.phase === 'preflight' || current.phase === 'stage'
        ? 'nested-transaction'
        : 'reentrant-transaction';
    const rejection = createTransactionRejection(
      reason,
      reason === 'nested-transaction'
        ? 'nested synchronous transaction rejected'
        : 'reentrant synchronous transaction rejected'
    );
    poisonActive(current, rejection);
    return failureFromRejection(rejection);
  };

  return {
    transact(context, stage, callback) {
      if (active !== null) {
        return rejectConcurrent(active);
      }

      const current: ActiveTransaction<TStage> = {
        context,
        stage,
        phase: 'preflight',
        poison: null,
        rollbackInvoked: false,
      };
      active = current;

      try {
        const capability = createCapability(current);
        const preflightOutcome = runSync(() => hooks.preflight(stage, capability));
        if (current.poison !== null) {
          return finishRejected(current, current.poison, false);
        }
        if (preflightOutcome.kind === 'throw') {
          return finishRejected(
            current,
            createTransactionRejection(
              'preflight-failure',
              safeThrownMessage(preflightOutcome.thrown, 'preflight threw an unsafe value')
            ),
            false
          );
        }
        if (preflightOutcome.value !== undefined) {
          return finishRejected(
            current,
            createTransactionRejection(
              'async-callback',
              'preflight must return exactly undefined'
            ),
            false
          );
        }

        current.phase = 'stage';
        const staged: SynchronousTransactionStage<TStage> = { value: stage };
        const callbackOutcome = runSync(() => callback(capability, staged));

        if (current.poison !== null) {
          return finishRejected(current, current.poison, true);
        }
        if (callbackOutcome.kind === 'throw') {
          return finishThrown(current, callbackOutcome.thrown);
        }
        if (callbackOutcome.value !== undefined) {
          return finishRejected(
            current,
            createTransactionRejection(
              'async-callback',
              'transaction callback must return exactly undefined'
            ),
            true
          );
        }

        current.phase = 'publish';
        const publishOutcome = runSync(hooks.publish, stage);
        if (current.poison !== null) {
          return finishRejected(current, current.poison, true);
        }
        if (publishOutcome.kind === 'throw') {
          return finishThrown(current, publishOutcome.thrown);
        }
        if (classifyThenable(publishOutcome.value) !== 'not-thenable') {
          return finishRejected(
            current,
            createTransactionRejection('async-callback', 'publish returned a thenable'),
            true
          );
        }

        return { ok: true, published: publishOutcome.value };
      } catch (error) {
        if (isTransactionControlError(error)) {
          return finishRejected(current, error.rejection, current.phase !== 'preflight');
        }
        return finishThrown(current, error);
      } finally {
        if (active === current) active = null;
      }
    },
  };
}

interface ActiveTransaction<TStage> {
  context: SynchronousTransactionContext;
  stage: TStage;
  phase: ExecutorPhase;
  poison: TransactionRejection | null;
  rollbackInvoked: boolean;
}

class TransactionControlError extends Error {
  readonly rejection: TransactionRejection;

  constructor(rejection: TransactionRejection) {
    super(rejection.message);
    this.name = 'TransactionControlError';
    this.rejection = rejection;
    TRANSACTION_CONTROL_ERRORS.add(this);
  }
}

const TRANSACTION_CONTROL_ERRORS = new WeakSet<object>();

function isTransactionControlError(error: unknown): error is TransactionControlError {
  return (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    TRANSACTION_CONTROL_ERRORS.has(error)
  );
}

type SyncOutcome<TReturn> =
  | { readonly kind: 'return'; readonly value: TReturn }
  | { readonly kind: 'throw'; readonly thrown: unknown };

function runSync<TReturn>(fn: () => TReturn): SyncOutcome<TReturn>;
function runSync<TArg, TReturn>(fn: (arg: TArg) => TReturn, arg: TArg): SyncOutcome<TReturn>;
function runSync<TArg, TReturn>(
  fn: ((arg: TArg) => TReturn) | (() => TReturn),
  arg?: TArg
): SyncOutcome<TReturn> {
  let outcome: TReturn;
  try {
    outcome = arg === undefined ? (fn as () => TReturn)() : (fn as (value: TArg) => TReturn)(arg);
  } catch (error) {
    if (isTransactionControlError(error)) throw error;
    return { kind: 'throw', thrown: error };
  }
  return { kind: 'return', value: outcome };
}

type ThenableClassification = 'not-thenable' | 'thenable' | 'hostile';

function classifyThenable(value: unknown): ThenableClassification {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return 'not-thenable';
  }

  const visited = new Set<object>();
  let current: object | null = value;
  while (current !== null) {
    if (visited.has(current)) return 'hostile';
    visited.add(current);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, 'then');
    } catch {
      return 'hostile';
    }
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) return 'hostile';
      return typeof descriptor.value === 'function' ? 'thenable' : 'not-thenable';
    }
    try {
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      return 'hostile';
    }
  }
  return 'not-thenable';
}

function createCapability<TStage>(active: ActiveTransaction<TStage>): TransactionMutationCapability {
  return Object.freeze({
    origin: active.context.origin,
    assertMutationOrigin(candidate: unknown): void {
      const mutation = safelySnapshotOrigin(snapshotAndValidateMutationOrigin, candidate);
      if (mutation !== null) {
        if (!mutationOriginsEqual(mutation, active.context.origin)) {
          rejectMixedOrigin(active, 'mutation origin mismatch');
        }
        return;
      }
      if (safelySnapshotOrigin(snapshotAndValidateProjectionOrigin, candidate) !== null) {
        rejectMixedOrigin(active, 'projection origins cannot mutate');
      }
      if (safelySnapshotOrigin(snapshotAndValidateAwarenessOrigin, candidate) !== null) {
        rejectMixedOrigin(active, 'awareness origins cannot mutate');
      }
      rejectMixedOrigin(active, 'invalid mutation origin');
    },
  });
}

function safelySnapshotOrigin<T>(
  validator: (candidate: unknown) => {
    readonly snapshot: T | null;
    readonly errors: readonly string[];
  },
  candidate: unknown
): T | null {
  try {
    const result = validator(candidate);
    return result.errors.length === 0 ? result.snapshot : null;
  } catch {
    return null;
  }
}

function rejectMixedOrigin<TStage>(active: ActiveTransaction<TStage>, detail: string): never {
  const rejection = createTransactionRejection(
    'mixed-origin',
    `mixed-origin transaction rejected: ${detail}`
  );
  poisonActive(active, rejection);
  throw new TransactionControlError(rejection);
}

function mutationOriginsEqual(left: MutationOrigin, right: MutationOrigin): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'remote' && right.kind === 'remote') {
    return (
      left.actorId === right.actorId &&
      left.replicaId === right.replicaId &&
      left.sessionId === right.sessionId &&
      left.updateId === right.updateId
    );
  }
  if (left.kind === 'repair' && right.kind === 'repair') {
    return (
      left.actorId === right.actorId &&
      left.sessionId === right.sessionId &&
      left.repairConstituentId === right.repairConstituentId
    );
  }
  if (
    left.kind !== 'remote' &&
    left.kind !== 'repair' &&
    right.kind !== 'remote' &&
    right.kind !== 'repair'
  ) {
    return left.actorId === right.actorId && left.sessionId === right.sessionId;
  }
  return false;
}

function poisonActive<TStage>(active: ActiveTransaction<TStage>, rejection: TransactionRejection): void {
  if (active.poison === null) active.poison = rejection;
}

function failureFromRejection(
  rejection: TransactionRejection,
  rollbackFailure?: SynchronousTransactionRollbackDiagnostic
): SynchronousTransactionFailure {
  return {
    ok: false,
    reason: rejection.reason,
    message: rejection.message,
    rollbackFailure,
  };
}

function safeThrownMessage(thrown: unknown, fallback: string): string {
  if (typeof thrown === 'string' && thrown.length > 0) return thrown;
  if (
    thrown === null ||
    (typeof thrown !== 'object' && typeof thrown !== 'function')
  ) {
    return fallback;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(thrown, 'message');
    if (
      descriptor !== undefined &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      descriptor.value.length > 0
    ) {
      return descriptor.value;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

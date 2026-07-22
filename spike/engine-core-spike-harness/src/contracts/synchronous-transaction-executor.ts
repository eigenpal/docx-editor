/** @spike-features insert-delete-split-join-operations, origin-metadata */
import {
  originKindIsMutationOnly,
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
  readonly preflight: (stage: TStage) => void;
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
    ) => unknown
  ): SynchronousTransactionResult<TPublished>;
}

/**
 * Stage/preflight operate only on caller-provided isolated state. Rollback restores
 * any publish attempt; arbitrary callback side effects outside that isolated state
 * are not magically atomic.
 */
export function createSynchronousTransactionExecutor<TStage, TPublished>(
  hooks: SynchronousTransactionExecutorHooks<TStage, TPublished>
): SynchronousTransactionExecutor<TStage, TPublished> {
  let active: ActiveTransaction<TStage> | null = null;

  const clearActive = (): void => {
    active = null;
  };

  const invokeRollback = (current: ActiveTransaction<TStage>): SynchronousTransactionRollbackDiagnostic | undefined => {
    if (current.rollbackInvoked || current.phase === 'preflight') return undefined;
    current.phase = 'rollback';
    current.rollbackInvoked = true;
    try {
      hooks.rollback(current.stage);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
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
    clearActive();
    return failureFromRejection(rejection, rollbackFailure);
  };

  const finishThrown = (
    current: ActiveTransaction<TStage>,
    message: string
  ): SynchronousTransactionFailure => {
    const rollbackFailure = invokeRollback(current);
    clearActive();
    return { ok: false, message, rollbackFailure };
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

      active = {
        context,
        stage,
        phase: 'preflight',
        poison: null,
        rollbackInvoked: false,
      };

      try {
        const preflightOutcome = runSync(hooks.preflight, stage);
        if (preflightOutcome.kind === 'thenable') {
          return finishRejected(
            active,
            createTransactionRejection('async-callback', 'preflight returned a thenable'),
            false
          );
        }
        if (preflightOutcome.kind === 'throw') {
          return finishRejected(
            active,
            createTransactionRejection('preflight-failure', preflightOutcome.message),
            false
          );
        }

        active.phase = 'stage';
        const capability = createCapability(active);
        const staged: SynchronousTransactionStage<TStage> = { value: stage };
        const callbackOutcome = runSync(() => callback(capability, staged), undefined);

        if (active.poison !== null) {
          return finishRejected(active, active.poison, true);
        }
        if (callbackOutcome.kind === 'thenable') {
          return finishRejected(
            active,
            createTransactionRejection('async-callback', 'transaction callback returned a thenable'),
            true
          );
        }
        if (callbackOutcome.kind === 'throw') {
          return finishThrown(active, callbackOutcome.message);
        }

        active.phase = 'publish';
        const publishOutcome = runSync(hooks.publish, stage);
        if (active.poison !== null) {
          return finishRejected(active, active.poison, true);
        }
        if (publishOutcome.kind === 'thenable') {
          return finishRejected(
            active,
            createTransactionRejection('async-callback', 'publish returned a thenable'),
            true
          );
        }
        if (publishOutcome.kind === 'throw') {
          return finishThrown(active, publishOutcome.message);
        }

        const published = publishOutcome.value;
        clearActive();
        return { ok: true, published };
      } catch (error) {
        if (active === null) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
        if (isTransactionControlError(error)) {
          return finishRejected(active, error.rejection, active.phase !== 'preflight');
        }
        return finishThrown(active, error instanceof Error ? error.message : String(error));
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
  }
}

function isTransactionControlError(error: unknown): error is TransactionControlError {
  return error instanceof TransactionControlError;
}

type SyncOutcome<TReturn> =
  | { readonly kind: 'return'; readonly value: TReturn }
  | { readonly kind: 'throw'; readonly message: string }
  | { readonly kind: 'thenable' };

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
    return {
      kind: 'throw',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (isThenable(outcome)) return { kind: 'thenable' };
  return { kind: 'return', value: outcome };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

function createCapability<TStage>(active: ActiveTransaction<TStage>): TransactionMutationCapability {
  return Object.freeze({
    origin: active.context.origin,
    assertMutationOrigin(candidate: unknown): void {
      if (!originKindIsMutationOnly(candidate)) {
        rejectMixedOrigin(active, 'origin domain is not mutation');
      }
      if (!mutationOriginsEqual(candidate, active.context.origin)) {
        rejectMixedOrigin(active, 'mutation origin mismatch');
      }
    },
  });
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

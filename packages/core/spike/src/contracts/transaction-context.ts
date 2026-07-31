/** @spike-features insert-delete-split-join-operations, origin-metadata */
import {
  snapshotAndValidateMutationOrigin,
  type MutationOrigin,
} from './origins';
import {
  collectValidation,
  hasUniqueStrings,
  readClosedDataObject,
  snapshotDenseArray,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId } from './ids';

export const TRANSACTION_CONTEXT_VERSION = 'transaction-context/1';

export const TRANSACTION_REJECTION_REASONS = [
  'async-callback',
  'mixed-origin',
  'nested-transaction',
  'preflight-failure',
  'reentrant-transaction',
] as const;

export type TransactionRejectionReason = (typeof TRANSACTION_REJECTION_REASONS)[number];

export interface SynchronousTransactionContext {
  readonly version: typeof TRANSACTION_CONTEXT_VERSION;
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly transactionId: string;
  readonly origin: MutationOrigin;
  readonly rejectionReasons: readonly TransactionRejectionReason[];
}

export interface TransactionRejection {
  readonly reason: TransactionRejectionReason;
  readonly message: string;
}

export function createSynchronousTransactionContext(input: {
  actorId: string;
  sessionId: string;
  groupId: string;
  transactionId: string;
  origin: MutationOrigin;
}): SynchronousTransactionContext {
  const value = readClosedDataObject(
    input,
    ['actorId', 'sessionId', 'groupId', 'transactionId', 'origin'],
    'transaction context factory input'
  );
  return createValidatedTransactionContext({
    ...value,
    rejectionReasons: Object.freeze([...TRANSACTION_REJECTION_REASONS]),
  });
}

export function snapshotAndValidateSynchronousTransactionContext(
  input: unknown
): ValidationSnapshot<SynchronousTransactionContext> {
  return collectValidation(validateTransactionContext, () => {
    const value = readClosedDataObject(
      input,
      [
        'version',
        'actorId',
        'sessionId',
        'groupId',
        'transactionId',
        'origin',
        'rejectionReasons',
      ],
      'transaction context'
    );
    if (value.version !== TRANSACTION_CONTEXT_VERSION) {
      throw new TypeError('invalid transaction context version');
    }
    return createValidatedTransactionContext({
      ...value,
      rejectionReasons: snapshotDenseArray(
        value.rejectionReasons,
        'transaction rejection reasons'
      ),
    });
  });
}

function createValidatedTransactionContext(
  value: Record<string, unknown>
): SynchronousTransactionContext {
  const origin = snapshotAndValidateMutationOrigin(value.origin);
  if (!origin.snapshot || origin.errors.length > 0) {
    throw new TypeError('transaction context requires a valid mutation origin');
  }
  const context = Object.freeze({
    version: TRANSACTION_CONTEXT_VERSION,
    actorId: value.actorId as string,
    sessionId: value.sessionId as string,
    groupId: value.groupId as string,
    transactionId: value.transactionId as string,
    origin: origin.snapshot,
    rejectionReasons: Object.freeze(
      [...(value.rejectionReasons as readonly TransactionRejectionReason[])]
    ),
  });
  const errors = validateTransactionContext(context);
  if (errors.length > 0) throw new TypeError(`invalid transaction context: ${errors.join('; ')}`);
  return context;
}

function validateTransactionContext(
  context: SynchronousTransactionContext
): readonly string[] {
  const errors: string[] = [];
  if (context.version !== TRANSACTION_CONTEXT_VERSION) errors.push('invalid transaction context version');
  errors.push(
    validateSpikeId(context.actorId, 'transaction actorId') ?? '',
    validateSpikeId(context.sessionId, 'transaction sessionId') ?? '',
    validateSpikeId(context.groupId, 'transaction groupId') ?? '',
    validateSpikeId(context.transactionId, 'transactionId') ?? ''
  );
  if (
    context.rejectionReasons.length !== TRANSACTION_REJECTION_REASONS.length ||
    !hasUniqueStrings(context.rejectionReasons) ||
    !TRANSACTION_REJECTION_REASONS.every((reason) => context.rejectionReasons.includes(reason))
  ) {
    errors.push('invalid transaction rejection reasons');
  }
  if (context.origin.actorId !== context.actorId) errors.push('transaction actor/origin mismatch');
  if (
    context.origin.kind !== 'remote' &&
    context.origin.sessionId !== context.sessionId
  ) {
    errors.push('transaction session/origin mismatch');
  }
  return errors.filter(Boolean);
}

export function createTransactionRejection(
  reason: TransactionRejectionReason,
  message: string
): TransactionRejection {
  if (!TRANSACTION_REJECTION_REASONS.includes(reason)) {
    throw new TypeError('invalid transaction rejection reason');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('transaction rejection message must be non-empty');
  }
  return Object.freeze({ reason, message });
}

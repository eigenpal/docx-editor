/** @spike-features insert-delete-split-join-operations */
import type { BrandedDocOp } from './brands';
import {
  collectValidation,
  hasUniqueStrings,
  isNonNegativeSafeInteger,
  readClosedDataObject,
  snapshotDenseArray,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId, validateSpikeIdList } from './ids';

export const DOC_OP_CONTRACT_VERSION = 'doc-op/1';

export type DocOpMarkKind = 'bold' | 'italic';

export type DocOpSingle =
  | {
      readonly kind: 'insertText';
      readonly storyId: string;
      readonly blockId: string;
      readonly offset: number;
      readonly text: string;
    }
  | {
      readonly kind: 'deleteRange';
      readonly storyId: string;
      readonly blockId: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: 'splitParagraph';
      readonly storyId: string;
      readonly blockId: string;
      readonly offset: number;
    }
  | {
      readonly kind: 'joinParagraphs';
      readonly storyId: string;
      readonly firstBlockId: string;
      readonly secondBlockId: string;
    }
  | {
      readonly kind: 'setMark';
      readonly storyId: string;
      readonly blockId: string;
      readonly mark: DocOpMarkKind;
      readonly start: number;
      readonly end: number;
      readonly enabled: boolean;
    };

export interface DocOpTransactionMetadata {
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentIds: readonly string[];
}

export interface DocOpBatch extends BrandedDocOp {
  readonly version: typeof DOC_OP_CONTRACT_VERSION;
  readonly kind: 'batch';
  readonly ops: readonly DocOpSingle[];
  readonly transaction: DocOpTransactionMetadata;
}

export type DocOp = DocOpBatch;

const TRUSTED_DOC_OPS = new WeakSet<object>();

const SINGLE_OP_KEYS: Record<DocOpSingle['kind'], readonly string[]> = {
  insertText: ['kind', 'storyId', 'blockId', 'offset', 'text'],
  deleteRange: ['kind', 'storyId', 'blockId', 'start', 'end'],
  splitParagraph: ['kind', 'storyId', 'blockId', 'offset'],
  joinParagraphs: ['kind', 'storyId', 'firstBlockId', 'secondBlockId'],
  setMark: ['kind', 'storyId', 'blockId', 'mark', 'start', 'end', 'enabled'],
};

export function createDocOpBatch(input: {
  ops: readonly DocOpSingle[];
  transaction: DocOpTransactionMetadata;
}): DocOp {
  const outer = readClosedDataObject(input, ['ops', 'transaction'], 'DocOp factory input');
  const ops = snapshotDenseArray(outer.ops, 'DocOp ops').map(snapshotDocOpSingle);
  const transaction = snapshotTransaction(outer.transaction);
  const errors = validateDocOpParts(ops, transaction);
  if (errors.length > 0) throw new TypeError(`invalid DocOp: ${errors.join('; ')}`);
  return createTrustedDocOp(ops, transaction);
}

function createTrustedDocOp(
  ops: readonly DocOpSingle[],
  transaction: DocOpTransactionMetadata
): DocOp {
  const batch = Object.freeze({
    version: DOC_OP_CONTRACT_VERSION,
    kind: 'batch' as const,
    ops: Object.freeze(ops.map((op) => Object.freeze(op))),
    transaction: Object.freeze({
      actorId: transaction.actorId,
      sessionId: transaction.sessionId,
      groupId: transaction.groupId,
      constituentIds: Object.freeze([...transaction.constituentIds]),
    }),
  }) as unknown as DocOp;
  TRUSTED_DOC_OPS.add(batch);
  return batch;
}

export function snapshotAndValidateDocOp(input: unknown): ValidationSnapshot<DocOp> {
  if (isDocOp(input)) {
    return { snapshot: input, errors: validateTrustedDocOp(input) };
  }
  return collectValidation(validateTrustedDocOp, () => snapshotDocOp(input));
}

export function snapshotAndValidateInternalDocOpSingle(
  input: unknown
): ValidationSnapshot<DocOpSingle> {
  return collectValidation(validateDocOpSingle, () => snapshotDocOpSingle(input));
}

export function snapshotDocOp(input: unknown): DocOp {
  const batch = readClosedDataObject(
    input,
    ['version', 'kind', 'ops', 'transaction'],
    'DocOp batch'
  );
  if (batch.version !== DOC_OP_CONTRACT_VERSION || batch.kind !== 'batch') {
    throw new TypeError('invalid DocOp batch header');
  }
  const ops = snapshotDenseArray(batch.ops, 'DocOp ops').map((op) => snapshotDocOpSingle(op));
  const transaction = snapshotTransaction(batch.transaction);
  const errors = validateDocOpParts(ops, transaction);
  if (errors.length > 0) throw new TypeError(`invalid DocOp: ${errors.join('; ')}`);
  return createTrustedDocOp(ops, transaction);
}

function snapshotDocOpSingle(input: unknown): DocOpSingle {
  const header = readClosedDiscriminant(input, 'DocOp single');
  const kind = header;
  if (typeof kind !== 'string' || !(kind in SINGLE_OP_KEYS)) {
    throw new TypeError('invalid DocOp single kind');
  }
  const record = readClosedDataObject(input, SINGLE_OP_KEYS[kind as DocOpSingle['kind']], 'DocOp single');
  return record as DocOpSingle;
}

function readClosedDiscriminant(input: unknown, label: string): unknown {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new TypeError(`${label} kind must be a data field`);
  }
  return descriptor.value;
}

function snapshotTransaction(input: unknown): DocOpTransactionMetadata {
  const transaction = readClosedDataObject(
    input,
    ['actorId', 'sessionId', 'groupId', 'constituentIds'],
    'DocOp transaction'
  );
  return {
    actorId: transaction.actorId as string,
    sessionId: transaction.sessionId as string,
    groupId: transaction.groupId as string,
    constituentIds: snapshotDenseArray(
      transaction.constituentIds,
      'DocOp constituentIds'
    ) as string[],
  };
}

function validateTrustedDocOp(op: DocOp): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_DOC_OPS.has(op)) errors.push('untrusted DocOp batch');
  if (op.version !== DOC_OP_CONTRACT_VERSION) errors.push('invalid DocOp version');
  if (op.kind !== 'batch') errors.push('DocOp must be a batch');
  errors.push(...validateDocOpParts(op.ops, op.transaction));
  return errors.filter(Boolean);
}

function validateDocOpParts(
  ops: readonly DocOpSingle[],
  transaction: DocOpTransactionMetadata
): readonly string[] {
  const errors: string[] = [];
  if (ops.length === 0) errors.push('DocOp batch must contain operations');
  errors.push(
    validateSpikeId(transaction.actorId, 'transaction actorId') ?? '',
    validateSpikeId(transaction.sessionId, 'transaction sessionId') ?? '',
    validateSpikeId(transaction.groupId, 'transaction groupId') ?? '',
    validateSpikeIdList(transaction.constituentIds, 'transaction constituentIds') ?? ''
  );
  if (!hasUniqueStrings(transaction.constituentIds)) errors.push('duplicate constituent ID');
  if (transaction.constituentIds.length !== ops.length) {
    errors.push('constituent ID count must equal operation count');
  }
  for (const single of ops) errors.push(...validateDocOpSingle(single));
  return errors.filter(Boolean);
}

function validateDocOpSingle(op: DocOpSingle): readonly string[] {
  const errors: string[] = [];
  errors.push(validateSpikeId(op.storyId, 'storyId') ?? '');
  switch (op.kind) {
    case 'insertText':
      errors.push(
        validateSpikeId(op.blockId, 'blockId') ?? '',
        validateOffset(op.offset, 'offset') ?? '',
        typeof op.text === 'string' ? '' : 'invalid insert text'
      );
      break;
    case 'deleteRange':
      errors.push(
        validateSpikeId(op.blockId, 'blockId') ?? '',
        validateOffset(op.start, 'start') ?? '',
        validateOffset(op.end, 'end') ?? '',
        op.end >= op.start ? '' : 'invalid delete range'
      );
      break;
    case 'splitParagraph':
      errors.push(
        validateSpikeId(op.blockId, 'blockId') ?? '',
        validateOffset(op.offset, 'offset') ?? ''
      );
      break;
    case 'joinParagraphs':
      errors.push(
        validateSpikeId(op.firstBlockId, 'firstBlockId') ?? '',
        validateSpikeId(op.secondBlockId, 'secondBlockId') ?? '',
        op.firstBlockId !== op.secondBlockId ? '' : 'join targets must differ'
      );
      break;
    case 'setMark':
      errors.push(
        validateSpikeId(op.blockId, 'blockId') ?? '',
        ['bold', 'italic'].includes(op.mark) ? '' : 'invalid mark kind',
        validateOffset(op.start, 'start') ?? '',
        validateOffset(op.end, 'end') ?? '',
        op.end > op.start ? '' : 'invalid mark range',
        typeof op.enabled === 'boolean' ? '' : 'invalid mark enabled flag'
      );
      break;
    default:
      errors.push('unknown DocOp single kind');
  }
  return errors.filter(Boolean);
}

function validateOffset(value: number, label: string): string | null {
  if (!isNonNegativeSafeInteger(value)) return `invalid ${label}`;
  return null;
}

export function isDocOp(value: unknown): value is DocOp {
  return typeof value === 'object' && value !== null && TRUSTED_DOC_OPS.has(value);
}

export function rejectsModelChangeAsDocOp(value: unknown): boolean {
  return snapshotAndValidateDocOp(value).errors.length > 0;
}

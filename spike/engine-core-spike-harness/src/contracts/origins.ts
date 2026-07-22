/** @spike-features origin-metadata, awareness-metadata */
import bindingOracle from '../../oracles/binding-oracle.v2.json';
import {
  collectValidation,
  hasExactKeys,
  isPlainRecord,
  readClosedDataObject,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId } from './ids';

export const MUTATION_ORIGIN_KINDS = Object.freeze([
  'human',
  'agent',
  'remote',
  'undo',
  'redo',
  'repair',
] as const);
export const PROJECTION_ORIGIN_KINDS = Object.freeze(['binding-reconciliation'] as const);
export const AWARENESS_ORIGIN_KINDS = Object.freeze([
  'presence',
  'selection-ephemeral',
] as const);

export type MutationOriginKind = (typeof MUTATION_ORIGIN_KINDS)[number];
export type ProjectionOriginKind = (typeof PROJECTION_ORIGIN_KINDS)[number];
export type AwarenessOriginKind = (typeof AWARENESS_ORIGIN_KINDS)[number];

export type MutationOrigin =
  | {
      readonly domain: 'mutation';
      readonly kind: 'human' | 'agent' | 'undo' | 'redo';
      readonly actorId: string;
      readonly sessionId: string;
    }
  | {
      readonly domain: 'mutation';
      readonly kind: 'remote';
      readonly actorId: string;
      readonly replicaId: string;
      readonly sessionId: string;
      readonly updateId: string;
    }
  | {
      readonly domain: 'mutation';
      readonly kind: 'repair';
      readonly actorId: string;
      readonly sessionId: string;
      readonly repairConstituentId: string;
    };

export type ProjectionOrigin = {
  readonly domain: 'projection';
  readonly kind: 'binding-reconciliation';
  readonly changeCommitId: string;
};

export type AwarenessOrigin =
  | { readonly domain: 'awareness'; readonly kind: 'presence'; readonly actorId: string }
  | {
      readonly domain: 'awareness';
      readonly kind: 'selection-ephemeral';
      readonly actorId: string;
    };

export type Origin = MutationOrigin | ProjectionOrigin | AwarenessOrigin;

export function createMutationOrigin<K extends Exclude<MutationOriginKind, 'remote' | 'repair'>>(
  kind: K,
  input: { actorId: string; sessionId: string }
): Extract<MutationOrigin, { kind: K }>;
export function createMutationOrigin(
  kind: 'remote',
  input: {
    actorId: string;
    replicaId: string;
    sessionId?: string;
    updateId: string;
  }
): Extract<MutationOrigin, { kind: 'remote' }>;
export function createMutationOrigin(
  kind: 'repair',
  input: { actorId: string; sessionId: string; repairConstituentId: string }
): Extract<MutationOrigin, { kind: 'repair' }>;
export function createMutationOrigin(
  kind: MutationOriginKind,
  input: Record<string, string>
): MutationOrigin {
  if (kind === 'remote') {
    const value = readClosedDataObject(
      input,
      input.sessionId === undefined
        ? ['actorId', 'replicaId', 'updateId']
        : ['actorId', 'replicaId', 'sessionId', 'updateId'],
      'remote origin input'
    );
    return createTrustedMutationOrigin('remote', value);
  }
  if (kind === 'repair') {
    const value = readClosedDataObject(
      input,
      ['actorId', 'sessionId', 'repairConstituentId'],
      'repair origin input'
    );
    return createTrustedMutationOrigin('repair', value);
  }
  const value = readClosedDataObject(input, ['actorId', 'sessionId'], 'mutation origin input');
  return createTrustedMutationOrigin(kind, value);
}

function createTrustedMutationOrigin(
  kind: MutationOriginKind,
  input: Record<string, unknown>
): MutationOrigin {
  const origin = Object.freeze({
    domain: 'mutation',
    kind,
    actorId: input.actorId,
    ...(kind === 'remote'
      ? {
          replicaId: input.replicaId,
          sessionId: input.sessionId ?? input.replicaId,
          updateId: input.updateId,
        }
      : {
          sessionId: input.sessionId,
          ...(kind === 'repair' ? { repairConstituentId: input.repairConstituentId } : {}),
        }),
  }) as MutationOrigin;
  const errors = validateTrustedMutationOrigin(origin);
  if (errors.length > 0) throw new TypeError(`invalid mutation origin: ${errors.join('; ')}`);
  return origin;
}

export function createProjectionOrigin(
  kind: ProjectionOriginKind,
  input: { changeCommitId: string }
): ProjectionOrigin {
  const value = readClosedDataObject(input, ['changeCommitId'], 'projection origin input');
  const origin = Object.freeze({
    domain: 'projection',
    kind,
    changeCommitId: value.changeCommitId,
  }) as ProjectionOrigin;
  const errors = validateTrustedProjectionOrigin(origin);
  if (errors.length > 0) throw new TypeError(`invalid projection origin: ${errors.join('; ')}`);
  return origin;
}

export function createAwarenessOrigin(
  kind: AwarenessOriginKind,
  input: { actorId: string }
): AwarenessOrigin {
  const value = readClosedDataObject(input, ['actorId'], 'awareness origin input');
  const origin = Object.freeze({
    domain: 'awareness',
    kind,
    actorId: value.actorId,
  }) as AwarenessOrigin;
  const errors = validateTrustedAwarenessOrigin(origin);
  if (errors.length > 0) throw new TypeError(`invalid awareness origin: ${errors.join('; ')}`);
  return origin;
}

export function snapshotAndValidateMutationOrigin(input: unknown): ValidationSnapshot<MutationOrigin> {
  return collectValidation(validateTrustedMutationOrigin, () => snapshotMutationOrigin(input));
}

export function snapshotAndValidateProjectionOrigin(
  input: unknown
): ValidationSnapshot<ProjectionOrigin> {
  return collectValidation(validateTrustedProjectionOrigin, () => snapshotProjectionOrigin(input));
}

export function snapshotAndValidateAwarenessOrigin(input: unknown): ValidationSnapshot<AwarenessOrigin> {
  return collectValidation(validateTrustedAwarenessOrigin, () => snapshotAwarenessOrigin(input));
}

function snapshotMutationOrigin(input: unknown): MutationOrigin {
  const kindDescriptor =
    input !== null && typeof input === 'object'
      ? Object.getOwnPropertyDescriptor(input, 'kind')
      : undefined;
  if (!kindDescriptor || !kindDescriptor.enumerable || !('value' in kindDescriptor)) {
    throw new TypeError('mutation origin kind must be a data field');
  }
  const kind = kindDescriptor.value;
  if (!MUTATION_ORIGIN_KINDS.includes(kind as MutationOriginKind)) {
    throw new TypeError('invalid mutation origin kind');
  }
  if (kind === 'remote') {
    const remote = readClosedDataObject(
      input,
      ['domain', 'kind', 'actorId', 'replicaId', 'sessionId', 'updateId'],
      'mutation origin'
    );
    if (remote.domain !== 'mutation') throw new TypeError('invalid mutation origin domain');
    return createTrustedMutationOrigin('remote', remote);
  }
  if (kind === 'repair') {
    const repair = readClosedDataObject(
      input,
      ['domain', 'kind', 'actorId', 'sessionId', 'repairConstituentId'],
      'mutation origin'
    );
    if (repair.domain !== 'mutation') throw new TypeError('invalid mutation origin domain');
    return createTrustedMutationOrigin('repair', repair);
  }
  const standard = readClosedDataObject(
    input,
    ['domain', 'kind', 'actorId', 'sessionId'],
    'mutation origin'
  );
  if (standard.domain !== 'mutation') throw new TypeError('invalid mutation origin domain');
  return createTrustedMutationOrigin(
    kind as Exclude<MutationOriginKind, 'remote' | 'repair'>,
    standard
  );
}

function snapshotProjectionOrigin(input: unknown): ProjectionOrigin {
  const origin = readClosedDataObject(
    input,
    ['domain', 'kind', 'changeCommitId'],
    'projection origin'
  );
  if (origin.domain !== 'projection' || origin.kind !== 'binding-reconciliation') {
    throw new TypeError('invalid projection origin');
  }
  return Object.freeze(origin) as unknown as ProjectionOrigin;
}

function snapshotAwarenessOrigin(input: unknown): AwarenessOrigin {
  const origin = readClosedDataObject(input, ['domain', 'kind', 'actorId'], 'awareness origin');
  if (origin.domain !== 'awareness') throw new TypeError('invalid awareness origin domain');
  if (!AWARENESS_ORIGIN_KINDS.includes(origin.kind as AwarenessOriginKind)) {
    throw new TypeError('invalid awareness origin kind');
  }
  return Object.freeze(origin) as unknown as AwarenessOrigin;
}

function validateTrustedMutationOrigin(origin: MutationOrigin): readonly string[] {
  const errors: string[] = [];
  if (origin.domain !== 'mutation') errors.push('invalid mutation origin domain');
  if (!MUTATION_ORIGIN_KINDS.includes(origin.kind)) errors.push('invalid mutation origin kind');
  if (origin.kind === 'remote') {
    errors.push(
      validateSpikeId(origin.actorId, 'remote actorId') ?? '',
      validateSpikeId(origin.replicaId, 'remote replicaId') ?? '',
      validateSpikeId(origin.sessionId, 'remote sessionId') ?? '',
      validateSpikeId(origin.updateId, 'remote updateId') ?? ''
    );
  } else if (origin.kind === 'repair') {
    errors.push(
      validateSpikeId(origin.actorId, 'repair actorId') ?? '',
      validateSpikeId(origin.sessionId, 'repair sessionId') ?? '',
      validateSpikeId(origin.repairConstituentId, 'repairConstituentId') ?? ''
    );
  } else {
    errors.push(
      validateSpikeId(origin.actorId, 'mutation actorId') ?? '',
      validateSpikeId(origin.sessionId, 'mutation sessionId') ?? ''
    );
  }
  return errors.filter(Boolean);
}

function validateTrustedProjectionOrigin(origin: ProjectionOrigin): readonly string[] {
  const errors: string[] = [];
  if (origin.domain !== 'projection') errors.push('invalid projection origin domain');
  if (!PROJECTION_ORIGIN_KINDS.includes(origin.kind)) errors.push('invalid projection origin kind');
  errors.push(validateSpikeId(origin.changeCommitId, 'changeCommitId') ?? '');
  return errors.filter(Boolean);
}

function validateTrustedAwarenessOrigin(origin: AwarenessOrigin): readonly string[] {
  const errors: string[] = [];
  if (origin.domain !== 'awareness') errors.push('invalid awareness origin domain');
  if (!AWARENESS_ORIGIN_KINDS.includes(origin.kind)) errors.push('invalid awareness origin kind');
  errors.push(validateSpikeId(origin.actorId, 'awareness actorId') ?? '');
  return errors.filter(Boolean);
}

export function originDomainsDoNotOverlap(): boolean {
  return originDomainsMatchBindingOracleV2();
}

export function originDomainsMatchBindingOracleV2(): boolean {
  const oracleOrigins = bindingOracle.origins as {
    mutation: readonly string[];
    projection: readonly string[];
    awareness: readonly string[];
  };
  return (
    oracleOrigins.mutation.every((kind) => MUTATION_ORIGIN_KINDS.includes(kind as MutationOriginKind)) &&
    oracleOrigins.projection.every((kind) =>
      PROJECTION_ORIGIN_KINDS.includes(kind as ProjectionOriginKind)
    ) &&
    oracleOrigins.awareness.every((kind) =>
      AWARENESS_ORIGIN_KINDS.includes(kind as AwarenessOriginKind)
    ) &&
    new Set([...MUTATION_ORIGIN_KINDS, ...PROJECTION_ORIGIN_KINDS, ...AWARENESS_ORIGIN_KINDS]).size ===
      MUTATION_ORIGIN_KINDS.length + PROJECTION_ORIGIN_KINDS.length + AWARENESS_ORIGIN_KINDS.length &&
    oracleOrigins.mutation.length === MUTATION_ORIGIN_KINDS.length &&
    oracleOrigins.projection.length === PROJECTION_ORIGIN_KINDS.length &&
    oracleOrigins.awareness.length === AWARENESS_ORIGIN_KINDS.length
  );
}

export function assertPlainOriginPayload(value: unknown, label: string): void {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError(`${label} contains unsafe key`);
    }
  }
}

export function originKindIsMutationOnly(value: unknown): value is MutationOrigin {
  return isPlainRecord(value) && value.domain === 'mutation' && hasExactKeys(value, expectedMutationKeys(value));
}

function expectedMutationKeys(value: Record<string, unknown>): string[] {
  if (value.kind === 'remote') {
    return ['domain', 'kind', 'actorId', 'replicaId', 'sessionId', 'updateId'];
  }
  if (value.kind === 'repair') return ['domain', 'kind', 'actorId', 'sessionId', 'repairConstituentId'];
  return ['domain', 'kind', 'actorId', 'sessionId'];
}

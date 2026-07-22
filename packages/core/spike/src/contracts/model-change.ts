/** @spike-features insert-delete-split-join-operations, origin-metadata */
import type { BrandedModelChange } from './brands';
import {
  collectValidation,
  hasUniqueStrings,
  isNonNegativeSafeInteger,
  readClosedDataObject,
  snapshotDenseArray,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId, validateSpikeIdList } from './ids';
import { snapshotAndValidateMutationOrigin, type MutationOrigin } from './origins';

export const MODEL_CHANGE_CONTRACT_VERSION = 'model-change/2';
const TRUSTED_MODEL_CHANGES = new WeakSet<object>();

export interface StructuralRange {
  readonly storyId: string;
  readonly blockId: string;
  readonly start: number;
  readonly end: number;
}

export type IdentityMappingKind = 'block' | 'paragraph' | 'mark';

export interface IdentityMapping {
  readonly kind: IdentityMappingKind;
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

export interface DirtyDependency {
  readonly dependencyKind: 'style' | 'block' | 'mark';
  readonly targetId: string;
}

export interface RepairEvidence {
  readonly repairConstituentId: string;
  readonly normalizationOwner: string;
  readonly appliedRepair: boolean;
}

export interface ModelChange extends BrandedModelChange {
  readonly version: typeof MODEL_CHANGE_CONTRACT_VERSION;
  readonly commitId: string;
  readonly constituentIds: readonly string[];
  readonly causalUpdateIds: readonly string[];
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly structuralRangesBefore: readonly StructuralRange[];
  readonly structuralRangesAfter: readonly StructuralRange[];
  readonly identityMappings: readonly IdentityMapping[];
  readonly dirtyDependencies: readonly DirtyDependency[];
  readonly origin: MutationOrigin;
  readonly normalized: boolean;
  readonly repairEvidence: RepairEvidence | null;
}

export function createModelChange(input: {
  commitId: string;
  constituentIds: readonly string[];
  causalUpdateIds: readonly string[];
  revisionBefore: number;
  revisionAfter: number;
  structuralRangesBefore: readonly StructuralRange[];
  structuralRangesAfter: readonly StructuralRange[];
  identityMappings: readonly IdentityMapping[];
  dirtyDependencies: readonly DirtyDependency[];
  origin: MutationOrigin;
  normalized: boolean;
  repairEvidence: RepairEvidence | null;
}): ModelChange {
  const change = readClosedDataObject(
    input,
    [
      'commitId',
      'constituentIds',
      'causalUpdateIds',
      'revisionBefore',
      'revisionAfter',
      'structuralRangesBefore',
      'structuralRangesAfter',
      'identityMappings',
      'dirtyDependencies',
      'origin',
      'normalized',
      'repairEvidence',
    ],
    'ModelChange factory input'
  );
  return createValidatedModelChange(change);
}

function createTrustedModelChange(input: {
  commitId: string;
  constituentIds: readonly string[];
  causalUpdateIds: readonly string[];
  revisionBefore: number;
  revisionAfter: number;
  structuralRangesBefore: readonly StructuralRange[];
  structuralRangesAfter: readonly StructuralRange[];
  identityMappings: readonly IdentityMapping[];
  dirtyDependencies: readonly DirtyDependency[];
  origin: MutationOrigin;
  normalized: boolean;
  repairEvidence: RepairEvidence | null;
}): ModelChange {
  const change = Object.freeze({
    version: MODEL_CHANGE_CONTRACT_VERSION,
    commitId: input.commitId,
    constituentIds: Object.freeze([...input.constituentIds]),
    causalUpdateIds: Object.freeze([...input.causalUpdateIds]),
    revisionBefore: input.revisionBefore,
    revisionAfter: input.revisionAfter,
    structuralRangesBefore: Object.freeze(input.structuralRangesBefore.map((range) => Object.freeze({ ...range }))),
    structuralRangesAfter: Object.freeze(input.structuralRangesAfter.map((range) => Object.freeze({ ...range }))),
    identityMappings: Object.freeze(input.identityMappings.map((mapping) => Object.freeze({ ...mapping }))),
    dirtyDependencies: Object.freeze(input.dirtyDependencies.map((dependency) => Object.freeze({ ...dependency }))),
    origin: input.origin,
    normalized: input.normalized,
    repairEvidence: input.repairEvidence ? Object.freeze({ ...input.repairEvidence }) : null,
  }) as unknown as ModelChange;
  TRUSTED_MODEL_CHANGES.add(change);
  return change;
}

export function snapshotAndValidateModelChange(input: unknown): ValidationSnapshot<ModelChange> {
  return collectValidation(validateTrustedModelChange, () => snapshotModelChange(input));
}

export function snapshotModelChange(input: unknown): ModelChange {
  const change = readClosedDataObject(
    input,
    [
      'version',
      'commitId',
      'constituentIds',
      'causalUpdateIds',
      'revisionBefore',
      'revisionAfter',
      'structuralRangesBefore',
      'structuralRangesAfter',
      'identityMappings',
      'dirtyDependencies',
      'origin',
      'normalized',
      'repairEvidence',
    ],
    'ModelChange'
  );
  if (change.version !== MODEL_CHANGE_CONTRACT_VERSION) throw new TypeError('invalid ModelChange version');
  return createValidatedModelChange(change);
}

function createValidatedModelChange(change: Record<string, unknown>): ModelChange {
  const originSnapshot = snapshotAndValidateMutationOrigin(change.origin);
  if (originSnapshot.errors.length > 0 || !originSnapshot.snapshot) {
    throw new TypeError('ModelChange requires mutation origin');
  }
  const repairEvidence =
    change.repairEvidence === null
      ? null
      : readClosedDataObject(
          change.repairEvidence,
          ['repairConstituentId', 'normalizationOwner', 'appliedRepair'],
          'repair evidence'
        );
  const trusted = createTrustedModelChange({
    commitId: change.commitId as string,
    constituentIds: snapshotDenseArray(change.constituentIds, 'constituentIds') as string[],
    causalUpdateIds: snapshotDenseArray(
      change.causalUpdateIds,
      'causalUpdateIds'
    ) as string[],
    revisionBefore: change.revisionBefore as number,
    revisionAfter: change.revisionAfter as number,
    structuralRangesBefore: snapshotStructuralRanges(change.structuralRangesBefore),
    structuralRangesAfter: snapshotStructuralRanges(change.structuralRangesAfter),
    identityMappings: snapshotIdentityMappings(change.identityMappings),
    dirtyDependencies: snapshotDirtyDependencies(change.dirtyDependencies),
    origin: originSnapshot.snapshot,
    normalized: change.normalized as boolean,
    repairEvidence:
      repairEvidence === null
        ? null
        : {
            repairConstituentId: repairEvidence.repairConstituentId as string,
            normalizationOwner: repairEvidence.normalizationOwner as string,
            appliedRepair: repairEvidence.appliedRepair as boolean,
          },
  });
  const errors = validateTrustedModelChange(trusted);
  if (errors.length > 0) throw new TypeError(`invalid ModelChange: ${errors.join('; ')}`);
  return trusted;
}

function snapshotStructuralRanges(input: unknown): StructuralRange[] {
  return snapshotDenseArray(input, 'structural ranges').map((rangeInput) => {
    const range = readClosedDataObject(
      rangeInput,
      ['storyId', 'blockId', 'start', 'end'],
      'structural range'
    );
    return {
      storyId: range.storyId as string,
      blockId: range.blockId as string,
      start: range.start as number,
      end: range.end as number,
    };
  });
}

function snapshotIdentityMappings(input: unknown): IdentityMapping[] {
  return snapshotDenseArray(input, 'identity mappings').map((mappingInput) => {
    const mapping = readClosedDataObject(
      mappingInput,
      ['kind', 'beforeId', 'afterId'],
      'identity mapping'
    );
    return {
      kind: mapping.kind as IdentityMappingKind,
      beforeId: mapping.beforeId as string | null,
      afterId: mapping.afterId as string | null,
    };
  });
}

function snapshotDirtyDependencies(input: unknown): DirtyDependency[] {
  return snapshotDenseArray(input, 'dirty dependencies').map((dependencyInput) => {
    const dependency = readClosedDataObject(
      dependencyInput,
      ['dependencyKind', 'targetId'],
      'dirty dependency'
    );
    return {
      dependencyKind: dependency.dependencyKind as DirtyDependency['dependencyKind'],
      targetId: dependency.targetId as string,
    };
  });
}

function validateTrustedModelChange(change: ModelChange): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_MODEL_CHANGES.has(change)) errors.push('untrusted ModelChange');
  if (change.version !== MODEL_CHANGE_CONTRACT_VERSION) errors.push('invalid ModelChange version');
  errors.push(
    validateSpikeId(change.commitId, 'commitId') ?? '',
    validateSpikeIdList(change.constituentIds, 'constituentIds') ?? '',
    change.causalUpdateIds.length === 0
      ? ''
      : validateSpikeIdList(change.causalUpdateIds, 'causalUpdateIds') ?? ''
  );
  if (!isNonNegativeSafeInteger(change.revisionBefore)) {
    errors.push('invalid revisionBefore');
  }
  if (!isNonNegativeSafeInteger(change.revisionAfter)) {
    errors.push('invalid revisionAfter');
  } else if (change.revisionAfter <= change.revisionBefore) {
    errors.push('revisionAfter must exceed revisionBefore');
  } else if (
    change.revisionAfter !== change.revisionBefore + 1 &&
    !(change.origin.kind === 'repair' && change.repairEvidence?.appliedRepair === true)
  ) {
    errors.push('revisionAfter must equal revisionBefore + 1');
  }
  if (typeof change.normalized !== 'boolean') errors.push('invalid normalized flag');
  errors.push(...snapshotAndValidateMutationOrigin(change.origin).errors);
  for (const range of [...change.structuralRangesBefore, ...change.structuralRangesAfter]) {
    errors.push(...validateStructuralRange(range));
  }
  for (const mapping of change.identityMappings) errors.push(...validateIdentityMapping(mapping));
  for (const dependency of change.dirtyDependencies) errors.push(...validateDirtyDependency(dependency));
  if (!hasUniqueStrings(change.constituentIds)) errors.push('duplicate constituent ID');
  if (!hasUniqueStrings(change.causalUpdateIds)) errors.push('duplicate causal update ID');
  if (
    change.causalUpdateIds.some(
      (value, index) => index > 0 && change.causalUpdateIds[index - 1]! > value
    )
  ) {
    errors.push('causal update IDs must use stable order');
  }
  const beforeRangeKeys = change.structuralRangesBefore.map(rangeKey);
  const afterRangeKeys = change.structuralRangesAfter.map(rangeKey);
  if (!hasUniqueStrings(beforeRangeKeys)) errors.push('duplicate before structural range');
  if (!hasUniqueStrings(afterRangeKeys)) errors.push('duplicate after structural range');
  const mappingKeys = change.identityMappings.map(
    (mapping) => `${mapping.kind}\u0000${mapping.beforeId}\u0000${mapping.afterId}`
  );
  if (!hasUniqueStrings(mappingKeys)) errors.push('duplicate identity mapping');
  const dirtyKeys = change.dirtyDependencies.map(
    (dependency) => `${dependency.dependencyKind}\u0000${dependency.targetId}`
  );
  if (!hasUniqueStrings(dirtyKeys)) errors.push('duplicate dirty dependency');
  const beforeBlocks = new Set(change.structuralRangesBefore.map((range) => range.blockId));
  const afterBlocks = new Set(change.structuralRangesAfter.map((range) => range.blockId));
  for (const mapping of change.identityMappings) {
    if (
      mapping.kind === 'block' &&
      ((mapping.beforeId !== null &&
        !beforeBlocks.has(mapping.beforeId) &&
        change.repairEvidence === null) ||
        (mapping.afterId !== null && !afterBlocks.has(mapping.afterId)))
    ) {
      errors.push('block identity mapping must reference before/after ranges');
    }
  }
  for (const dependency of change.dirtyDependencies) {
    if (
      dependency.dependencyKind === 'block' &&
      !beforeBlocks.has(dependency.targetId) &&
      !afterBlocks.has(dependency.targetId)
    ) {
      errors.push('dirty block must reference a structural range');
    }
  }
  if (change.repairEvidence) {
    errors.push(
      validateSpikeId(change.repairEvidence.repairConstituentId, 'repairConstituentId') ?? '',
      validateSpikeId(change.repairEvidence.normalizationOwner, 'normalizationOwner') ?? '',
      typeof change.repairEvidence.appliedRepair === 'boolean' ? '' : 'invalid appliedRepair'
    );
  }
  return errors.filter(Boolean);
}

function validateStructuralRange(range: StructuralRange): readonly string[] {
  const errors: string[] = [];
  errors.push(
    validateSpikeId(range.storyId, 'storyId') ?? '',
    validateSpikeId(range.blockId, 'blockId') ?? ''
  );
  if (!isNonNegativeSafeInteger(range.start)) errors.push('invalid range start');
  if (!isNonNegativeSafeInteger(range.end) || range.end < range.start) errors.push('invalid range end');
  return errors.filter(Boolean);
}

function validateIdentityMapping(mapping: IdentityMapping): readonly string[] {
  const errors: string[] = [];
  if (!['block', 'paragraph', 'mark'].includes(mapping.kind)) errors.push('invalid identity mapping kind');
  if (mapping.beforeId === null && mapping.afterId === null) {
    errors.push('identity mapping must have a beforeId or afterId');
  }
  if (mapping.beforeId !== null) {
    errors.push(validateSpikeId(mapping.beforeId, 'beforeId') ?? '');
  }
  if (mapping.afterId !== null) {
    errors.push(validateSpikeId(mapping.afterId, 'afterId') ?? '');
  }
  return errors.filter(Boolean);
}

function validateDirtyDependency(dependency: DirtyDependency): readonly string[] {
  const errors: string[] = [];
  if (!['style', 'block', 'mark'].includes(dependency.dependencyKind)) {
    errors.push('invalid dirty dependency kind');
  }
  errors.push(validateSpikeId(dependency.targetId, 'targetId') ?? '');
  return errors.filter(Boolean);
}

export function isModelChange(value: unknown): value is ModelChange {
  return typeof value === 'object' && value !== null && TRUSTED_MODEL_CHANGES.has(value);
}

function rangeKey(range: StructuralRange): string {
  return `${range.storyId}\u0000${range.blockId}\u0000${range.start}\u0000${range.end}`;
}

export function rejectsDocOpAsModelChange(value: unknown): boolean {
  return snapshotAndValidateModelChange(value).errors.length > 0;
}

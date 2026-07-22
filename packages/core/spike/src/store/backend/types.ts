/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
import type { DocOpSingle } from '../../contracts/doc-op';
import type {
  DirtyDependency,
  IdentityMapping,
  StructuralRange,
} from '../../contracts/model-change';
import type { SnapshotEnvelope } from '../../contracts/snapshot';
import type { DocumentModel } from '../../model/types';
import type { IdentityTombstone } from '../history/types';

export interface BackendStageInput {
  readonly ops: readonly DocOpSingle[];
  readonly constituentIds: readonly string[];
  readonly actorId?: string;
  readonly identityRestoration?: readonly IdentityTombstone[];
  readonly includeReplicationClosure?: boolean;
}

export interface BackendStagePreview {
  readonly stageToken: string;
  readonly baseRevision: number;
  readonly baseFingerprint: string;
  readonly revisionAfter: number;
  readonly stagedFingerprint: string;
}

export interface BackendStagedMutation {
  readonly preview: BackendStagePreview;
}

export type BackendStageResult =
  | { readonly status: 'staged'; readonly staged: BackendStagedMutation }
  | { readonly status: 'noOp'; readonly reason: string }
  | { readonly status: 'failed'; readonly code: string; readonly message: string };

export interface BackendCommitInput {
  readonly actorId: string;
  readonly constituentIds: readonly string[];
}

export interface BackendHistoryCommitRecord {
  readonly forwardOps: readonly DocOpSingle[];
  readonly beforeDraftSnapshot: string;
  readonly tombstones: readonly IdentityTombstone[];
  readonly appliedRepair: boolean;
}

export interface BackendCommitResult {
  readonly commitId: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly identityMappings: readonly IdentityMapping[];
  readonly structuralRangesBefore: readonly StructuralRange[];
  readonly structuralRangesAfter: readonly StructuralRange[];
  readonly dirtyDependencies: readonly DirtyDependency[];
  readonly normalized: boolean;
  readonly appliedRepair: boolean;
  readonly historyCommit: BackendHistoryCommitRecord | null;
}

export interface BackendCoverageBookkeeping {
  readonly constituentIds: ImmutableStringSet;
  readonly commitIds: ImmutableStringSet;
}

export interface ImmutableStringSet extends Iterable<string> {
  readonly size: number;
  has(value: string): boolean;
  values(): IterableIterator<string>;
}

export interface OperationEnvironmentSnapshot {
  readonly actorId: string;
  readonly nextCommitSeq: number;
  readonly nextLocalSeq: number;
  readonly reservedSemanticIds: ImmutableStringSet;
}

export interface BackendIdentity {
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
}

export interface BackendStateInspection {
  readonly identity: BackendIdentity;
  readonly revision: number;
  readonly canonicalFingerprint: string;
  readonly operationEnvironment: Readonly<{
    actorId: string;
    nextCommitSeq: number;
    nextLocalSeq: number;
    reservedSemanticIds: readonly string[];
  }>;
  readonly coverage: Readonly<{
    constituentIds: readonly string[];
    commitIds: readonly string[];
  }>;
}

export interface SemanticStoreBackend {
  readonly identity: BackendIdentity;
  readonly model: DocumentModel;
  readonly operationEnvironment: OperationEnvironmentSnapshot;
  readonly coverage: BackendCoverageBookkeeping;
  stageLocalMutation(input: BackendStageInput): BackendStageResult;
  previewStagedMutation(
    staged: BackendStagedMutation,
    input: BackendCommitInput
  ): BackendCommitResult;
  commitStagedMutation(
    staged: BackendStagedMutation,
    input: BackendCommitInput
  ): BackendCommitResult;
  rollbackStagedMutation(staged: BackendStagedMutation): void;
  encodeSnapshot(history?: import('../history/types').ActorSessionGroupHistoryState): SnapshotEnvelope;
  inspectState(): BackendStateInspection;
  hasConstituentCoverage(constituentId: string): boolean;
  hasCommitCoverage(commitId: string): boolean;
}

export interface LocalStoreBackend extends SemanticStoreBackend {
  encodeReplicationUpdate(): never;
}

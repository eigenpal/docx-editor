/**
 * Compile-time contract separation checks (typechecked via `bun run typecheck`).
 * Runtime brand guards are exercised in spike-contracts.test.ts.
 */
import type { DocOp } from '../src/contracts/doc-op';
import type { ModelChange } from '../src/contracts/model-change';
import type { ReplicationUpdateEnvelope } from '../src/contracts/replication-update';
import type { SnapshotEnvelope } from '../src/contracts/snapshot';
import type { MutationOrigin, ProjectionOrigin, AwarenessOrigin } from '../src/contracts/origins';

declare const sampleDocOp: DocOp;
declare const sampleModelChange: ModelChange;
declare const sampleReplicationUpdate: ReplicationUpdateEnvelope;
declare const sampleSnapshot: SnapshotEnvelope;
declare const sampleMutation: MutationOrigin;
declare const sampleProjection: ProjectionOrigin;
declare const sampleAwareness: AwarenessOrigin;

// Four-contract separation at compile time
type _DocOpNotModelChange = DocOp extends ModelChange ? never : true;
type _ModelChangeNotDocOp = ModelChange extends DocOp ? never : true;
type _ReplicationNotDocOp = ReplicationUpdateEnvelope extends DocOp ? never : true;
type _SnapshotNotDocOp = SnapshotEnvelope extends DocOp ? never : true;

const _compileFourContractSeparation: [
  _DocOpNotModelChange,
  _ModelChangeNotDocOp,
  _ReplicationNotDocOp,
  _SnapshotNotDocOp,
] = [true, true, true, true];

// Origin domain separation
type _MutationNotProjection = MutationOrigin extends ProjectionOrigin ? never : true;
type _ProjectionNotAwareness = ProjectionOrigin extends AwarenessOrigin ? never : true;
type _AwarenessNotMutation = AwarenessOrigin extends MutationOrigin ? never : true;

const _compileOriginSeparation: [_MutationNotProjection, _ProjectionNotAwareness, _AwarenessNotMutation] = [
  true,
  true,
  true,
];

// ModelChange origin must be mutation-only
type _ModelChangeOrigin = ModelChange['origin'];
type _OriginIsMutation = _ModelChangeOrigin extends MutationOrigin ? true : never;

const _compileModelChangeOrigin: _OriginIsMutation = true;

// Structurally matching values cannot forge nominal contracts.
// @ts-expect-error missing private nominal DocOp brand
const _forgedDocOp: DocOp = {
  version: 'doc-op/1',
  kind: 'batch',
  ops: [],
  transaction: {
    actorId: 'actor-1',
    sessionId: 'session-1',
    groupId: 'group-1',
    constituentIds: [],
  },
};

// @ts-expect-error missing private nominal replication-update brand
const _forgedUpdate: ReplicationUpdateEnvelope = {
  version: 'replication-update/2',
  documentId: 'doc-1',
  backendVersion: 'backend/1',
  schemaVersion: 'schema/1',
  checkpoint: 'checkpoint-1',
  updateId: 'update-1',
  constituentIds: ['op-1'],
  coverage: 'incremental',
  bytes: new Uint8Array(),
};

const _incrementalOnlyUpdate: ReplicationUpdateEnvelope['coverage'] = 'incremental';
// @ts-expect-error full encoded state belongs exclusively to Snapshot
const _fullReplicationCoverage: ReplicationUpdateEnvelope['coverage'] = 'full';

export const compileTimeContractChecks = {
  fourContractSeparation: _compileFourContractSeparation,
  originSeparation: _compileOriginSeparation,
  modelChangeOrigin: _compileModelChangeOrigin,
  samples: {
    sampleDocOp,
    sampleModelChange,
    sampleReplicationUpdate,
    sampleSnapshot,
    sampleMutation,
    sampleProjection,
    sampleAwareness,
  },
};

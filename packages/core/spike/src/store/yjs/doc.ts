/** @spike-features yjs-backend */
export { bootstrapYjsDocFromModel } from './doc-bootstrap';
export { deriveAuthoredPackageFromYjs } from './doc-derive';
export { decodeYjsDocState } from './doc-decode';
export {
  applyAuthoredTransition,
  cloneYjsDocState,
  mergeRemoteUpdate,
  findBlockCreationId,
} from './doc-sync';
export { repairYjsDocument, type YjsRepairResult } from './doc-repair';
export {
  checkpointFor,
  createReplicaYjsDoc,
  nextReplicaCommitSeq,
  readAllocatorRecords,
} from './doc-access';
export type {
  BootstrapContext,
  YjsAllocatorRecord,
  YjsCollisionCandidate,
  YjsDocState,
  YjsTombstone,
} from './doc-types';

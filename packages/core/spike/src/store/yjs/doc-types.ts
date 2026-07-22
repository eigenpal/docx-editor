/** @spike-features yjs-backend */
import type * as Y from 'yjs';

export type {
  AuthoredTextEditEvent,
  AuthoredTextInsertEvent,
  AuthoredTextDeleteEvent,
  SequenceAnchor,
} from './token-sequence';

/** @deprecated use AuthoredTextEditEvent */
export type AuthoredTextContribution = import('./token-sequence').AuthoredTextEditEvent;

export type YjsRecordKind = 'story' | 'block' | 'text' | 'mark' | 'capsule';

export interface YjsTombstone {
  readonly creationId: string;
  readonly semanticId: string;
  readonly proposedSemanticId: string;
  readonly actorId: string;
  readonly commitId: string;
  readonly recordKind: YjsRecordKind;
}

export interface YjsCollisionCandidate {
  readonly creationId: string;
  readonly semanticId: string;
  readonly proposedSemanticId: string;
  readonly actorId: string;
  readonly commitId: string;
}

export interface YjsAllocatorRecord {
  readonly actorId: string;
  readonly nextLocalSeq: number;
  readonly nextCommitSeq: number;
  readonly observedSemanticIds: ReadonlySet<string>;
}

export interface YjsDocState {
  readonly doc: Y.Doc;
  readonly documentId: string;
  readonly checkpoint: string;
  readonly replicaId?: string;
}

export interface BootstrapContext {
  actorId: string;
  commitSeq: number;
  localSeq: number;
  sourceClientId: number;
  observedSemanticIds: Set<string>;
}

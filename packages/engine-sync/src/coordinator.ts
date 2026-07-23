// The sole ReplicationCoordinator (document-engine task 5.3 / design D2). It is
// the ONLY bridge between the canonical DocumentStore and a replication backend:
// only it stages a backend merge, derives/normalizes canonical state, publishes
// either state, and notifies subscribers. Backends never mutate or notify
// canonical state directly. Local commits and remote merges are explicit state
// machines; stable update ids give idempotence and echo suppression.

import {
  DocumentStore,
  bodyStoryId,
  ORIGIN_IDS,
  type ModelChange,
  type ReplicationUpdate,
} from '@docx-editor.dev/engine-core';
import { YjsBackend } from './yjs-backend.ts';

export type LocalPhase = 'idle' | 'validating' | 'staging' | 'normalizing' | 'committing' | 'published' | 'rollingBack';
export type RemotePhase = 'idle' | 'authenticating' | 'deduplicating' | 'stagingMerge' | 'normalizing' | 'committing' | 'published';

export interface LocalCommit {
  readonly ok: boolean;
  readonly commitId?: string;
  readonly revision?: number;
  readonly update?: ReplicationUpdate;
  readonly modelChange?: ModelChange;
}

export interface RemoteMerge {
  readonly ok: boolean;
  /** True when the update was a duplicate/echo and did nothing. */
  readonly noop?: boolean;
  readonly revision?: number;
  readonly modelChange?: ModelChange;
}

let updateSeq = 0;

export class ReplicationCoordinator {
  private localPhase: LocalPhase = 'idle';
  private remotePhase: RemotePhase = 'idle';
  private updateCounter = 0;
  /** Update ids this coordinator produced (for echo suppression). */
  private readonly localUpdateIds = new Set<string>();
  /** Update ids already applied (for idempotence). */
  private readonly appliedUpdateIds = new Set<string>();

  constructor(
    readonly store: DocumentStore,
    private readonly backend: YjsBackend,
  ) {}

  get phases(): { local: LocalPhase; remote: RemotePhase } {
    return { local: this.localPhase, remote: this.remotePhase };
  }

  /** Local commit: stage in canonical store AND backend, then publish one update. */
  localInsertText(paragraphId: string, text: string): LocalCommit {
    this.localPhase = 'validating';
    if (!paragraphId || typeof text !== 'string') {
      this.localPhase = 'idle';
      return { ok: false };
    }
    this.localPhase = 'staging';
    // Canonical store commit (authoritative) + backend mutation (for sync).
    const commit = this.store.transact(ORIGIN_IDS.mutationHuman, (ctx) =>
      ctx.apply({ op: 'insertText', paragraphId, text }),
    );
    if (!commit.ok) {
      this.localPhase = 'rollingBack';
      this.localPhase = 'idle';
      return { ok: false };
    }
    this.backend.insertText(paragraphId, text);
    this.localPhase = 'normalizing';
    this.localPhase = 'committing';
    const updateId = `${this.backend.actorId}:u${(this.updateCounter += 1)}:${(updateSeq += 1)}`;
    const update = this.backend.encodeUpdate(updateId);
    this.localUpdateIds.add(updateId);
    this.appliedUpdateIds.add(updateId);
    this.localPhase = 'published';
    this.localPhase = 'idle';
    return { ok: true, commitId: commit.commitId, revision: commit.revision, update, modelChange: commit.modelChange };
  }

  /** Local append-paragraph commit (kept minimal; text via localInsertText). */
  localAppendParagraph(semId: string): LocalCommit {
    const storyId = bodyStoryId(this.store.currentModel);
    const commit = this.store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'appendParagraph', storyId, symbolicId: semId }));
    if (!commit.ok) return { ok: false };
    // Mirror the created id into the backend under the same semantic id.
    const created = commit.modelChange.created[0];
    this.backend.appendParagraph(storyId, created);
    const updateId = `${this.backend.actorId}:u${(this.updateCounter += 1)}:${(updateSeq += 1)}`;
    const update = this.backend.encodeUpdate(updateId);
    this.localUpdateIds.add(updateId);
    this.appliedUpdateIds.add(updateId);
    return { ok: true, commitId: commit.commitId, revision: commit.revision, update, modelChange: commit.modelChange };
  }

  /**
   * Remote merge: authenticate/dedupe the envelope, stage it into the backend,
   * derive canonical state, and publish ONE revision + ModelChange. Duplicate or
   * echoed updates are successful no-ops.
   */
  remoteMerge(update: ReplicationUpdate): RemoteMerge {
    this.remotePhase = 'authenticating';
    if (update.documentId !== this.backend.documentId) {
      this.remotePhase = 'idle';
      return { ok: false };
    }
    this.remotePhase = 'deduplicating';
    if (this.localUpdateIds.has(update.updateId) || this.appliedUpdateIds.has(update.updateId)) {
      this.remotePhase = 'idle';
      return { ok: true, noop: true }; // echo / duplicate
    }
    this.remotePhase = 'stagingMerge';
    this.backend.applyUpdate(update);
    this.appliedUpdateIds.add(update.updateId);
    this.remotePhase = 'normalizing';
    const derived = this.backend.deriveModel();
    this.remotePhase = 'committing';
    const commit = this.store.publishDerived(derived, ORIGIN_IDS.mutationRemote);
    this.remotePhase = 'published';
    this.remotePhase = 'idle';
    return { ok: true, revision: commit.revision, modelChange: commit.modelChange };
  }
}

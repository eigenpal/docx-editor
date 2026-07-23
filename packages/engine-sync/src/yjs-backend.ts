// Yjs replicated-store backend (document-engine tasks 5.2–5.4). Per ADR-S3 the
// document uses a long-lived flat collaborative sequence per story with
// collision-free CREATION identity: blocks are keyed by `${actor}:${clock}` (never
// the semantic id), and each block carries its proposed semantic id plus actor
// provenance. Concurrent semantic-id candidates stay observable until
// `deriveModel` applies deterministic, replica-agreed repair. Text/structure
// converge through Yjs CRDT types; snapshots/updates are opaque Yjs bytes.

import * as Y from 'yjs';
import {
  createEmptyModel,
  encodeModel,
  decodeModel,
  normalize,
  type PackageModel,
  type Story,
  type ParagraphRecord,
  type RunRecord,
  type SerializedModel,
  type Snapshot,
  type ReplicationUpdate,
} from '@docx-editor.dev/engine-core';
import type { ReplicatedStoreBackend } from './backend.ts';

/** Pinned Yjs schema version (task 5.2); bumped only via a reviewed migration. */
export const YJS_SCHEMA_VERSION = 1;

type YBlock = Y.Map<unknown>; // { semId: string, runs: Y.Array<Y.Map{t,p}> }

export interface YjsBackendOptions {
  /**
   * Bring-your-own `Y.Doc`. Attach any standard provider to it yourself
   * (`y-websocket`, `y-indexeddb`, a custom transport) — you are NOT required to
   * use a hosted sync service or route through this package's transport. When
   * omitted, an internal gc-enabled doc is created for the zero-config case.
   *
   * The engine's Yjs SCHEMA ADAPTER (the `blocks` / `blockOrder` / `storyOrder`
   * maps) is always applied to whichever doc is used, and is mandatory: arbitrary
   * external Yjs structures are never treated as the canonical DOCX model. Keep
   * unrelated app data in separate top-level keys on the same doc.
   */
  readonly doc?: Y.Doc;
}

export class YjsBackend implements ReplicatedStoreBackend {
  private readonly doc: Y.Doc;
  private clock = 0;
  /** Origin tag for this actor's local edits (tracked for actor-local undo). */
  private readonly localOrigin: string;
  private readonly undoManager: Y.UndoManager;

  constructor(
    readonly documentId: string,
    /** Stable actor id — makes creation ids collision-free and tests deterministic. */
    readonly actorId: string,
    opts: YjsBackendOptions = {},
  ) {
    const ownsDoc = opts.doc === undefined;
    this.doc = opts.doc ?? new Y.Doc({ gc: true });
    // Deterministic Yjs clientID from the actor id so concurrent CRDT ordering is
    // reproducible across runs (seeded convergence, task 5.10). Only stamp a doc we
    // own — a caller-supplied doc keeps the identity its provider depends on.
    if (ownsDoc) this.doc.clientID = clientIdFor(actorId);
    this.localOrigin = `local:${actorId}`;
    // Actor-scoped undo (ADR-S4 / task 4.12): the UndoManager tracks ONLY this
    // actor's local edits; remote merges and the initial seed use other origins,
    // so undo never reverts another user's or the seed's work.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope: Y.AbstractType<any>[] = [
      this.doc.getMap('blocks'),
      this.doc.getMap('blockOrder'),
      this.doc.getArray('storyOrder'),
    ];
    this.undoManager = new Y.UndoManager(scope, { trackedOrigins: new Set([this.localOrigin]) });
  }

  /** Undo this actor's last local edit group (returns false if nothing to undo). */
  undo(): boolean {
    return this.undoManager.undo() !== null;
  }
  /** Redo this actor's last undone edit group. */
  redo(): boolean {
    return this.undoManager.redo() !== null;
  }
  get canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  /** Seed a backend from an authored model (static parts live in `meta`). Pass
   *  `opts.doc` to seed the adapter onto your own provider-attached Y.Doc. */
  static fromModel(documentId: string, actorId: string, model: PackageModel, opts: YjsBackendOptions = {}): YjsBackend {
    const backend = new YjsBackend(documentId, actorId, opts);
    backend.doc.transact(() => {
      backend.meta().set('schemaVersion', String(YJS_SCHEMA_VERSION));
      // (seed origin below is untracked so the initial content is never undoable)
      backend.meta().set('model', JSON.stringify(encodeModel(stripStories(model))));
      for (const story of model.stories.values()) {
        backend.storyKind().set(story.id, story.kind);
        backend.storyOrder().push([story.id]);
        const order = new Y.Array<string>();
        backend.blockOrder().set(story.id, order);
        for (const block of story.blocks) backend.appendBlockInternal(story.id, block as ParagraphRecord);
      }
    }, 'init');
    return backend;
  }

  static empty(documentId: string, actorId: string, opts: YjsBackendOptions = {}): YjsBackend {
    return YjsBackend.fromModel(documentId, actorId, createEmptyModel(), opts);
  }

  /**
   * Attach to a Y.Doc that ALREADY carries the adapter state — e.g. one a standard
   * provider (`y-websocket`, `y-indexeddb`) has already synced from a peer. The
   * doc is not re-seeded; the engine simply reads the existing schema keys.
   */
  static attach(documentId: string, actorId: string, doc: Y.Doc): YjsBackend {
    return new YjsBackend(documentId, actorId, { doc });
  }

  /** Join an existing document by applying a peer's snapshot (shared base state). */
  static join(documentId: string, actorId: string, snapshot: Snapshot, opts: YjsBackendOptions = {}): YjsBackend {
    const backend = new YjsBackend(documentId, actorId, opts);
    Y.applyUpdate(backend.doc, hexToBytes(snapshot.bytesHex), 'remote');
    return backend;
  }

  // --- semantic mutations (staged as Yjs edits) ---

  appendParagraph(storyId: string, semId: string): void {
    this.doc.transact(() => {
      this.appendBlockInternal(storyId, { kind: 'paragraph', id: semId, runs: [] });
    }, this.localOrigin);
  }

  insertText(blockSemId: string, text: string, props?: RunRecord['props']): void {
    this.doc.transact(() => {
      const block = this.findBlockBySemId(blockSemId);
      if (!block) return;
      const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
      const run = new Y.Map<unknown>();
      run.set('t', text);
      if (props) run.set('p', JSON.stringify(props));
      runs.push([run]);
    }, this.localOrigin);
  }

  // --- backend contract ---

  snapshot(): Snapshot {
    return {
      envelope: 'snapshot',
      protocolVersion: 1,
      documentId: this.documentId,
      revision: 0,
      bytesHex: bytesToHex(Y.encodeStateAsUpdate(this.doc)),
    };
  }

  encodeUpdate(updateId: string): ReplicationUpdate {
    return {
      envelope: 'update',
      protocolVersion: 1,
      documentId: this.documentId,
      updateId,
      bytesHex: bytesToHex(Y.encodeStateAsUpdate(this.doc)),
    };
  }

  /** Apply an opaque Yjs update from a peer (merges via CRDT). */
  applyUpdate(update: ReplicationUpdate): void {
    if (update.documentId !== this.documentId) throw new Error('update belongs to another document');
    Y.applyUpdate(this.doc, hexToBytes(update.bytesHex), 'remote');
  }

  decodeUpdate(update: ReplicationUpdate): { model: SerializedModel; revision: number } {
    this.applyUpdate(update);
    return { model: encodeModel(this.deriveModel()), revision: 0 };
  }

  // --- derive canonical model with deterministic semantic-id repair ---

  deriveModel(): PackageModel {
    const base = JSON.parse(this.meta().get('model') as string) as SerializedModel;
    const model = decodeModel(base);
    const stories = new Map<string, Story>();
    const usedSemIds = new Set<string>();

    for (const storyId of this.storyOrder().toArray()) {
      const kind = (this.storyKind().get(storyId) as Story['kind']) ?? 'body';
      const order = this.blockOrder().get(storyId) as Y.Array<string> | undefined;
      const creationIds = order ? order.toArray() : [];
      // Deterministic order for repair: story order, then creation id as tiebreak.
      const blocks: ParagraphRecord[] = [];
      for (const creationId of creationIds) {
        const yblock = (this.doc.getMap('blocks') as Y.Map<YBlock>).get(creationId);
        if (!yblock) continue;
        let semId = yblock.get('semId') as string;
        if (usedSemIds.has(semId)) semId = `${semId}~${creationId}`; // replica-agreed repair
        usedSemIds.add(semId);
        const runsArr = yblock.get('runs') as Y.Array<Y.Map<unknown>>;
        const runs: RunRecord[] = runsArr.toArray().map((r) => {
          const t = r.get('t') as string;
          const p = r.get('p') as string | undefined;
          return p ? { text: t, props: JSON.parse(p) } : { text: t };
        });
        blocks.push({ kind: 'paragraph', id: semId, runs });
      }
      stories.set(storyId, { id: storyId, kind, blocks });
    }
    return normalize({ ...model, stories });
  }

  // --- internals ---

  private meta() {
    return this.doc.getMap('meta') as Y.Map<string>;
  }
  private storyOrder() {
    return this.doc.getArray('storyOrder') as Y.Array<string>;
  }
  private storyKind() {
    return this.doc.getMap('storyKind') as Y.Map<string>;
  }
  private blockOrder() {
    return this.doc.getMap('blockOrder') as Y.Map<Y.Array<string>>;
  }

  private nextCreationId(): string {
    this.clock += 1;
    return `${this.actorId}:${this.clock}`;
  }

  private appendBlockInternal(storyId: string, block: ParagraphRecord): void {
    const creationId = this.nextCreationId();
    const yblock = new Y.Map<unknown>();
    yblock.set('semId', block.id);
    const runs = new Y.Array<Y.Map<unknown>>();
    for (const r of block.runs) {
      const yr = new Y.Map<unknown>();
      yr.set('t', r.text);
      if (r.props) yr.set('p', JSON.stringify(r.props));
      runs.push([yr]);
    }
    yblock.set('runs', runs);
    (this.doc.getMap('blocks') as Y.Map<YBlock>).set(creationId, yblock);
    let order = this.blockOrder().get(storyId);
    if (!order) {
      order = new Y.Array<string>();
      this.blockOrder().set(storyId, order);
    }
    order.push([creationId]);
  }

  private findBlockBySemId(semId: string): YBlock | undefined {
    const blocks = this.doc.getMap('blocks') as Y.Map<YBlock>;
    for (const yblock of blocks.values()) {
      if ((yblock.get('semId') as string) === semId) return yblock;
    }
    return undefined;
  }
}

/** Drop stories from a model for the static `meta` payload (stories live in Yjs). */
function stripStories(model: PackageModel): PackageModel {
  return { ...model, stories: new Map() };
}

/** Deterministic, collision-resistant Yjs clientID from an actor id (FNV-1a). */
function clientIdFor(actorId: string): number {
  let h = 2166136261;
  for (let i = 0; i < actorId.length; i++) {
    h ^= actorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}

// Opaque Yjs bytes <-> hex (direct byte encoding; never a text codec).
function bytesToHex(bytes: Uint8Array): string {
  let h = '';
  for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, '0');
  return h;
}
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

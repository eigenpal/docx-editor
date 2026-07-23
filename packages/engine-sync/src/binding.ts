// Optional Yjs binding (document-engine task 5.3 / ADR-S10). Bridges an
// EXTERNALLY-OWNED Y.Doc to the canonical DocumentStore. There is no public
// coordinator: the store is the sole authority, and this binding is a thin,
// origin-driven adapter.
//
//   - Remote: it subscribes to the Y.Doc's own update events (so a standard
//     provider — y-websocket / y-indexeddb / custom — that mutates the doc directly
//     is seen), and on a non-local origin publishes the backend-derived model into
//     the store as ONE atomic revision via publishDerived. Yjs is the merge
//     authority; remote command intent is never reconstructed from opaque bytes.
//   - Local: it subscribes to committed ModelChanges and mirrors local canonical
//     commits back into the Y.Doc under the backend's local transaction origin.
//
// Echo suppression is by Yjs transaction origin, not an application-level id set
// (Yjs merges are already idempotent). engine-core runs fully without this binding;
// a non-collaborative build never loads it. Full collaborative-editing parity
// (selection/IME/relative-position, fine-grained text CRDT, cross-story repair) is
// deferred — this is the thin baseline.

import { DocumentStore, ORIGIN_IDS } from '@docx-editor.dev/engine-core';
import { YjsBackend, assertYjsCompatibleModel } from './yjs-backend.ts';

export class YjsBinding {
  private offs: (() => void)[] = [];

  constructor(
    readonly store: DocumentStore,
    private readonly backend: YjsBackend,
  ) {}

  /** Whether the binding is currently wired. */
  get connected(): boolean {
    return this.offs.length > 0;
  }

  /**
   * Wire both directions. Assumes the store and backend already start consistent
   * (e.g. the backend was seeded from the store's model, or the store was published
   * from `backend.deriveModel()`). Returns a disconnect function.
   */
  connect(): () => void {
    if (this.connected) return () => this.disconnect();

    // Reject connection UP FRONT if the document holds content the adapter cannot
    // represent (tables). This prevents (a) a remote update deriving a paragraph-only
    // model that silently drops existing tables, and (b) a local commit succeeding and
    // then the mirror throwing, leaving store and Y.Doc divergent (ADR-S10).
    assertYjsCompatibleModel(this.store.currentModel);

    // Remote -> store: a provider or peer mutated the external Y.Doc.
    const offDoc = this.backend.onUpdate((origin) => {
      if (this.backend.isLocalDocOrigin(origin)) return; // our own mirror echo
      const derived = this.backend.deriveModel();
      assertYjsCompatibleModel(derived); // never publish a model that dropped content
      this.store.publishDerived(derived, ORIGIN_IDS.mutationRemote);
    });

    // Local -> Y.Doc: a canonical commit from a local writer (human/agent/undo/
    // projection). A remote-derived commit already came FROM Yjs, so skip it.
    const offStore = this.store.subscribe((mc) => {
      if (mc.origin === ORIGIN_IDS.mutationRemote) return;
      this.backend.syncFromModel(this.store.currentModel);
    });

    // Local semantic undo is unsafe under replication: an undo rewinds to a
    // pre-merge snapshot that, mirrored back into the Y.Doc, would clobber a
    // converged remote merge. Suspend it while connected; collaborative undo via the
    // backend's actor-scoped Y.UndoManager is a separate, deferred path (ADR-S10).
    this.store.suspendHistory();

    this.offs = [offDoc, offStore];
    return () => this.disconnect();
  }

  disconnect(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.store.resumeHistory();
  }
}

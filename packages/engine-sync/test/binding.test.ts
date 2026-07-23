// YjsBinding tests (document-engine task 5.3 / ADR-S10). The thin, optional binding
// bridges an externally-owned Y.Doc to the canonical DocumentStore: remote Y.Doc
// changes publish ONE derived revision; local commits mirror into the doc; echoes
// are suppressed by Yjs transaction origin; and the store stays the sole authority.

import { describe, expect, test } from 'bun:test';
import { YjsBackend, YjsBinding } from '../src/index.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  ORIGIN_IDS,
  type DocumentStore as Store,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const P1 = 'p-1';

function bodyText(store: Store): string {
  const model = store.currentModel;
  return model.stories
    .get(bodyStoryId(model))!
    .blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))
    .join('|');
}

/** A store + a Yjs backend seeded from that store's model + a connected binding. */
function connectedPeer(actor: string): { store: DocumentStore; backend: YjsBackend; binding: YjsBinding } {
  const store = new DocumentStore(createEmptyModel());
  const backend = YjsBackend.fromModel('doc', actor, store.currentModel);
  const binding = new YjsBinding(store, backend);
  binding.connect();
  return { store, backend, binding };
}

describe('remote -> store (subscription-driven)', () => {
  test('a peer update applied to the doc publishes one derived canonical revision', () => {
    const { store, backend } = connectedPeer('A');
    expect(bodyText(store)).toBe(''); // empty seed paragraph
    const before = store.currentRevision;

    // A peer edits its own replica and ships an opaque update; applying it to our
    // backend's doc fires the doc-update path (origin != local) -> publishDerived.
    const peer = YjsBackend.join('doc', 'B', backend.snapshot());
    peer.insertText(P1, 'from a provider');
    backend.applyUpdate(peer.encodeUpdate('u1'));

    expect(bodyText(store)).toBe('from a provider');
    expect(store.currentRevision).toBe(before + 1); // exactly one revision
  });
});

describe('local -> Y.Doc (mirrored under local origin)', () => {
  test('a local canonical commit is mirrored into the doc', () => {
    const { store, backend } = connectedPeer('A');
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'insertText', paragraphId: P1, text: 'typed locally' }));

    // The backend's derived model (read from its doc) reflects the local edit.
    const derived = backend.deriveModel();
    const p = derived.stories.get(bodyStoryId(derived))!.blocks[0] as ParagraphRecord;
    expect(p.runs.map((r) => r.text).join('')).toBe('typed locally');
  });

  test('mirroring does NOT publish a second revision (echo suppressed by origin)', () => {
    const { store } = connectedPeer('A');
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'insertText', paragraphId: P1, text: 'x' }));
    // One human commit = revision 1. The mirror writes the doc under the local
    // origin, which the binding ignores — so no second (remote-derived) revision.
    expect(store.currentRevision).toBe(1);
  });

  test('an appended paragraph is mirrored with order preserved', () => {
    const { store, backend } = connectedPeer('A');
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: P1, text: 'one' });
      ctx.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel), symbolicId: '$p2' });
    });
    const derived = backend.deriveModel();
    const ids = derived.stories.get(bodyStoryId(derived))!.blocks.map((b) => (b as ParagraphRecord).id);
    expect(ids[0]).toBe(P1);
    expect(ids.length).toBe(2);
  });
});

describe('two peers converge through the binding', () => {
  test('a local edit on A reaches B and both agree', () => {
    const a = connectedPeer('A');
    // B joins A's shared base state and connects its own binding.
    const storeB = new DocumentStore(createEmptyModel());
    const backendB = YjsBackend.join('doc', 'B', a.backend.snapshot());
    const bindingB = new YjsBinding(storeB, backendB);
    bindingB.connect();
    // Publish B's starting derived state so its store matches the shared base.
    storeB.publishDerived(backendB.deriveModel(), ORIGIN_IDS.mutationRemote);

    // A edits locally; its mirror updates A's doc. Ship A's update to B.
    a.store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'insertText', paragraphId: P1, text: 'hello B' }));
    backendB.applyUpdate(a.backend.encodeUpdate('uA'));

    expect(bodyText(storeB)).toBe('hello B');
    expect(bodyText(a.store)).toBe('hello B');
  });
});

describe('disconnect stops bridging', () => {
  test('after disconnect, a remote update no longer publishes', () => {
    const { store, backend, binding } = connectedPeer('A');
    binding.disconnect();
    const before = store.currentRevision;
    const peer = YjsBackend.join('doc', 'B', backend.snapshot());
    peer.insertText(P1, 'ignored');
    backend.applyUpdate(peer.encodeUpdate('u1'));
    expect(store.currentRevision).toBe(before); // nothing published
  });
});

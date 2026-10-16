/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review queue's grouping in a collaboration room. Each replica derives its queue from the
// shared tree: a property change that changes nothing is not listed, consecutive paragraphs
// with one paragraph-property change are one decision, and edits joined through a tracked
// paragraph mark are one decision whatever their dates. Both replicas list the same queue
// through concurrent edits in either client order, single and bulk decisions, undo, redo, and
// save and reopen.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const FIRST = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';
const LATER = 'w:author="Ada" w:date="2026-05-01T10:00:00Z"';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const aligned = (id: number, stamp: string, value: string, text: string) =>
  `<w:p><w:pPr><w:jc w:val="${value}"/><w:pPrChange w:id="${id}" ${stamp}><w:pPr/></w:pPrChange></w:pPr>${run(text)}</w:p>`;
const BODY =
  // A change to the default alignment: nothing to review.
  aligned(1, FIRST, 'left', 'Plain clause') +
  // One alignment change over two paragraphs.
  aligned(2, FIRST, 'center', 'Centered one') +
  aligned(3, LATER, 'center', 'Centered two') +
  // One insertion through an inserted paragraph mark, months apart.
  `<w:p><w:pPr><w:rPr><w:ins w:id="4" ${FIRST}/></w:rPr></w:pPr>${run('Kept ')}<w:ins w:id="5" ${FIRST}>${run('added')}</w:ins></w:p>` +
  `<w:p><w:ins w:id="6" ${LATER}>${run('more')}</w:ins>${run(' text')}</w:p>`;

const ORDERS = { 'Alice first': { alice: 1, bob: 2 }, 'Bob first': { alice: 2, bob: 1 } };
type Order = keyof typeof ORDERS;

const queue = (editor: DocxEditorInstance) =>
  editor
    .getReviewItems({ pairReplacements: false, placement: false })
    .filter((entry) => entry.item.kind !== 'comment');
const kinds = (editor: DocxEditorInstance) =>
  queue(editor).map((entry) => (entry.item.kind === 'revision' ? entry.item.revisionKind : ''));

async function room(order: Order) {
  const harness = createPeerHarness('review-grouping', { offlineEditing: true }, ORDERS[order]);
  const pair = await harness.pair(zipDocument(BODY));
  const mount = (peer: Peer, author: string) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      author,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      peer,
      editor,
      close() {
        editor.destroy();
        container.remove();
      },
    };
  };
  const peers = [mount(pair.alice, 'Alice'), mount(pair.bob, 'Bob')] as const;
  const sync = () => {
    for (const { peer } of peers) peer.room.session.flushPendingJournals();
  };
  return {
    peers,
    sync,
    /** Alice and Bob act while disconnected, then reconnect. */
    concurrently(alice: () => void, bob: () => void) {
      pair.pause();
      alice();
      bob();
      sync();
      pair.resume();
      sync();
    },
    close() {
      for (const peer of peers) peer.close();
      harness.cleanup();
    },
  };
}
type Room = Awaited<ReturnType<typeof room>>;

async function savedXml(editor: DocxEditorInstance): Promise<string> {
  const loaded = readOoxmlPackage(new Uint8Array(await editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** Both replicas hold one tree and list one queue. Answers that queue's kinds. */
async function converged(r: Room): Promise<string[]> {
  const [alice, bob] = r.peers;
  for (const { peer } of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  expect(await savedXml(alice.editor)).toBe(await savedXml(bob.editor));
  expect(queue(alice.editor).map((entry) => entry.key)).toEqual(
    queue(bob.editor).map((entry) => entry.key)
  );
  return kinds(alice.editor);
}

/** The queue a fresh editor lists for `editor`'s saved bytes. */
async function reopened(editor: DocxEditorInstance): Promise<string[]> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fresh = createDocxEditor({
    container,
    document: new Uint8Array(await editor.save()),
    modules: [reviewModule()],
  });
  try {
    return kinds(fresh);
  } finally {
    fresh.destroy();
    container.remove();
  }
}

const typeAt = (editor: DocxEditorInstance, index: number, offset: number, text: string) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  const at = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: at, head: at });
  expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
};
const keyOf = (editor: DocxEditorInstance, kind: string) =>
  queue(editor).find((entry) => entry.item.kind === 'revision' && entry.item.revisionKind === kind)!
    .key;

for (const order of Object.keys(ORDERS) as Order[]) {
  test(`${order}: both replicas list one format and one insertion decision`, async () => {
    const r = await room(order);
    try {
      expect(await converged(r)).toEqual(['format', 'insert']);
      expect(await reopened(r.peers[1].editor)).toEqual(['format', 'insert']);
    } finally {
      r.close();
    }
  });

  test(`${order}: accepting the joined format decision while the other types converges`, async () => {
    const r = await room(order);
    try {
      const [alice, bob] = r.peers;
      r.concurrently(
        () => typeAt(alice.editor, 0, 5, 'new '),
        () => expect(bob.editor.acceptReviewItem(keyOf(bob.editor, 'format')).ok).toBe(true)
      );
      expect(await converged(r)).toEqual(['insert']);
      expect(await savedXml(alice.editor)).toContain('pPrChange');
      expect(await reopened(alice.editor)).toEqual(['insert']);
    } finally {
      r.close();
    }
  });

  test(`${order}: rejecting the joined insertion while the other types after it converges`, async () => {
    const r = await room(order);
    try {
      const [alice, bob] = r.peers;
      r.concurrently(
        () => expect(alice.editor.rejectReviewItem(keyOf(alice.editor, 'insert')).ok).toBe(true),
        () => typeAt(bob.editor, 2, 0, 'Note ')
      );
      expect(await converged(r)).toEqual(['format']);
    } finally {
      r.close();
    }
  });

  test(`${order}: accept all clears the unlisted record on both replicas, with undo and redo`, async () => {
    const r = await room(order);
    try {
      const [alice, bob] = r.peers;
      r.concurrently(
        () =>
          expect(alice.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(
            true
          ),
        () => typeAt(bob.editor, 1, 0, 'Also ')
      );
      expect(await converged(r)).toEqual([]);
      expect(await savedXml(bob.editor)).not.toContain('pPrChange');
      expect(await reopened(bob.editor)).toEqual([]);
      expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual(['format', 'insert']);
      expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual([]);
    } finally {
      r.close();
    }
  });
}

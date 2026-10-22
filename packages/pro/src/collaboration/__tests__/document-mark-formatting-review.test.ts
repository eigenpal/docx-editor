/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One formatting decision over text and its paragraph mark, a formatting change inside another
// author's insertion, and table property history, in a collaboration room. Both replicas list
// the same queue and converge through concurrent edits, deletion, undo, redo, and reopen.
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

const STAMP = 'w:date="2026-10-21T13:32:00Z"';
const BOLD = '<w:b/><w:bCs/>';
const change = (id: number, author = 'Ada') =>
  `<w:rPrChange w:id="${id}" w:author="${author}" ${STAMP}><w:rPr/></w:rPrChange>`;
const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const BODY =
  // Bold on the text and on its mark: one decision.
  `<w:p><w:pPr><w:rPr>${BOLD}${change(1)}</w:rPr></w:pPr>${run('Hello', BOLD + change(2))}</w:p>` +
  // Formatting on text inside another author's insertion.
  `<w:p>${run('Keep ')}<w:ins w:id="3" w:author="Grace" ${STAMP}>${run('added', BOLD + change(4))}</w:ins></w:p>` +
  // Table property history with no card.
  '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:jc w:val="center"/>' +
  `<w:tblPrChange w:id="5" w:author="Ada" ${STAMP}><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr></w:tblPrChange>` +
  `</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>` +
  `<w:p>${run('Tail')}</w:p>`;

const ORDERS = { 'Alice first': { alice: 1, bob: 2 }, 'Bob first': { alice: 2, bob: 1 } };
type Order = keyof typeof ORDERS;

const queue = (editor: DocxEditorInstance) =>
  editor
    .getReviewItems({ pairReplacements: false, placement: false })
    .filter((entry) => entry.item.kind !== 'comment');
const kinds = (editor: DocxEditorInstance) =>
  queue(editor).map((entry) => (entry.item.kind === 'revision' ? entry.item.revisionKind : ''));

async function room(order: Order, body = BODY) {
  const harness = createPeerHarness(
    'mark-formatting-review',
    { offlineEditing: true },
    ORDERS[order]
  );
  const pair = await harness.pair(zipDocument(body));
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

async function converged(r: Room): Promise<string[]> {
  const [alice, bob] = r.peers;
  for (const { peer } of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  expect(await savedXml(alice.editor)).toBe(await savedXml(bob.editor));
  expect(queue(alice.editor).map((entry) => entry.key)).toEqual(
    queue(bob.editor).map((entry) => entry.key)
  );
  return kinds(alice.editor);
}

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

const caretAt = (editor: DocxEditorInstance, index: number, offset: number) => {
  const paragraphId = editor.surface!.session.paragraphIds().at(index)!;
  const at = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: at, head: at });
};
const typeAt = (editor: DocxEditorInstance, index: number, offset: number, text: string) => {
  caretAt(editor, index, offset);
  expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
};
const formatKeys = (editor: DocxEditorInstance) =>
  queue(editor)
    .filter((entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'format')
    .map((entry) => entry.key);

for (const order of Object.keys(ORDERS) as Order[]) {
  test(`${order}: both replicas list one decision for the text and its mark`, async () => {
    const r = await room(order);
    try {
      expect(await converged(r)).toEqual(['format', 'insert', 'format']);
      expect(await reopened(r.peers[1].editor)).toEqual(['format', 'insert', 'format']);
    } finally {
      r.close();
    }
  });

  test(`${order}: one accept of the joined decision while the other types converges`, async () => {
    const r = await room(order);
    try {
      const [alice, bob] = r.peers;
      r.concurrently(
        () => typeAt(alice.editor, 0, 5, ' there'),
        () => expect(bob.editor.acceptReviewItem(formatKeys(bob.editor)[0]!).ok).toBe(true)
      );
      expect(await converged(r)).toEqual(['insert', 'format']);
      expect(await reopened(alice.editor)).toEqual(['insert', 'format']);
      expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual(['format', 'insert', 'format']);
      expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual(['insert', 'format']);
    } finally {
      r.close();
    }
  });

  for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const)
    test(`${order}: ${command} on formatting inside an insertion while the other deletes beside it`, async () => {
      const r = await room(order);
      try {
        const [alice, bob] = r.peers;
        r.concurrently(
          () => expect(alice.editor[command](formatKeys(alice.editor)[1]!).ok).toBe(true),
          () => {
            const paragraphId = bob.editor.surface!.session.paragraphIds()[1]!;
            bob.editor.surface!.setSelection({
              anchor: { paragraphId, offset: 0 },
              head: { paragraphId, offset: 4 },
            });
            expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
          }
        );
        expect(await converged(r)).toEqual(['format', 'insert']);
      } finally {
        r.close();
      }
    });

  test(`${order}: accept all clears table history on both replicas, with undo and redo`, async () => {
    const r = await room(order);
    try {
      const [alice, bob] = r.peers;
      r.concurrently(
        () =>
          expect(alice.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(
            true
          ),
        () => typeAt(bob.editor, 3, 0, 'More ')
      );
      expect(await converged(r)).toEqual([]);
      expect(await savedXml(bob.editor)).not.toMatch(/rPrChange|tblPrChange/);
      expect(await reopened(bob.editor)).toEqual([]);
      expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual(['format', 'insert', 'format']);
      expect(await savedXml(alice.editor)).toContain('tblPrChange');
      expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
      r.sync();
      expect(await converged(r)).toEqual([]);
    } finally {
      r.close();
    }
  });
}

// A deleted row that holds another author's insertion, and a vertical merge in two halves.
const del = (id: number, text: string) =>
  `<w:p><w:pPr><w:rPr><w:del w:id="${id}" w:author="Ada" ${STAMP}/></w:rPr></w:pPr><w:del w:id="${id + 1}" w:author="Ada" ${STAMP}><w:r><w:delText>${text}</w:delText></w:r></w:del></w:p>`;
const cell = (content: string, properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${properties}</w:tcPr>${content}</w:tc>`;
const TABLES =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr>${cell(`<w:p>${run('a')}</w:p>`)}${cell(`<w:p>${run('b')}</w:p>`)}</w:tr>` +
  `<w:tr><w:trPr><w:del w:id="20" w:author="Ada" ${STAMP}/></w:trPr>${cell(del(21, 'd1'))}` +
  cell(
    `<w:p><w:pPr><w:rPr><w:del w:id="23" w:author="Ada" ${STAMP}/></w:rPr></w:pPr><w:ins w:id="24" w:author="Grace" ${STAMP}>${run('new')}</w:ins></w:p>`
  ) +
  '</w:tr></w:tbl>' +
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr>${cell(`<w:p>${run('top')}</w:p>`, `<w:cellMerge w:id="30" w:author="Ada" ${STAMP} w:vMerge="rest"/>`)}${cell(`<w:p>${run('c')}</w:p>`)}</w:tr>` +
  `<w:tr>${cell(`<w:p>${run('below')}</w:p>`, `<w:cellMerge w:id="31" w:author="Ada" ${STAMP} w:vMerge="cont"/>`)}${cell(`<w:p>${run('d')}</w:p>`)}</w:tr>` +
  `</w:tbl><w:p>${run('Tail')}</w:p>`;
const structuralKeys = (editor: DocxEditorInstance) =>
  queue(editor)
    .filter((entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'structural')
    .map((entry) => entry.key);

for (const order of Object.keys(ORDERS) as Order[]) {
  test(`${order}: accepting a deleted row with another author's insertion while the other types`, async () => {
    const r = await room(order, TABLES);
    try {
      const [alice, bob] = r.peers;
      const before = kinds(alice.editor).length;
      r.concurrently(
        () => expect(alice.editor.acceptReviewItem(structuralKeys(alice.editor)[0]!).ok).toBe(true),
        () => typeAt(bob.editor, -1, 0, 'More ')
      );
      const after = await converged(r);
      expect(after.length).toBeLessThan(before);
      expect(await savedXml(bob.editor)).not.toMatch(/d1|>new</);
      expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect((await converged(r)).length).toBe(before);
    } finally {
      r.close();
    }
  });

  test(`${order}: one decision on a merge half resolves the merge on both replicas`, async () => {
    const r = await room(order, TABLES);
    try {
      const [alice] = r.peers;
      const merge = structuralKeys(alice.editor).at(-1)!;
      expect(alice.editor.rejectReviewItem(merge).ok).toBe(true);
      r.sync();
      expect(await savedXml(alice.editor)).not.toContain('cellMerge');
      await converged(r);
      expect(await reopened(alice.editor)).toEqual(kinds(alice.editor));
    } finally {
      r.close();
    }
  });
}

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked change in a text box, decided in a collaboration room while the other participant
// types beside the box. Both replicas drop the decided change from the review items and converge
// through undo, redo, and reopen.
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

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STAMP = 'w:date="2026-11-04T00:00:00Z"';
// An anchored DrawingML text box whose paragraph holds one tracked insertion.
const BODY =
  '<w:p><w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="800000"/>' +
  '<wp:wrapNone/><wp:docPr id="1" name="Box"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>' +
  `<wps:txbx><w:txbxContent xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">In box </w:t></w:r>` +
  `<w:ins w:id="7" w:author="Ada" ${STAMP}><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:txbxContent></wps:txbx>` +
  '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>' +
  '<w:r><w:t>Host</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p>';

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
    'textbox-review-decisions',
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

const typeAt = (editor: DocxEditorInstance, index: number, offset: number, text: string) => {
  const paragraphId = editor.surface!.session.paragraphIds().at(index)!;
  const at = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: at, head: at });
  expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
};

for (const order of Object.keys(ORDERS) as Order[]) {
  for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const) {
    test(`${order}: ${command} in a text box while the other types beside it`, async () => {
      const r = await room(order);
      try {
        const [alice, bob] = r.peers;
        expect(await converged(r)).toEqual(['insert']);
        const key = queue(alice.editor)[0]!.key;
        r.concurrently(
          () => expect(alice.editor[command](key).ok).toBe(true),
          () => typeAt(bob.editor, 0, 4, ' text')
        );
        expect(await converged(r)).toEqual([]);
        expect(await reopened(bob.editor)).toEqual([]);
        expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        expect(await converged(r)).toEqual(['insert']);
        expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
        r.sync();
        expect(await converged(r)).toEqual([]);
      } finally {
        r.close();
      }
    });
  }
}

// The other participant deletes text in the decided box's own paragraph at the same time.
for (const order of Object.keys(ORDERS) as Order[]) {
  for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const) {
    test(`${order}: ${command} in a text box while the other deletes text in the box`, async () => {
      const r = await room(order);
      try {
        const [alice, bob] = r.peers;
        const [entry] = queue(alice.editor);
        const boxParagraphId =
          entry!.item.kind === 'revision' ? entry!.item.ranges[0]!.start.paragraphId : '';
        r.concurrently(
          () => expect(alice.editor[command](entry!.key).ok).toBe(true),
          () => {
            bob.editor.surface!.setSelection({
              anchor: { paragraphId: boxParagraphId, offset: 0 },
              head: { paragraphId: boxParagraphId, offset: 3 },
            });
            expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
          }
        );
        expect(await converged(r)).toEqual([]);
        expect(await reopened(alice.editor)).toEqual([]);
        expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        expect(await converged(r)).toEqual(['insert']);
        expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
        r.sync();
        expect(await converged(r)).toEqual([]);
      } finally {
        r.close();
      }
    });
  }
}

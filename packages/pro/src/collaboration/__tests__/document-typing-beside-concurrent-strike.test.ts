/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One participant types inside a run while another deletes the run, outright or as a tracked
// deletion. The typing keeps its order: the characters typed before the deletion arrived stay
// out of a strike their author never saw, and the caret stays after them, so the characters
// typed afterwards continue them. A tracked deletion used to strike the first characters and
// send the rest past the strike, so " (or sixty)" read "or sixty) (".
import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, nodeText, walk, zipDocument } from './document-peer-support.ts';
import { loadPackage, packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('typing-beside-concurrent-strike', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">One </w:t></w:r>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Two and more </w:t></w:r>' +
  '<w:r><w:t>Three</w:t></w:r></w:p><w:sectPr/>';
const TYPED = ' (or sixty)';
/** Where the caret starts: inside the bold run, after "Two ". */
const CARET = 8;

async function room() {
  const peers = await harness.pair(zipDocument(BODY));
  const [alice, bob] = (['Alice', 'Bob'] as const).map((author) => {
    const peer = author === 'Alice' ? peers.alice : peers.bob;
    peer.detach();
    const editor = createDocxEditor({
      author,
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    editor.on('change', () => editor.snapshot());
    return editor;
  }) as [Editor, Editor];
  const deliver = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const paragraphId = alice.findMatches('One')[0]!.blockId;
  const text = (editor: Editor) => {
    editor.surface!.layout();
    return paragraphTextOf(editor.surface!.session.part(), paragraphId) ?? '';
  };
  return { ...peers, aliceEditor: alice, bobEditor: bob, deliver, paragraphId, text };
}

type Mode = 'deletes' | 'proposes deleting';

for (const mode of ['deletes', 'proposes deleting'] as const satisfies readonly Mode[])
  describe(`one participant types in a run another ${mode}`, () => {
    for (const before of [0, 1, 2])
      test(`${before} characters typed before the deletion arrives keep their order`, async () => {
        const r = await room();
        if (mode === 'proposes deleting') {
          expect(r.aliceEditor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
        }
        const caret = { paragraphId: r.paragraphId, offset: CARET };
        r.bobEditor.surface!.setSelection({ anchor: caret, head: caret });
        r.pause();
        for (const character of TYPED.slice(0, before)) {
          expect(r.bobEditor.exec({ type: 'insertText', text: character }).ok).toBe(true);
        }
        // Alice deletes the bold run as she sees it, without Bob's characters.
        r.aliceEditor.surface!.setSelection({
          anchor: { paragraphId: r.paragraphId, offset: 4 },
          head: { paragraphId: r.paragraphId, offset: 17 },
        });
        expect(r.aliceEditor.exec({ type: 'deleteText' }).ok).toBe(true);
        r.deliver();
        r.resume();
        r.deliver();
        for (const character of TYPED.slice(before)) {
          expect(r.bobEditor.exec({ type: 'insertText', text: character }).ok).toBe(true);
          r.deliver();
        }
        const shown = r.text(r.aliceEditor);
        expect(r.alice.room.session.statusSnapshot().status).toBe('ready');
        expect(r.bob.room.session.statusSnapshot().status).toBe('ready');
        expect(r.text(r.bobEditor)).toBe(shown);
        expect(packageFingerprint(r.bobEditor.surface!.session.currentPackage())).toBe(
          packageFingerprint(r.aliceEditor.surface!.session.currentPackage())
        );
        if (mode === 'deletes') {
          expect(shown).toBe(`One ${TYPED}Three`);
        } else if (before === 0) {
          // The caret stood in the struck words, so the typing goes past the deletion.
          expect(shown).toBe(`One Two and more ${TYPED}Three`);
        } else {
          expect(shown).toBe(`One Two ${TYPED}and more Three`);
        }
        // None of Bob's characters is struck.
        const xml = serializeOoxmlPart(r.bobEditor.surface!.session.part());
        for (const deleted of xml.matchAll(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)) {
          expect(deleted[1]).not.toMatch(/[()]/);
        }
        // A late joiner and a saved copy read the same.
        const carol = await harness.join(r.alice, 'carol');
        const carolTexts: string[] = [];
        walk(carol.store.bodyStore().part.root, (node) => {
          if (node.kind === 'paragraph') carolTexts.push(nodeText(node));
        });
        expect(carolTexts[0]).toBe(shown);
        const saved = loadPackage(new Uint8Array(await r.bobEditor.save()));
        expect(packageFingerprint(saved)).toBe(
          packageFingerprint(loadPackage(new Uint8Array(await r.aliceEditor.save())))
        );
        if (mode === 'proposes deleting') {
          // Accepting the deletion removes only what Alice saw.
          expect(r.aliceEditor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(
            true
          );
          r.deliver();
          expect(r.text(r.aliceEditor)).toBe(`One ${TYPED}Three`);
          expect(r.text(r.bobEditor)).toBe(`One ${TYPED}Three`);
        }
      });
  });

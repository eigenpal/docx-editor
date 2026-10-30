/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('concurrent-typing-caret-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const V = 'urn:schemas-microsoft-com:vml';
const BOX =
  `<w:r><w:pict xmlns:v="${V}"><v:shape type="#_x0000_t202" style="position:absolute;` +
  'margin-left:200pt;margin-top:0;width:144pt;height:48pt;z-index:1" filled="f">' +
  '<v:textbox><w:txbxContent><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:txbxContent>' +
  '</v:textbox></v:shape></w:pict></w:r>';

type Place = 'text box' | 'body paragraph';

async function pair(place: Place) {
  const peers = await harness.pair(
    zipDocument(
      place === 'text box'
        ? `<w:p><w:r><w:t xml:space="preserve">Body </w:t></w:r>${BOX}</w:p>` +
            '<w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>'
        : '<w:p><w:r><w:t>Shared</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    // A host that reads the snapshot on every change, as a framework adapter does, lays out
    // inside the remote commit, before the session has finished publishing it.
    editor.on('change', () => editor.snapshot());
    return editor;
  }) as [Editor, Editor];
  const deliver = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  // A third participant, with no editor, who types in another paragraph.
  const carol = await harness.join(peers.alice, 'carol');
  const tail = harness.paragraphIdAt(carol, place === 'text box' ? 2 : 1);
  const carolTypes = () =>
    harness.apply(carol, [{ op: 'insertText', paragraphId: tail, offset: 0, text: 'c' }]);
  return { alice, bob, deliver, carolTypes, pause: peers.pause, resume: peers.resume };
}

/** Put the caret at the end of `Shared`, inside the text box when there is one. */
function caretAfterShared(editor: Editor): void {
  const match = editor.findMatches('Shared')[0]!;
  if (match.scope?.kind === 'frame') expect(editor.surface!.setActiveScope(match.scope)).toBe(true);
  const end = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: end, head: end });
}

function sharedText(editor: Editor): string {
  editor.surface!.layout();
  const match = editor.findMatches('Shared')[0]!;
  return paragraphTextOf(editor.surface!.session.part(), match.blockId) ?? '';
}

for (const place of ['text box', 'body paragraph'] as const) {
  describe(place, () => {
    // Each round, Alice and Bob type one character each at the same place before either sees
    // the other's. Carol's edit elsewhere reaches them first: a remote change that moves no
    // caret, so the carry it leaves must not stand for the next change, which does.
    test('characters typed at one place at the same time stay in typing order', async () => {
      const { alice, bob, deliver, carolTypes, pause, resume } = await pair(place);
      caretAfterShared(alice);
      caretAfterShared(bob);
      const typed = { alice: 'Alice', bob: 'Bob' };
      for (let round = 0; round < 5; round++) {
        pause();
        const a = typed.alice[round];
        const b = typed.bob[round];
        if (a) expect(alice.exec({ type: 'insertText', text: a }).ok).toBe(true);
        if (b) expect(bob.exec({ type: 'insertText', text: b }).ok).toBe(true);
        deliver();
        carolTypes();
        resume();
        deliver();
      }
      const left = sharedText(alice);
      const right = sharedText(bob);
      expect(right).toBe(left);
      expect(['SharedAliceBob', 'SharedBobAlice']).toContain(left);
      expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(
        packageFingerprint(alice.surface!.session.currentPackage())
      );
    });
  });
}

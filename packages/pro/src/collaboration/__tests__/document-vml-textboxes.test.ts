/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('vml-textbox-editor-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const V = 'urn:schemas-microsoft-com:vml';

/** A legacy VML text box with no modern alternative: floating, or on the line. */
function vmlBoxRun(text: string, inline: boolean): string {
  const style = inline
    ? 'width:144pt;height:36pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line'
    : 'position:absolute;margin-left:200pt;margin-top:0;width:144pt;height:48pt;z-index:1';
  return (
    `<w:r><w:pict xmlns:v="${V}"><v:rect style="${style}" fillcolor="#ccecff">` +
    `<v:textbox><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>` +
    '</v:textbox></v:rect></w:pict></w:r>'
  );
}

async function pair(inline: boolean) {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>${vmlBoxRun('Shared', inline)}` +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  function sync() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  }
  function converged() {
    sync();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  return { alice, bob, sync, converged, pause: peers.pause, resume: peers.resume };
}

/** Enter the box and put the caret at the end of its story. */
function enterBox(editor: Editor, text: string): void {
  const match = editor.findMatches(text)[0]!;
  expect(match.scope?.kind).toBe('frame');
  expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
  const end = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: end, head: end });
}

for (const inline of [false, true]) {
  describe(inline ? 'inline VML text box' : 'floating VML text box', () => {
    test('typing replicates, converges, and survives save and reopen', async () => {
      const { alice, bob, converged } = await pair(inline);
      enterBox(alice, 'Shared');
      expect(alice.exec({ type: 'insertText', text: ' story' }).ok).toBe(true);
      converged();
      expect(bob.findMatches('Shared story')[0]?.scope?.kind).toBe('frame');
      const saved = new Uint8Array(await bob.save());
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: saved,
      });
      editors.push(reopened);
      expect(reopened.findMatches('Shared story')[0]?.scope?.kind).toBe('frame');
      expect(reopened.findMatches('before')).toHaveLength(1);
    });

    test('concurrent typing in one box keeps both edits', async () => {
      const { alice, bob, sync, converged, pause, resume } = await pair(inline);
      enterBox(alice, 'Shared');
      enterBox(bob, 'Shared');
      pause();
      expect(alice.exec({ type: 'insertText', text: ' Alice' }).ok).toBe(true);
      expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
      sync();
      resume();
      converged();
      for (const editor of [alice, bob]) {
        expect(editor.findMatches('Alice')[0]?.scope?.kind).toBe('frame');
        expect(editor.findMatches('Bob')[0]?.scope?.kind).toBe('frame');
      }
    });

    test('undo and redo of box typing replicate', async () => {
      const { alice, bob, converged } = await pair(inline);
      enterBox(alice, 'Shared');
      expect(alice.exec({ type: 'insertText', text: ' undone' }).ok).toBe(true);
      converged();
      expect(alice.exec({ type: 'undo' }).ok).toBe(true);
      converged();
      expect(bob.findMatches('undone')).toHaveLength(0);
      expect(alice.exec({ type: 'redo' }).ok).toBe(true);
      converged();
      expect(bob.findMatches('Shared undone')[0]?.scope?.kind).toBe('frame');
    });

    test('deleting the host paragraph while a peer types in the box converges', async () => {
      const { alice, bob, sync, converged, pause, resume } = await pair(inline);
      enterBox(bob, 'Shared');
      const host = alice.findMatches('before')[0]!.blockId;
      const tail = alice.findMatches('Tail')[0]!.blockId;
      pause();
      expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
      alice.surface!.setSelection({
        anchor: { paragraphId: host, offset: 0 },
        head: { paragraphId: tail, offset: 0 },
      });
      alice.surface!.deleteBackward();
      sync();
      resume();
      converged();
      for (const editor of [alice, bob]) {
        expect(editor.findMatches('before')).toHaveLength(0);
        expect(editor.findMatches('Shared')).toHaveLength(0);
        expect(editor.findMatches('typed')).toHaveLength(0);
        expect(editor.findMatches('Tail')).toHaveLength(1);
      }
      expect(bob.surface!.activeScope().kind).toBe('body');
      expect(bob.exec({ type: 'insertText', text: 'Still editable' }).ok).toBe(true);
      converged();
      expect(alice.findMatches('Still editable')).toHaveLength(1);
    });
  });
}

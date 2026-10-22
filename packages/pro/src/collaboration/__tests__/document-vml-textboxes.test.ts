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

type BoxKind = 'floating' | 'inline' | 'pathFlags' | 'oval' | 'turned' | 'vertical';

/**
 * A legacy VML text box with no modern alternative: floating, on the line, a page-anchored
 * text box shape whose path flags only switch the outline off, an oval, a quarter-turned box
 * whose text stays upright, or a box whose text runs vertically.
 */
function vmlBoxRun(text: string, kind: BoxKind): string {
  const textboxStyle = kind === 'vertical' ? ' style="layout-flow:vertical"' : '';
  const story = `<v:textbox${textboxStyle}><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox>`;
  const floating =
    'position:absolute;margin-left:200pt;margin-top:0;width:144pt;height:48pt;z-index:1';
  if (kind === 'oval')
    return `<w:r><w:pict xmlns:v="${V}"><v:oval style="${floating}" filled="f">${story}</v:oval></w:pict></w:r>`;
  if (kind === 'turned' || kind === 'vertical')
    return (
      `<w:r><w:pict xmlns:v="${V}"><v:rect style="${floating}${kind === 'turned' ? ';rotation:90' : ''}" ` +
      `fillcolor="#ccecff">${story}</v:rect></w:pict></w:r>`
    );
  if (kind === 'pathFlags')
    return (
      `<w:r><w:pict xmlns:v="${V}"><v:shape type="#_x0000_t202" style="width:144pt;height:48pt;` +
      'margin-top:60pt;margin-left:36pt;mso-position-horizontal-relative:page;' +
      'mso-position-vertical-relative:page;position:absolute;z-index:1" filled="f" stroked="f">' +
      `<v:path strokeok="f" textboxrect="0,0,21600,21600"/>${story}</v:shape></w:pict></w:r>`
    );
  const style =
    kind === 'inline'
      ? 'width:144pt;height:36pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line'
      : 'position:absolute;margin-left:200pt;margin-top:0;width:144pt;height:48pt;z-index:1';
  return (
    `<w:r><w:pict xmlns:v="${V}"><v:rect style="${style}" fillcolor="#ccecff">` +
    `${story}</v:rect></w:pict></w:r>`
  );
}

async function pair(kind: BoxKind) {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>${vmlBoxRun('Shared', kind)}` +
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

const KIND_NAMES: Record<BoxKind, string> = {
  floating: 'floating VML text box',
  inline: 'inline VML text box',
  pathFlags: 'VML text box with inert path flags',
  oval: 'VML oval text box',
  turned: 'quarter-turned VML text box with upright text',
  vertical: 'VML text box with vertical text',
};

for (const kind of ['floating', 'inline', 'pathFlags', 'oval', 'turned'] as const) {
  describe(KIND_NAMES[kind], () => {
    test('typing replicates, converges, and survives save and reopen', async () => {
      const { alice, bob, converged } = await pair(kind);
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
      const { alice, bob, sync, converged, pause, resume } = await pair(kind);
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
      const { alice, bob, converged } = await pair(kind);
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
      const { alice, bob, sync, converged, pause, resume } = await pair(kind);
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

describe(KIND_NAMES.vertical, () => {
  test('the turned story refuses editing while edits around it converge and save', async () => {
    const { alice, bob, sync, converged, pause, resume } = await pair('vertical');
    const match = alice.findMatches('Shared')[0]!;
    expect(match.scope?.kind).toBe('frame');
    // Turned text has no upright caret, so the box cannot be entered.
    expect(alice.surface!.setActiveScope(match.scope!)).toBe(false);
    const tail = bob.findMatches('Tail')[0]!;
    pause();
    const end = { paragraphId: tail.blockId, offset: tail.start + tail.length };
    bob.surface!.setSelection({ anchor: end, head: end });
    expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
    const body = alice.findMatches('Body')[0]!;
    const start = { paragraphId: body.blockId, offset: 0 };
    alice.surface!.setSelection({ anchor: start, head: start });
    expect(alice.exec({ type: 'insertText', text: 'Alice ' }).ok).toBe(true);
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      expect(editor.findMatches('Alice Body')).toHaveLength(1);
      expect(editor.findMatches('Tail Bob')).toHaveLength(1);
      expect(editor.findMatches('Shared')[0]?.scope?.kind).toBe('frame');
    }
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await bob.save()),
    });
    editors.push(reopened);
    expect(reopened.findMatches('Shared')[0]?.scope?.kind).toBe('frame');
  });
});

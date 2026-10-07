/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Placeholder replacement retains its control inside a tracked insertion (#1128).

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { contentControlTextOf, contentControlsIn } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('tracked-placeholder', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return editor;
}

function caret(editor: Editor, offset: number) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

/** The chip's own text, or null once it is gone. */
function controlText(editor: Editor): string | null {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

const PROMPT =
  '<w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
  '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>Click to enter text</w:t></w:r></w:sdtContent>' +
  '</w:sdt></w:ins><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>';

async function peers() {
  const pair = await harness.pair(zipDocument(PROMPT));
  const [alice, bob] = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, flush, converge };
}

test('tracked placeholder replacement converges, undoes, redoes, reconnects, and reopens', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 19);
  alice.surface!.type('#');
  caret(bob, 25);
  bob.surface!.type('!');
  expect(alice.surface!.state().lastRejection).toBeNull();
  flush();
  pair.resume();
  converge();
  expect(controlText(alice)).toBe('#');
  expect(controlText(bob)).toBe('#');
  expect(alice.surface!.session.bodyText()).toBe('# after!');
  caret(alice, 1);
  applyAwarenessUpdate(
    pair.bob.awareness,
    encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.awareness.clientID]),
    'test'
  );
  expect(containers[1]!.querySelector('.docx-remote-caret')).not.toBeNull();
  const paragraphId = alice.surface!.session.paragraphIds()[0]!;
  alice.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 1 },
  });
  applyAwarenessUpdate(
    pair.bob.awareness,
    encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.awareness.clientID]),
    'test'
  );
  expect(containers[1]!.querySelector('.docx-remote-selection-rect')).not.toBeNull();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(controlText(bob)).toBe('Click to enter text');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(controlText(bob)).toBe('#');
  const rejoined = await harness.join(pair.alice, 'returning');
  rejoined.detach();
  const returning = mount({
    document: rejoined.room.document,
    modules: [collaborationModule({ session: rejoined.room.session })],
  });
  expect(controlText(returning)).toBe('#');
  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(controlText(reopened)).toBe('#');
});

test('deleting the tracked control during replacement converges without moving its text outside', async () => {
  // A deletion removes only what its author saw. The replacement typed meanwhile stays, and
  // stays inside its control rather than moving into the paragraph around it.
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 19);
  alice.surface!.type('#');
  const control = contentControlsIn(mainPart(bob.surface!.session.currentPackage()).root)[0]!;
  const result = bob.surface!.session.applyTreeOps([
    { op: 'removeContentControl', controlId: control.node.id, keepContent: false },
  ]);
  expect(result.committed).toBe(true);
  flush();
  pair.resume();
  converge();
  expect(controlText(alice)).toBe('#');
  expect(controlText(bob)).toBe('#');
  expect(alice.surface!.session.bodyText()).toBe('# after');
});

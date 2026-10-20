/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type UnsupportedElementRule } from '@docx-editor.dev/core/layout';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('unsupported-element-projection', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
const XML_NAMESPACE = 'urn:collaboration-widgets';
const bytes = zipDocument(
  `<w:p><w:r><w:t xml:space="preserve">Alpha </w:t><x:chip xmlns:x="${XML_NAMESPACE}" x:id="inline-42"><x:token>LEGAL-42</x:token></x:chip><w:t> tail</w:t></w:r></w:p>` +
    `<x:widget xmlns:x="${XML_NAMESPACE}" x:id="block-42"><x:status>pending</x:status></x:widget>` +
    '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>'
);
const rules = (height = 30): readonly UnsupportedElementRule[] => [
  { match: (element) => element.namespaceUri === XML_NAMESPACE, layout: { width: 90, height } },
];
function normalize(node: OoxmlNode): unknown {
  if (node.kind === 'textValue') return node.value;
  return {
    namespaceUri: node.namespaceUri,
    localName: node.localName,
    attributes: node.attributes.map(({ namespaceUri, localName, value }) => ({
      namespaceUri,
      localName,
      value,
    })),
    children: node.children.map(normalize),
  };
}
function source(editor: Editor): unknown[] {
  const found: unknown[] = [];
  function visit(node: OoxmlNode) {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === XML_NAMESPACE && ['chip', 'widget'].includes(node.localName)) {
      found.push(normalize(node));
      return;
    }
    for (const child of node.children) visit(child);
  }
  visit(editor.surface!.session.part().root);
  return found;
}
function mount(options: Parameters<typeof createDocxEditor>[0]): Editor {
  const container = document.createElement('div');
  globalThis.document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return editor;
}

test('generic inline and block projections retain source through concurrent edits, history, reconnect, and reopen', async () => {
  const peers = await harness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      unsupportedElementRules: rules(),
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const surface = (editor: Editor) => editor.surface!;
  const first = surface(alice).session.paragraphIds()[0]!;
  const second = surface(alice).session.paragraphIds()[1]!;
  const select = (editor: Editor, paragraphId: string, offset: number, end = offset) =>
    surface(editor).setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset: end },
    });
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const originalSource = source(alice);
  expect(originalSource).toHaveLength(2);
  const converge = () => {
    flush();
    const left = surface(alice).session.currentPackage();
    const right = surface(bob).session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
    expect(source(alice)).toEqual(originalSource);
    expect(source(bob)).toEqual(originalSource);
    for (const container of containers) {
      expect(container.querySelectorAll('[data-docx-unsupported]')).toHaveLength(2);
    }
  };
  converge();

  // Both participants insert before the same opaque inline while transport is paused.
  peers.pause();
  select(alice, first, 0);
  select(bob, first, 0);
  expect(alice.exec({ type: 'insertText', text: 'AA' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: 'BB' }).ok).toBe(true);
  flush();
  peers.resume();
  converge();
  expect(surface(alice).session.bodyText()).toContain('AA');
  expect(surface(alice).session.bodyText()).toContain('BB');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(surface(bob).session.bodyText()).not.toContain('AA');
  expect(surface(bob).session.bodyText()).toContain('BB');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(surface(bob).session.bodyText()).toContain('AA');

  // Layout registrations stay local and do not write collaboration document state.
  const beforeLayout = packageFingerprint(surface(alice).session.currentPackage());
  const position = { paragraphId: second, offset: 1 };
  const beforeCaret = caretAt(surface(alice).layout(), position)!;
  alice.setUnsupportedElementRules(rules(54));
  expect(packageFingerprint(surface(alice).session.currentPackage())).toBe(beforeLayout);
  expect(caretAt(surface(alice).layout(), position)!.y).toBeGreaterThan(beforeCaret.y);
  bob.setUnsupportedElementRules(rules(54));
  select(alice, second, 1, 3);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote).toBeDefined();
  for (const edge of ['anchor', 'head'] as const) {
    expect(
      caretAt(surface(bob).layout(), {
        paragraphId: remote[edge].nodeId,
        offset: remote[edge].offset,
      })
    ).toEqual(caretAt(surface(alice).layout(), surface(alice).state().selection[edge]));
  }

  // A deletion overlaps another participant's insertion beside the opaque inline.
  peers.pause();
  select(alice, first, 0, 3);
  select(bob, first, 1);
  expect(surface(alice).deleteSelection()).toBe(true);
  expect(bob.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
  flush();
  peers.resume();
  converge();
  expect(surface(alice).session.bodyText()).toContain('Z');

  const saved = await alice.save();
  expect(saved).not.toBeNull();
  const reopened = mount({ document: saved!, unsupportedElementRules: rules(54) });
  expect(source(reopened)).toEqual(originalSource);
  expect(surface(reopened).session.bodyText()).toBe(surface(alice).session.bodyText());
  expect(saveReopenDigest(surface(reopened).session.currentPackage())).toEqual(
    saveReopenDigest(surface(alice).session.currentPackage())
  );
  expect(containers.at(-1)!.querySelectorAll('[data-docx-unsupported]')).toHaveLength(2);
});

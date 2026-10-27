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
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';
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
const drawingAlternatives = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"><mc:Choice Requires="wpc"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1524000" cy="762000"/><wp:docPr id="1" name="Unavailable diagram"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="urn:unsupported-diagram"><x:diagram xmlns:x="urn:unsupported-diagram"/></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:group xmlns:v="urn:schemas-microsoft-com:vml" alt="Diagram fallback" style="width:120pt;height:60pt"/></w:pict></mc:Fallback></mc:AlternateContent>`;
const headerDrawing = drawingAlternatives
  .replace(
    '<wp:inline ',
    '<wp:anchor behindDoc="1" simplePos="0" relativeHeight="0" allowOverlap="1" layoutInCell="1" '
  )
  .replace(
    '<wp:extent',
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent'
  )
  .replace('cy="762000"', 'cy="12700000"')
  .replace('<wp:docPr', '<wp:wrapTopAndBottom/><wp:docPr')
  .replace('</wp:inline>', '</wp:anchor>');
const bytes = zipDocument(
  `<w:p><w:r><w:t xml:space="preserve">Alpha </w:t><x:chip xmlns:x="${XML_NAMESPACE}" x:id="inline-42"><x:token>LEGAL-42</x:token></x:chip><w:t> tail</w:t>${drawingAlternatives}</w:r></w:p>` +
    `<x:widget xmlns:x="${XML_NAMESPACE}" x:id="block-42"><x:status>pending</x:status></x:widget>` +
    '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rIdHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r>${headerDrawing}</w:r></w:p></w:hdr>`,
    },
  }
);
const rules = (height = 30): readonly UnsupportedElementRule[] => [
  { match: (element) => element.namespaceUri === XML_NAMESPACE, layout: { width: 90, height } },
];
function normalize(node: OoxmlNode): unknown {
  if (node.kind === 'textValue') return node.value;
  return {
    namespaceUri: node.namespaceUri,
    localName: node.localName,
    attributes: node.attributes
      .map(({ namespaceUri, localName, value }) => ({
        namespaceUri,
        localName,
        value,
      }))
      .sort((a, b) =>
        `${a.namespaceUri}:${a.localName}`.localeCompare(`${b.namespaceUri}:${b.localName}`)
      ),
    children: node.children.map(normalize),
  };
}
function source(editor: Editor): unknown[] {
  const found: unknown[] = [];
  function visit(node: OoxmlNode) {
    if (node.kind === 'textValue') return;
    if (
      (node.namespaceUri === XML_NAMESPACE && ['chip', 'widget'].includes(node.localName)) ||
      node.localName === 'AlternateContent'
    ) {
      found.push(normalize(node));
      return;
    }
    for (const child of node.children) visit(child);
  }
  for (const part of editor.surface!.session.currentPackage().parts.values()) visit(part.root);
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

test('opaque content and drawing alternatives retain source through concurrent edits, history, reconnect, and reopen', async () => {
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
  expect(originalSource).toHaveLength(4);
  const converge = () => {
    flush();
    const left = surface(alice).session.currentPackage();
    const right = surface(bob).session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
    expect(source(alice)).toEqual(originalSource);
    expect(source(bob)).toEqual(originalSource);
    for (const container of containers) {
      expect(container.querySelectorAll('[data-docx-unsupported]')).toHaveLength(4);
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
  expect(containers.at(-1)!.querySelectorAll('[data-docx-unsupported]')).toHaveLength(4);
});

test('rendered preview registrations stay local through concurrent edits and drawing deletion', async () => {
  const { previewDocument, previewShape } =
    await import('../../../../core/src/store/__tests__/drawing-support-fixtures.ts');
  const { inspectDrawingSupport } = await import('@docx-editor.dev/core/store');
  const peers = await harness.pair(
    previewDocument(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>'))
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const session = (editor: Editor) => editor.surface!.session;
  const paragraph = session(alice).paragraphIds()[0]!;
  const select = (editor: Editor, offset: number, end = offset) =>
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset },
      head: { paragraphId: paragraph, offset: end },
    });
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(session(alice).currentPackage())).toBe(
      packageFingerprint(session(bob).currentPackage())
    );
    expect(saveReopenDigest(session(alice).currentPackage())).toEqual(
      saveReopenDigest(session(bob).currentPackage())
    );
  };
  const fingerprint = packageFingerprint(session(alice).currentPackage());
  alice.setUnsupportedElementRules([{ includePartial: true }]);
  expect(packageFingerprint(session(alice).currentPackage())).toBe(fingerprint);
  expect(containers[0]!.querySelectorAll('[data-docx-unsupported]')).toHaveLength(1);
  expect(containers[1]!.querySelectorAll('[data-docx-unsupported]')).toHaveLength(0);
  select(alice, 0, 2);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(
    caretAt(bob.surface!.layout(), {
      paragraphId: remote.anchor.nodeId,
      offset: remote.anchor.offset,
    })
  ).toEqual(caretAt(alice.surface!.layout(), alice.surface!.state().selection.anchor));
  peers.pause();
  select(alice, 0);
  select(bob, 0);
  expect(alice.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
  flush();
  peers.resume();
  converge();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  const report = inspectDrawingSupport(session(alice).currentPackage());
  expect(report.entries[0]!.issues).toContainEqual(expect.objectContaining({ detail: 'a:blur' }));
  const saved = await alice.save();
  const reopened = mount({
    document: saved!,
    unsupportedElementRules: [{ includePartial: true }],
  });
  expect(
    inspectDrawingSupport(session(reopened).currentPackage()).entries[0]!.issues
  ).toContainEqual(expect.objectContaining({ detail: 'a:blur' }));
  // Both inserted letters precede the original six-character prefix.
  peers.pause();
  select(alice, 8, 9);
  select(bob, 0);
  expect(alice.surface!.deleteSelection()).toBe(true);
  expect(bob.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
  flush();
  peers.resume();
  converge();
  expect(inspectDrawingSupport(session(alice).currentPackage()).entries).toHaveLength(0);
  expect(session(bob).bodyText()).toContain('C');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(inspectDrawingSupport(session(bob).currentPackage()).entries).toHaveLength(1);
});

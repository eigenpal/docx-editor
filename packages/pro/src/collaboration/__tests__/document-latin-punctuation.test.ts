/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('latin-punctuation-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const BODY =
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr>' +
  '<w:sz w:val="22"/><w:lang w:eastAsia="zh-CN"/></w:rPr>' +
  '<w:t>Alpha Beta, Next</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="2800" w:h="8000"/>' +
  '<w:pgMar w:top="400" w:bottom="400" w:left="800" w:right="800"/></w:sectPr>';
// Punctuation hangs only in a justified paragraph of a document with an East Asian default face.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SOURCE = {
  overrides:
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  extraXml: {
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  },
};
function lines(editor: Editor) {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
          : []
      )
    );
}
function select(editor: Editor, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

test('Latin punctuation layout converges through concurrent edits, history, and reconnect', async () => {
  const peers = await harness.pair(zipDocument(BODY, SOURCE));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.surface!.session.currentPackage();
    const b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(lines(alice)).toEqual(lines(bob));
  };
  converged();
  expect(lines(alice)[0]).toBe('Alpha Beta,');
  select(alice, 11);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'relay'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote.head.offset).toBe(11);
  const geometry = caretAt(alice.surface!.layout(), {
    paragraphId: alice.surface!.session.paragraphIds()[0]!,
    offset: remote.head.offset,
  });
  expect(geometry).not.toBeNull();
  expect(
    caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(geometry);

  peers.pause();
  select(alice, 10, 11);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 11);
  expect(bob.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();

  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(lines(reopened)).toEqual(lines(alice));
});

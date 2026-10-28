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
const harness = createPeerHarness('kana-natural-width-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const H = 'アイ'.repeat(10).slice(0, 19);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) =>
  '<w:p><w:pPr><w:jc w:val="left"/><w:overflowPunct w:val="0"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="ja-JP"/></w:rPr>' +
  `<w:t>${text}</w:t></w:r></w:p>`;
const BODY =
  paragraph(H + 'イ') +
  paragraph(H) +
  '<w:sectPr><w:pgSz w:w="3540" w:h="10000"/>' +
  '<w:pgMar w:top="600" w:bottom="600" w:left="600" w:right="600"/></w:sectPr>';
const SOURCE = {
  overrides:
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
  extraXml: {
    'word/settings.xml': `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/></w:settings>`,
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
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
function finalCaret(editor: Editor) {
  const paragraphId = editor.surface!.session.paragraphIds()[1]!;
  const layout = editor.surface!.layout();
  const start = caretAt(layout, { paragraphId, offset: 0 })!;
  const mark = caretAt(layout, { paragraphId, offset: 19 })!;
  return mark.x - start.x;
}

test('natural kana wrapping converges through edits, history, reconnect, and save', async () => {
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
    const a = alice.surface!.session.currentPackage(),
      b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(lines(alice)).toEqual(lines(bob));
    expect(finalCaret(alice)).toBeCloseTo(114, 6);
    expect(finalCaret(bob)).toBeCloseTo(114, 6);
  };
  converged();
  expect(lines(alice)).toEqual([H, 'イ', H]);
  select(alice, 19);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'relay'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote.head.offset).toBe(19);
  expect(caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: 19 })).toEqual(
    caretAt(alice.surface!.layout(), {
      paragraphId: alice.surface!.session.paragraphIds()[0]!,
      offset: 19,
    })
  );
  peers.pause();
  select(alice, 19, 20);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 20);
  expect(bob.exec({ type: 'insertText', text: 'ア' }).ok).toBe(true);
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
  expect(finalCaret(reopened)).toBeCloseTo(114, 6);
  const latePeer = await harness.join(peers.alice, 'late-kana');
  latePeer.detach();
  const late = createDocxEditor({
    container: document.createElement('div'),
    document: latePeer.room.document,
    modules: [collaborationModule({ session: latePeer.room.session })],
  });
  editors.push(late);
  expect(lines(late)).toEqual(lines(alice));
  expect(finalCaret(late)).toBeCloseTo(114, 6);
  expect(packageFingerprint(late.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.surface!.session.currentPackage())
  );
});

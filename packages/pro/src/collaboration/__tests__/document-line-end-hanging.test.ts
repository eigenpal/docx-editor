/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Line-end rules that depend on the compatibility mode and the paragraph kinsoku switch stay
// derived layout: two peers converge through edits, history, reconnect, and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('line-end-hanging-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string, pPr: string) =>
  `<w:p><w:pPr>${pPr}</w:pPr>` +
  '<w:r><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="ja-JP"/></w:rPr>' +
  `<w:t>${text}</w:t></w:r></w:p>`;
// Nineteen ideographs fill a line, so the mark after 38 of them overflows.
const H = '国'.repeat(38);
const ROW = '国'.repeat(19);
const BODY =
  paragraph(H + '。国', '<w:jc w:val="left"/>') +
  paragraph(H + '！国', '<w:jc w:val="both"/><w:kinsoku w:val="0"/>') +
  '<w:sectPr><w:pgSz w:w="3540" w:h="10000"/>' +
  '<w:pgMar w:top="600" w:bottom="600" w:left="600" w:right="600"/></w:sectPr>';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const SOURCE = {
  overrides:
    `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>`,
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '</Relationships>',
  extraXml: {
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    'word/settings.xml':
      `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>',
  },
};
/** Each paragraph's line texts. */
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
function select(editor: Editor, paragraph: number, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}
/** Whether some line ends with a hanging 。, and whether some line starts with ！. */
function lineEnds(editor: Editor) {
  const all = lines(editor);
  return {
    hangs: all.some((line) => line.endsWith('国。')),
    starts: all.some((line) => line.startsWith('！')),
  };
}

test('mode-dependent hanging converges through edits, history, reconnect, and save', async () => {
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
  };
  converged();
  // The left-aligned paragraph hangs its 。; with kinsoku off, ！ may start a line, and does.
  expect(lines(alice)).toEqual([ROW, ROW + '。', '国', ROW, ROW, '！国']);
  const before = lines(alice);
  select(alice, 0, 38);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'relay'
  );
  expect(peers.bob.room.session.remoteSelections()[0]!.head.offset).toBe(38);
  peers.pause();
  select(alice, 0, 37, 38);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 1, 39);
  expect(bob.exec({ type: 'insertText', text: '国' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converged();
  // One ideograph fewer lets the mark fit inside the margin; the inserted one follows the mark.
  expect(lines(alice)).toEqual([ROW, ROW.slice(1) + '。', '国', ROW, ROW, '！国国']);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(lines(alice)).toEqual(before);
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(lines(reopened)).toEqual(lines(alice));
  expect(lineEnds(reopened)).toEqual({ hangs: true, starts: true });
});

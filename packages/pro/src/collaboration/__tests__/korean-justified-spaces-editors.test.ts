/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With balanced single-byte and double-byte widths, a justified line of Korean words keeps its
// spaces at the balanced width and moves the next word to the next line. The lines stay
// derived layout: two peers converge through concurrent edits, history, and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('korean-justified-spaces-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Every 11 pt character is 6 pt on the 87 pt measure, and a space beside Hangul takes half the
// font size, 5.5 pt. `가나다 라마 바사 아자 차카` is 88 pt: its four spaces keep that width.
const TEXT = '가나다 라마 바사 아자 차카';
const BODY =
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="ko-KR"/></w:rPr>' +
  `<w:t>${TEXT}</w:t></w:r></w:p>` +
  '<w:sectPr><w:pgSz w:w="2940" w:h="10000"/>' +
  '<w:pgMar w:top="600" w:bottom="600" w:left="600" w:right="600"/></w:sectPr>';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const SOURCE = {
  overrides: `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>`,
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '</Relationships>',
  extraXml: {
    'word/settings.xml':
      `<w:settings xmlns:w="${W}">` +
      '<w:compat><w:balanceSingleByteDoubleByteWidth/>' +
      '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  },
};
type Line = { spans: readonly { text: string; box: { x: number; width: number } }[] };
function paragraphLines(editor: Editor): Line[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    );
}
/** Each line's text, and the total advance its spaces give up. */
function lines(editor: Editor) {
  return paragraphLines(editor).map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    // A shrunk space overlaps the next span.
    shrink: line.spans.reduce((sum, span, index) => {
      const next = line.spans[index + 1];
      return sum + (next ? Math.max(0, span.box.x + span.box.width - next.box.x) : 0);
    }, 0),
  }));
}
function select(editor: Editor, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

test('justified Korean words keep balanced spaces through edits, history, and save', async () => {
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
    for (const line of lines(alice)) expect(line.shrink).toBeCloseTo(0, 6);
  };
  converged();
  expect(lines(alice).map((line) => line.text)).toEqual(['가나다 라마 바사 아자 ', '차카']);
  const before = lines(alice);
  peers.pause();
  // Alice shortens the first word while Bob appends a word offline.
  select(alice, 2, 3);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, TEXT.length);
  expect(bob.exec({ type: 'insertText', text: ' 타파' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converged();
  // `가나 라마 바사 아자 차카` is 82 pt and fits with its balanced spaces.
  expect(lines(alice).map((line) => line.text)).toEqual(['가나 라마 바사 아자 차카 ', '타파']);
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
});

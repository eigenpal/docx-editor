/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A justified line that shrinks its spaces to keep a line-end comma inside the margin stays
// derived layout: two peers converge through edits, history, reconnect, and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('line-end-space-shrink-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Every 11 pt character, a space too, is 6 pt on the 87 pt measure. `aa aa aa aa aa,` is
// 90 pt: its comma could hang, but the four spaces give up 0.75 pt each instead.
const BODY =
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr>' +
  '<w:t>aa aa aa aa aa, aa</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="2940" w:h="10000"/>' +
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
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    'word/settings.xml':
      `<w:settings xmlns:w="${W}">` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  },
};
type Line = {
  spans: readonly {
    text: string;
    box: { x: number; width: number };
    style: { shaping?: { wordSpacingPt?: number } };
  }[];
};
function paragraphLines(editor: Editor): Line[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    );
}
/** Each line's text, and the total spacing its spaces give up. */
function lines(editor: Editor) {
  return paragraphLines(editor).map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    // A shrunk space overlaps the next span, or carries negative word spacing on a bidi line.
    shrink: line.spans.reduce((sum, span, index) => {
      const next = line.spans[index + 1];
      const overlap =
        next && next.box.x > span.box.x ? Math.max(0, span.box.x + span.box.width - next.box.x) : 0;
      return sum - overlap + (span.style.shaping?.wordSpacingPt ?? 0);
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

test('space shrinking before a hanging comma converges through edits, history, and save', async () => {
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
  // The comma stays inside: the spaces give up the 3 pt it overflows by.
  expect(lines(alice).map((line) => line.text)).toEqual(['aa aa aa aa aa, ', 'aa']);
  expect(lines(alice)[0]!.shrink).toBeCloseTo(-3, 6);
  const before = lines(alice);
  select(alice, 13);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'relay'
  );
  expect(peers.bob.room.session.remoteSelections()[0]!.head.offset).toBe(13);
  peers.pause();
  // Alice shortens the word before the comma while Bob appends a word offline.
  select(alice, 12, 13);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 18);
  expect(bob.exec({ type: 'insertText', text: ' bb' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converged();
  // The shorter line fits at its natural spacing.
  expect(lines(alice).map((line) => line.text)).toEqual(['aa aa aa aa a, ', 'aa bb']);
  expect(lines(alice)[0]!.shrink).toBe(0);
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

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How much of a hanging mark passes the margin is derived layout: two peers converge on the
// mark positions through edits, history, reconnect, and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('hanging-blank-side-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const paragraph = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:jc w:val="both"/></w:pPr>` +
  '<w:r><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="zh-CN"/></w:rPr>' +
  `<w:t>${text}</w:t></w:r></w:p>`;
// The test measurer gives each character 6 pt, so 19 ideographs and a mark take 120 pt of a
// 118 pt measure. The first mark overflows by 2 pt, within its 3 pt blank half. The second,
// 2 pt further in, overflows by 4 pt.
const H = '国'.repeat(19);
const BODY =
  paragraph(H + '，国') +
  paragraph(H + '，国', '<w:ind w:right="40"/>') +
  '<w:sectPr><w:pgSz w:w="3560" w:h="10000"/>' +
  '<w:pgMar w:top="600" w:bottom="600" w:left="600" w:right="600"/></w:sectPr>';
const SOURCE = {
  overrides:
    `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>`,
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="settings" Type="${REL}/settings" Target="settings.xml"/>` +
    '</Relationships>',
  extraXml: {
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    'word/settings.xml': `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
  },
};
/** The x of each paragraph's mark, at `offsets`, from the paragraph's start. */
function markXs(editor: Editor, offsets: readonly number[]) {
  const layout = editor.surface!.layout();
  return editor.surface!.session.paragraphIds().map((paragraphId, index) => {
    const start = caretAt(layout, { paragraphId, offset: 0 })!;
    const mark = caretAt(layout, { paragraphId, offset: offsets[index]! })!;
    return Math.round((mark.x - start.x) * 100) / 100;
  });
}
function select(editor: Editor, paragraph: number, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

test('blank-side hanging converges through edits, history, reconnect, and save', async () => {
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
  let offsets = [19, 19];
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.surface!.session.currentPackage(),
      b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(markXs(alice, offsets)).toEqual(markXs(bob, offsets));
  };
  converged();
  // The first mark hangs its blank half: its ink ends at 118 pt. The second hangs whole.
  expect(markXs(alice, offsets)).toEqual([115, 116]);
  select(alice, 1, 19);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'relay'
  );
  expect(peers.bob.room.session.remoteSelections()[0]!.head.offset).toBe(19);
  peers.pause();
  // Offline, Alice deletes an ideograph before the second mark while Bob types after it.
  select(alice, 1, 18, 19);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 1, 21);
  expect(bob.exec({ type: 'insertText', text: '国' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  offsets = [19, 18];
  converged();
  // The second mark now fits after 18 ideographs, and its line justifies to 116 pt.
  expect(markXs(alice, offsets)).toEqual([115, 110]);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  offsets = [19, 19];
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  offsets = [19, 18];
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  offsets = [19, 19];
  converged();
  expect(markXs(alice, offsets)).toEqual([115, 116]);
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(markXs(reopened, offsets)).toEqual([115, 116]);
});

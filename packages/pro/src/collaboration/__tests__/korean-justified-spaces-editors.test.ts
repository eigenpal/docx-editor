/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With balanced single-byte and double-byte widths, a justified line of Korean words keeps its
// spaces at the balanced width and moves the next word to the next line. The lines stay
// derived layout: two peers converge through concurrent edits, history, and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, selectionRects } from '@docx-editor.dev/core/layout';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
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
function positions(editor: Editor) {
  return paragraphLines(editor).map((line) =>
    line.spans.map((span) => ({
      text: span.text,
      x: span.box.x,
      width: span.box.width,
    }))
  );
}
function select(editor: Editor, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

for (const alignment of ['both', 'distribute'] as const)
  test(`${alignment} Korean words keep balanced spaces through edits, history, and save`, async () => {
    const source =
      alignment === 'both'
        ? SOURCE
        : {
            ...SOURCE,
            overrides:
              SOURCE.overrides +
              `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>`,
            documentRels: SOURCE.documentRels.replace(
              '</Relationships>',
              '<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
            ),
            extraXml: {
              ...SOURCE.extraXml,
              'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault/></w:docDefaults></w:styles>`,
            },
          };
    const peers = await harness.pair(
      zipDocument(BODY.replace('w:val="both"', `w:val="${alignment}"`), source)
    );
    const views = [document.createElement('div'), document.createElement('div')];
    const [alice, bob] = [peers.alice, peers.bob].map((peer, index) => {
      peer.detach();
      const editor = createDocxEditor({
        container: views[index]!,
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
      expect(positions(alice)).toEqual(positions(bob));
      for (const line of lines(alice)) expect(line.shrink).toBeCloseTo(0, 6);
    };
    const remoteGeometry = () => {
      const publish = () =>
        applyAwarenessUpdate(
          peers.bob.awareness,
          encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
          'test'
        );
      select(alice, 4);
      publish();
      const caret = peers.bob.room.session.remoteSelections()[0]!;
      expect(caret.head.offset).toBe(4);
      expect(
        caretAt(bob.surface!.layout(), {
          paragraphId: caret.head.nodeId,
          offset: caret.head.offset,
        })
      ).toEqual(caretAt(alice.surface!.layout(), alice.surface!.state().selection.head));
      select(alice, 2, 6);
      publish();
      const range = peers.bob.room.session.remoteSelections()[0]!;
      expect([range.anchor.offset, range.head.offset]).toEqual([2, 6]);
      const remote = {
        anchor: { paragraphId: range.anchor.nodeId, offset: range.anchor.offset },
        head: { paragraphId: range.head.nodeId, offset: range.head.offset },
      };
      expect(
        selectionRects(bob.surface!.layout(), remote, bob.surface!.session.paragraphIds())
      ).toEqual(
        selectionRects(
          alice.surface!.layout(),
          alice.surface!.state().selection,
          alice.surface!.session.paragraphIds()
        )
      );
      expect(views[1]!.querySelectorAll('.docx-remote-selection-rect').length).toBeGreaterThan(0);
    };
    converged();
    expect(lines(alice).map((line) => line.text)).toEqual(['가나다 라마 바사 아자 ', '차카']);
    const before = lines(alice);
    remoteGeometry();
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
    remoteGeometry();
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
    expect(positions(reopened)).toEqual(positions(alice));
  });

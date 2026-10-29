/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An item on a deeper level counts each parent level it skips once, at its start. Both replicas
// show the same numbers while one participant removes the deeper item and the other adds a
// parent item, and after undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('list-skipped-parent-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const level = (ilvl: number, text: string) =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${text}"/>` +
  `<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  level(0, '%1.') +
  level(1, '%2)') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const item = (ilvl: number, text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function markersOf(editor: Editor): (string | null)[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? [fragment.marker?.text ?? null] : []
      )
    );
}

function coldMarkersOf(editor: Editor): (string | null)[] {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return markersOf(cold);
  } finally {
    cold.destroy();
  }
}

async function pairedEditors() {
  const peers = await harness.pair(
    zipDocument(item(1, 'deep') + item(0, 'one') + item(0, 'two'), {
      overrides:
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
      extraXml: { 'word/numbering.xml': NUMBERING },
    })
  );
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
  const converged = (): (string | null)[] => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(markersOf(bob)).toEqual(markersOf(alice));
    for (const editor of [alice, bob]) expect(markersOf(editor)).toEqual(coldMarkersOf(editor));
    return markersOf(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

const caret = (editor: Editor, index: number, offset: number) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

test('a deeper first item counts its parent level on both replicas', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  expect(converged()).toEqual(['1)', '2.', '3.']);

  // Concurrent: Alice takes the deeper item out of the list; Bob adds a level 0 item.
  pause();
  caret(alice, 0, 0);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 2, 3);
  bob.surface!.splitParagraph();
  resume();
  expect(converged()).toEqual([null, '1.', '2.', '3.']);

  alice.surface!.undo();
  expect(converged()).toEqual(['1)', '2.', '3.', '4.']);
  alice.surface!.redo();
  expect(converged()).toEqual([null, '1.', '2.', '3.']);
  bob.surface!.undo();
  expect(converged()).toEqual([null, '1.', '2.']);
});

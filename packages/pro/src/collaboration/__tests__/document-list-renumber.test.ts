/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A list item inserted by one participant renumbers the list for both. Each editor reuses its
// later pages and relabels their markers, so both must still match a cold layout after the
// insert, a concurrent deletion, undo, and redo.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('list-renumber-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="100"/><w:numFmt w:val="decimal"/><w:lvlText w:val="[%1]"/>' +
  '<w:pPr><w:ind w:left="1440" w:hanging="1080"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function body(): string {
  const parts: string[] = [];
  for (let index = 0; index < 160; index += 1) {
    // A hard break lets the flow line up again after an insert, so later pages are reused.
    if (index === 20) parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    parts.push(item(`Item ${index}`));
  }
  return parts.join('') + '<w:sectPr/>';
}

function markersOf(editor: Editor): string[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page, index) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker
          ? [
              `${index}|${fragment.marker.text}|${fragment.marker.box.x}|${fragment.lines[0]?.box.y}`,
            ]
          : []
      )
    );
}

function coldMarkersOf(editor: Editor): string[] {
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

test('remote and local renumbering keep every marker equal to a cold layout', async () => {
  const peers = await harness.pair(
    zipDocument(body(), {
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
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    for (const editor of [alice, bob]) expect(markersOf(editor)).toEqual(coldMarkersOf(editor));
  };
  const caret = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };

  converged();
  expect(markersOf(bob).at(-1)).toContain('|[259]|');
  caret(alice, 0, 4);
  alice.surface!.splitParagraph();
  converged();
  expect(markersOf(bob).at(-1)).toContain('|[260]|');

  // Concurrent: Alice inserts near the top while Bob deletes a later item's text and joins it.
  caret(alice, 2, 4);
  alice.surface!.splitParagraph();
  const later = bob.surface!.session.paragraphIds()[60]!;
  const next = bob.surface!.session.paragraphIds()[61]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: later, offset: 0 },
    head: { paragraphId: next, offset: 0 },
  });
  bob.surface!.deleteSelection();
  converged();

  alice.surface!.undo();
  converged();
  alice.surface!.redo();
  converged();
});

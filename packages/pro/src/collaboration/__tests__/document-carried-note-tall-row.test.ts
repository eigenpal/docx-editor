/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Without a compatibility mode, a row that cannot split and is taller than the page stays whole.
// It does not start on a page that a footnote continued from an earlier page reaches: that page
// holds only the continued note. Both replicas lay the row out on the same later page while the
// participants type in the row and before it, and after undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('carried-note-tall-row-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const paragraph = (text: string, tail = '') =>
  `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:t>${text}</w:t></w:r>${tail}</w:p>`;
const note = (id: number, content: string, type?: string) =>
  `<w:footnote${type ? ` w:type="${type}"` : ''} w:id="${id}">${content}</w:footnote>`;
// Note 1 has ten 12pt lines, so it continues over pages of a 52pt band.
const NOTES =
  `<w:footnotes xmlns:w="${W}">` +
  note(-1, `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:separator/></w:r></w:p>`, 'separator') +
  note(
    0,
    `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:continuationSeparator/></w:r></w:p>`,
    'continuationSeparator'
  ) +
  note(1, Array.from({ length: 10 }, (_, line) => paragraph(`Note${line}`)).join('')) +
  '</w:footnotes>';
const TALL_ROW =
  '<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc>' +
  [1, 2, 3, 4, 5, 6].map((line) => paragraph(`Row${line}`)).join('') +
  '</w:tc></w:tr></w:tbl>';
const BODY =
  paragraph('Cite', '<w:r><w:footnoteReference w:id="1"/></w:r>') +
  TALL_ROW +
  paragraph('After') +
  '<w:sectPr><w:pgSz w:w="10000" w:h="1760"/>' +
  '<w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/></w:sectPr>';
const FOOTNOTES = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

/** Per page: whether it holds the row, and the footnotes it shows (`c` marks a continuation). */
function pagesOf(editor: Editor): string[] {
  return editor.surface!.layout().pages.map((page) => {
    const row = page.fragments.some((fragment) => fragment.kind === 'table') ? 'row' : '-';
    const notes = (page.footnotes?.notes ?? [])
      .map((n) => `${n.noteId}${n.continuation ? 'c' : ''}`)
      .join('+');
    return `${row}|${notes}`;
  });
}

function coldPagesOf(editor: Editor): string[] {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return pagesOf(cold);
  } finally {
    cold.destroy();
  }
}

async function pairedEditors() {
  const peers = await harness.pair(
    zipDocument(BODY, {
      overrides: `<Override PartName="/word/footnotes.xml" ContentType="${FOOTNOTES}"/>`,
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
      extraXml: { 'word/footnotes.xml': NOTES },
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
  const converged = (): string[] => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(pagesOf(bob)).toEqual(pagesOf(alice));
    for (const editor of [alice, bob]) expect(pagesOf(editor)).toEqual(coldPagesOf(editor));
    return pagesOf(alice);
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

/** The row starts only after every page that note 1 continues onto. */
function expectRowAfterCarriedNote(pages: readonly string[]): void {
  const rowPage = pages.findIndex((page) => page.startsWith('row'));
  expect(rowPage).toBeGreaterThan(1);
  for (let index = 1; index < rowPage; index += 1) expect(pages[index]).toBe('-|1c');
  expect(pages.slice(rowPage).some((page) => page.includes('1c'))).toBe(false);
}

test('a tall row waits for a carried note on both replicas', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  expectRowAfterCarriedNote(converged());

  // Concurrent: Alice types in the row; Bob types before the reference.
  pause();
  caret(alice, 1, 3);
  alice.surface!.type('A');
  caret(bob, 0, 0);
  bob.surface!.type('B');
  resume();
  expectRowAfterCarriedNote(converged());

  alice.surface!.undo();
  expectRowAfterCarriedNote(converged());
  alice.surface!.redo();
  expectRowAfterCarriedNote(converged());
  bob.surface!.undo();
  expectRowAfterCarriedNote(converged());
});

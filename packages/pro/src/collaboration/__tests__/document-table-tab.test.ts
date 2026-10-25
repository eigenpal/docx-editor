/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Tab in a table cell, between two collaborating editors: moving between cells changes only the
// selection; Tab in the last cell adds a row, which converges with concurrent typing, concurrent
// Tabs, and a concurrent row deletion, through undo and redo, and after save and reopen.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { createKeyDownHandler } from '../../../../core/src/editor/surface-input.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('table-tab-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
/** A 2x2 table A1 B1 / A2 B2, then `End`. Paragraph indexes: A1 0, B1 1, A2 2, B2 3. */
const body =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell('A1')}${cell('B1')}</w:tr><w:tr>${cell('A2')}${cell('B2')}</w:tr></w:tbl>` +
  paragraph('End');

async function pair() {
  const peers = await harness.pair(zipDocument(body));
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
  const surface = (editor: Editor) => editor.surface!;
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const rows = (editor: Editor) =>
    surface(editor)
      .layout()
      .pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!.rows.length;
  /** Both sides hold the same package and layout, and it reopens with the same rows. */
  const converge = () => {
    flush();
    const left = surface(alice).session.currentPackage();
    const right = surface(bob).session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(left),
    });
    try {
      expect(rows(reopened)).toBe(rows(alice));
    } finally {
      reopened.destroy();
    }
  };
  const caret = (editor: Editor, index: number, offset: number) => {
    const paragraphId = [...surface(editor).session.paragraphIds()][index]!;
    surface(editor).setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };
  const tab = (editor: Editor) =>
    createKeyDownHandler(surface(editor))({
      key: 'Tab',
      preventDefault: () => {},
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    } as KeyboardEvent);
  return { peers, alice, bob, surface, flush, rows, converge, caret, tab };
}

test('Tab in the last cell adds a row that converges through typing, history, and reopen', async () => {
  const { peers, alice, bob, surface, flush, rows, converge, caret, tab } = await pair();

  // Moving between cells changes nothing the other side sees.
  const before = packageFingerprint(surface(alice).session.currentPackage());
  caret(alice, 0, 2);
  tab(alice);
  flush();
  expect(packageFingerprint(surface(bob).session.currentPackage())).toBe(before);

  // Offline, one side adds a row with Tab while the other types in the last cell.
  peers.pause();
  caret(alice, 3, 2);
  tab(alice);
  surface(alice).type('New');
  caret(bob, 3, 2);
  surface(bob).type(' edited');
  flush();
  peers.resume();
  converge();
  expect(rows(bob)).toBe(3);
  expect(bob.findMatches('B2 edited')).toHaveLength(1);
  expect(bob.findMatches('New')).toHaveLength(1);

  // Two undo steps: the typed text, then the added row. The other side follows each.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.findMatches('New')).toHaveLength(0);
  expect(rows(bob)).toBe(3);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(rows(bob)).toBe(2);
  expect(bob.findMatches('B2 edited')).toHaveLength(1);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(rows(bob)).toBe(3);
  expect(bob.findMatches('New')).toHaveLength(1);
});

test('concurrent Tabs in the last cell, and a Tab against a deleted last row, converge', async () => {
  const { peers, alice, bob, surface, flush, rows, converge, caret, tab } = await pair();

  // Both sides press Tab in the last cell offline: each adds its own row.
  peers.pause();
  caret(alice, 3, 2);
  tab(alice);
  surface(alice).type('Alice');
  caret(bob, 3, 2);
  tab(bob);
  surface(bob).type('Bob');
  flush();
  peers.resume();
  converge();
  expect(rows(alice)).toBe(4);
  expect(alice.findMatches('Alice')).toHaveLength(1);
  expect(alice.findMatches('Bob')).toHaveLength(1);

  // One side deletes the last row while the other presses Tab in it and types.
  const last = rows(alice) - 1;
  const lastCell = 2 * last + 1;
  peers.pause();
  caret(alice, lastCell, 0);
  expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
  caret(bob, lastCell, 0);
  tab(bob);
  surface(bob).type('After delete');
  flush();
  peers.resume();
  converge();
});

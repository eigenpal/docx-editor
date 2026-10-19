/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('fixed-bidi-borders-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const documentXml =
  '<w:tbl><w:tblPr><w:bidiVisual/><w:tblLayout w:type="fixed"/>' +
  '<w:tblW w:w="4000" w:type="dxa"/><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="24"/>`)
    .join('') +
  '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/>' +
  '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  ['Alpha', 'Beta']
    .map((text) => `<w:tr><w:tc>${paragraph(text)}</w:tc><w:tc>${paragraph('Other')}</w:tc></w:tr>`)
    .join('') +
  '</w:tbl>' +
  paragraph('Tail') +
  '<w:sectPr><w:pgSz w:w="7000" w:h="8400"/><w:pgMar w:top="400" w:bottom="400" ' +
  'w:left="400" w:right="400" w:header="0" w:footer="0"/></w:sectPr>';
const geometry = (layout: SemanticLayout) => layout.pages.map((page) => page.fragments);
// Saving assigns source addresses again after structural edits. Compare every other layout field.
const savedGeometry = (layout: SemanticLayout) =>
  JSON.parse(
    JSON.stringify(geometry(layout), (key, value) =>
      key === 'id' || key.endsWith('Id') ? undefined : value
    )
  );
const lastRow = (layout: SemanticLayout) => {
  const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (table?.kind !== 'table') throw Error('Missing table');
  return table.rows.at(-1)!;
};

test('fixed bidi borders converge through typing, history, conflicts, reconnect, and reopen', async () => {
  const peers = await harness.pair(
    zipDocument(documentXml, {
      overrides:
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
      extraXml: {
        'word/settings.xml':
          '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
      },
    })
  );
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  const surface = (editor: Editor) => editor.surface!;
  const target = surface(alice).session.paragraphIds()[2]!;
  const select = (editor: Editor, offset: number, head = offset) =>
    surface(editor).setSelection({
      anchor: { paragraphId: target, offset },
      head: { paragraphId: target, offset: head },
    });
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converge = (verifyReopen = true) => {
    flush();
    const left = surface(alice).session.currentPackage();
    const right = surface(bob).session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
    if (!verifyReopen) return;
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(left),
    });
    try {
      expect(savedGeometry(surface(alice).layout())).toEqual(
        savedGeometry(surface(reopened).layout())
      );
    } finally {
      reopened.destroy();
    }
  };
  const originalRow = lastRow(surface(alice).layout());
  expect(originalRow.rowIndex).toBe(1);
  const originalFingerprint = packageFingerprint(surface(alice).session.currentPackage());
  const table = surface(alice).layout().pages[0]!.fragments[0]!;
  expect(table.kind).toBe('table');
  expect(table.box.x).toBe(107);
  select(alice, 4);
  surface(alice).type(' More words for the cell');
  converge();
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(
    caretAt(surface(bob).layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(caretAt(surface(alice).layout(), surface(alice).state().selection.head));
  let undoCount = 0;
  while (packageFingerprint(surface(alice).session.currentPackage()) !== originalFingerprint) {
    expect(undoCount++).toBeLessThan(10);
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
  }
  expect(lastRow(surface(alice).layout()).box.height).toBe(originalRow.box.height);
  for (let index = 0; index < undoCount; index += 1) {
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
  }
  // Offline deletion and insertion use the same cell and reconnect through real sessions.
  peers.pause();
  select(alice, 4, 12);
  select(bob, 8);
  surface(alice).deleteBackward();
  surface(bob).type('Z');
  flush();
  peers.resume();
  converge();
  expect(bob.findMatches('Z')).toHaveLength(1);
  peers.pause();
  select(alice, 0);
  select(bob, 0);
  expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
  surface(bob).type('Deleted');
  flush();
  peers.resume();
  converge();
  expect(surface(bob).session.paragraphIds()).not.toContain(target);
  expect(bob.findMatches('Deleted')).toHaveLength(0);
});

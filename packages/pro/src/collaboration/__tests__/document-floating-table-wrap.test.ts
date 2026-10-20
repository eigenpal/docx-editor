/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('floating-table-wrap-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** One cell holds a square-wrapped image and editable text. */
function tableWithDrawing(): string {
  return (
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body><w:tbl><w:tblPr><w:tblW w:w="8800" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="8800"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" ' +
    'simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="Picture"/><a:graphic>' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r><w:r><w:t>Alpha</w:t></w:r></w:p>' +
    '</w:tc></w:tr></w:tbl></w:body></w:document>'
  );
}

function floatingDocument(): Uint8Array {
  const position =
    '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpY="3441" w:leftFromText="180" w:rightFromText="180"/>';
  const xml = tableWithDrawing()
    .replace('<w:tblPr>', `<w:tblPr>${position}`)
    .replace('</w:tbl>', `<w:tr><w:tc>${paragraph('Beta')}</w:tc></w:tr></w:tbl>`)
    .replace('</w:body>', `${paragraph('Tail '.repeat(50))}</w:body>`);
  const entries = unzipSync(
    zipDocument('', {
      overrides: '<Default Extension="png" ContentType="image/png"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    })
  );
  entries['word/document.xml'] = strToU8(xml);
  entries['word/media/image1.png'] = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    ),
    (c) => c.charCodeAt(0)
  );
  return zipSync(entries);
}
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

test('floating tables converge through typing, history, conflicts, reconnect, and reopen', async () => {
  const peers = await harness.pair(floatingDocument());
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
  const targetBlock = lastRow(surface(alice).layout()).cells[0]!.blocks[0]!;
  if (targetBlock.kind !== 'paragraph') throw Error('Missing editable cell');
  const target = targetBlock.paragraphId;
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
  if (table.kind !== 'table') throw Error('Missing floating table');
  expect('outOfFlow' in table && table.outOfFlow).toBe(true);
  expect(table.floatingWrap).toBeDefined();
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

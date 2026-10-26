/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A text-anchored floating table that breaks across pages, edited by two collaborating editors.
// The page is 200 pt square without margins. A 100 pt lead leaves room for two of the four
// 40 pt rows, so the last two rows continue on page 2 and the text after the table wraps
// beside them.
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  caretAt,
  type ParagraphFragmentRecord,
  type SemanticLayout,
  type TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('text-table-break-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string, line = 12) =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${line * 20}" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const row = (index: number) =>
  `<w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1600"/></w:tcPr>${paragraph(`Row ${index}`)}</w:tc></w:tr>`;
const body =
  paragraph('Lead', 100) +
  '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" w:horzAnchor="text" w:tblpX="1" w:tblpY="1"/>' +
  '<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="1600"/><w:tblCellMar>' +
  '<w:top w:type="dxa" w:w="0"/><w:left w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/>' +
  '<w:right w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1600"/>' +
  `</w:tblGrid>${[0, 1, 2, 3].map(row).join('')}</w:tbl>` +
  paragraph('Anchor') +
  paragraph('Tail') +
  '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" ' +
  'w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const geometry = (layout: SemanticLayout) => layout.pages.map((page) => page.fragments);
// Saving assigns source addresses again after structural edits. Compare every other layout field.
const savedGeometry = (layout: SemanticLayout) =>
  JSON.parse(
    JSON.stringify(geometry(layout), (key, value) =>
      key === 'id' || key.endsWith('Id') ? undefined : value
    )
  );
const tablesOn = (layout: SemanticLayout, page: number) =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
const paragraphOn = (layout: SemanticLayout, page: number, text: string) =>
  layout.pages[page]!.fragments.find(
    (fragment): fragment is ParagraphFragmentRecord =>
      fragment.kind === 'paragraph' &&
      fragment.lines.some((line) => line.spans.some((span) => span.text.startsWith(text)))
  );

test.each([false, true])(
  'a breaking text-anchored table converges through edits, history, conflicts, and reopen (extensions: %s)',
  async (extensions) => {
    const source = extensions
      ? body.replace(
          '<w:tblpPr ',
          '<x:tblpPr xmlns:x="urn:extension" w:tblpY="2000"/><w:tblpPr xmlns:x="urn:extension" x:tblpY="2000" '
        )
      : body;
    const peers = await harness.pair(zipDocument(source));
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
    const converge = () => {
      flush();
      const left = surface(alice).session.currentPackage();
      const right = surface(bob).session.currentPackage();
      expect(packageFingerprint(left)).toBe(packageFingerprint(right));
      expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
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
    const broken = (editor: Editor) => {
      const layout = surface(editor).layout();
      const [first] = tablesOn(layout, 0);
      const [rest] = tablesOn(layout, 1);
      expect(first?.floatingWrap).toBeUndefined();
      expect(rest?.floatingWrap).toBeDefined();
      const anchor = paragraphOn(layout, 1, 'Anchor')!;
      expect(anchor.lines[0]!.box.y).toBe(0);
      expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
      return { first: first!, rest: rest!, anchor };
    };

    const initial = broken(alice);
    expect(initial.first.rows).toHaveLength(2);
    expect(initial.rest.rows).toHaveLength(2);
    const anchorId = initial.anchor.paragraphId;
    const originalFingerprint = packageFingerprint(surface(alice).session.currentPackage());

    // Text typed beside the continued rows stays beside them, and the remote caret follows it.
    surface(alice).setSelection({
      anchor: { paragraphId: anchorId, offset: 6 },
      head: { paragraphId: anchorId, offset: 6 },
    });
    surface(alice).type(' more');
    converge();
    broken(bob);
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    expect(
      caretAt(surface(bob).layout(), {
        paragraphId: remote.head.nodeId,
        offset: remote.head.offset,
      })
    ).toEqual(caretAt(surface(alice).layout(), surface(alice).state().selection.head));

    // Undo and redo the edit on one side; the other side follows the table placement.
    let undoCount = 0;
    while (packageFingerprint(surface(alice).session.currentPackage()) !== originalFingerprint) {
      expect(undoCount++).toBeLessThan(10);
      expect(alice.exec({ type: 'undo' }).ok).toBe(true);
      converge();
    }
    for (let index = 0; index < undoCount; index += 1) {
      expect(alice.exec({ type: 'redo' }).ok).toBe(true);
      converge();
    }

    // Offline, one side deletes a continued row while the other types in it.
    const continued = (editor: Editor) => {
      const block = tablesOn(surface(editor).layout(), 1)[0]!.rows[0]!.cells[0]!.blocks[0]!;
      if (block.kind !== 'paragraph') throw Error('Missing continued cell');
      return block.paragraphId;
    };
    const target = continued(alice);
    peers.pause();
    surface(alice).setSelection({
      anchor: { paragraphId: target, offset: 0 },
      head: { paragraphId: target, offset: 0 },
    });
    surface(bob).setSelection({
      anchor: { paragraphId: target, offset: 5 },
      head: { paragraphId: target, offset: 5 },
    });
    expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
    surface(bob).type('Deleted');
    flush();
    peers.resume();
    converge();
    expect(bob.findMatches('Deleted')).toHaveLength(0);
    // Three rows remain: two on page 1, and the last one continues beside the text on page 2.
    const after = broken(bob);
    expect(after.first.rows).toHaveLength(2);
    expect(after.rest.rows).toHaveLength(1);
  }
);

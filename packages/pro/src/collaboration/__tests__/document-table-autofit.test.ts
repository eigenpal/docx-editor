/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage, type OoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest, walk } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('table-autofit-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const cell = (text: string, marker = false) =>
  `<w:tc><w:p><w:r>${marker ? '<w:lastRenderedPageBreak/>' : ''}<w:t>${text}</w:t></w:r></w:p></w:tc>`;
const ROWS = 36;
/** An AutoFit table: no fixed layout, auto preferred width, short starting grid columns. */
const DOCUMENT =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="900"/><w:gridCol w:w="900"/></w:tblGrid>' +
  '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
  cell('Name') +
  cell('Code') +
  cell('Note') +
  '</w:tr>' +
  Array.from(
    { length: ROWS },
    (_, row) =>
      '<w:tr>' + cell(`r${row}`, row === 20) + cell(`${row}`) + cell(`n${row}`) + '</w:tr>'
  ).join('') +
  '</w:tbl><w:p/>' +
  '<w:sectPr><w:pgSz w:w="8000" w:h="5000"/>' +
  '<w:pgMar w:top="500" w:right="500" w:bottom="500" w:left="500" w:header="0" w:footer="0"/>' +
  '</w:sectPr>';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Everything the reader sees of the table: page, rows (and repeats), cell boxes, line text. */
function tableGeometry(layout: SemanticLayout) {
  return layout.pages.map((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind !== 'table'
        ? []
        : [
            fragment.rows.map((row) => ({
              repeat: row.isHeaderRepeat === true,
              y: round(row.box.y),
              height: round(row.box.height),
              cells: row.cells.map((placed) => ({
                x: round(placed.box.x),
                width: round(placed.box.width),
                text: placed.blocks
                  .flatMap((block) =>
                    block.kind === 'paragraph'
                      ? block.lines.map((line) => line.spans.map((span) => span.text).join(''))
                      : []
                  )
                  .join('|'),
              })),
            })),
          ]
    )
  );
}

/** Column widths of the first body row on the first page. */
function columnWidths(layout: SemanticLayout): number[] {
  const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (table?.kind !== 'table') throw new Error('Missing table');
  const row = table.rows.find((candidate) => !candidate.isHeaderRepeat && candidate.cells.length);
  return row!.cells.map((placed) => round(placed.box.width));
}

/** The painted text of each materialized page, in DOM order. */
function paintedText(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-paragraph-id]')].map(
    (element) => `${element.getAttribute('data-paragraph-id')}:${element.textContent ?? ''}`
  );
}

function renderedPageBreaks(pkg: OoxmlPackage): number {
  let count = 0;
  for (const part of pkg.parts.values()) {
    walk(part.root, (node) => {
      if (node.kind !== 'textValue' && node.localName === 'lastRenderedPageBreak') count += 1;
    });
  }
  return count;
}

test('AutoFit column changes converge through typing, conflicts, history, presence, reconnect, and reopen', async () => {
  const peers = await harness.pair(zipDocument(DOCUMENT));
  const containers: HTMLElement[] = [];
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  const [aliceView, bobView] = containers as [HTMLElement, HTMLElement];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  /** Same package, same saved form, same laid-out and painted table on both peers. */
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(tableGeometry(bob.surface!.layout())).toEqual(tableGeometry(alice.surface!.layout()));
    expect(paintedText(bobView)).toEqual(paintedText(aliceView));
    expect(renderedPageBreaks(left)).toBe(1);
  };
  const ids = (editor: Editor) => editor.surface!.session.paragraphIds();
  /** Paragraph of body row `row` (0-based, after the header), column `column`. */
  const cellParagraph = (editor: Editor, row: number, column: number) =>
    ids(editor)[3 + row * 3 + column]!;
  const select = (editor: Editor, paragraphId: string, anchor: number, head = anchor) =>
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: anchor },
      head: { paragraphId, offset: head },
    });
  const publishPresence = () =>
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );

  // The fixture is multi-page with a repeated header row and starts converged.
  const initial = alice.surface!.layout();
  expect(initial.pages.length).toBeGreaterThan(2);
  const repeats = tableGeometry(initial)
    .slice(1)
    .map((tables) => tables[0]?.[0]?.repeat === true);
  expect(repeats.every(Boolean)).toBe(true);
  converged();
  expect(paintedText(aliceView).length).toBeGreaterThan(0);
  const before = columnWidths(initial);

  // 1. Typing an unbreakable word widens its AutoFit column on both peers.
  select(alice, cellParagraph(alice, 1, 0), 2);
  for (const char of 'Extraordinarily') alice.surface!.type(char);
  converged();
  const widened = columnWidths(alice.surface!.layout());
  expect(widened[0]!).toBeGreaterThan(before[0]!);
  expect(columnWidths(bob.surface!.layout())).toEqual(widened);

  // 2. Remote caret and range geometry follow the moved column.
  publishPresence();
  const caret = peers.bob.room.session.remoteSelections()[0]!;
  const local = alice.surface!.state().selection.head;
  const remoteCaret = caretAt(bob.surface!.layout(), {
    paragraphId: caret.head.nodeId,
    offset: caret.head.offset,
  });
  expect(remoteCaret).toEqual(caretAt(alice.surface!.layout(), local));
  select(alice, cellParagraph(alice, 1, 0), 0, 8);
  publishPresence();
  const range = peers.bob.room.session.remoteSelections()[0]!;
  expect([range.anchor.offset, range.head.offset]).toEqual([0, 8]);
  expect(range.head.nodeId).toBe(cellParagraph(bob, 1, 0));
  const painted = [...bobView.querySelectorAll('.docx-remote-selection-rect')];
  expect(painted.length).toBeGreaterThan(0);

  // 3. Concurrent typing in two columns, each widening its own column.
  select(alice, cellParagraph(alice, 4, 1), 0);
  select(bob, cellParagraph(bob, 6, 2), 0);
  peers.pause();
  for (const char of 'Concurrently') alice.surface!.type(char);
  for (const char of 'Simultaneously') bob.surface!.type(char);
  sync();
  peers.resume();
  converged();
  expect(alice.findMatches('Concurrently')).toHaveLength(1);
  expect(alice.findMatches('Simultaneously')).toHaveLength(1);
  const both = columnWidths(alice.surface!.layout());
  expect(both[1]!).toBeGreaterThan(widened[1]!);

  // 4. Undo and redo restore and reapply the widths on both peers.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.findMatches('Concurrently')).toHaveLength(0);
  expect(alice.findMatches('Simultaneously')).toHaveLength(1);
  expect(columnWidths(bob.surface!.layout())[1]!).toBeLessThan(both[1]!);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(columnWidths(alice.surface!.layout())).toEqual(both);
  // The other peer's history undoes only its own typing.
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Simultaneously')).toHaveLength(0);
  expect(bob.findMatches('Concurrently')).toHaveLength(1);
  expect(bob.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(columnWidths(bob.surface!.layout())).toEqual(both);

  // 5. Alice deletes the widening word while Bob types inside it.
  const word = cellParagraph(alice, 1, 0);
  select(alice, word, 2, 2 + 'Extraordinarily'.length);
  select(bob, cellParagraph(bob, 1, 0), 7);
  peers.pause();
  alice.surface!.deleteBackward();
  bob.surface!.type('Z');
  sync();
  peers.resume();
  converged();
  expect(alice.findMatches('Extraordinarily')).toHaveLength(0);
  // The concurrent insertion survives the deletion, and the column narrows again.
  expect(bob.findMatches('Z')).toHaveLength(1);
  expect(columnWidths(alice.surface!.layout())[0]!).toBeLessThan(widened[0]!);

  // 6. Alice deletes a row while Bob edits the same row.
  select(alice, cellParagraph(alice, 6, 0), 0);
  select(bob, cellParagraph(bob, 6, 2), 0);
  peers.pause();
  expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
  bob.surface!.type('Kept');
  sync();
  peers.resume();
  converged();
  // The row deletion wins on both peers: the edited row and its text are gone everywhere.
  expect(alice.findMatches('Kept')).toHaveLength(0);
  expect(bob.findMatches('Kept')).toHaveLength(0);
  expect(bob.findMatches('Simultaneously')).toHaveLength(0);
  expect(ids(bob)).toHaveLength(ids(alice).length);
  expect(ids(alice).length).toBe(3 + (ROWS - 1) * 3 + 1);

  // 7. Reconnect after offline edits on both sides, then a late peer opens the same table.
  peers.pause();
  select(alice, cellParagraph(alice, 10, 0), 0);
  for (const char of 'Offline') alice.surface!.type(char);
  select(bob, cellParagraph(bob, 12, 2), 0);
  for (const char of 'Elsewhere') bob.surface!.type(char);
  sync();
  peers.resume();
  converged();
  const late = await harness.join(peers.alice, 'late-peer');
  late.detach();
  const lateEditor = createDocxEditor({
    container: document.createElement('div'),
    document: late.room.document,
    modules: [collaborationModule({ session: late.room.session })],
  });
  editors.push(lateEditor);
  expect(tableGeometry(lateEditor.surface!.layout())).toEqual(
    tableGeometry(alice.surface!.layout())
  );

  // 8. Save and reopen without collaboration: the same package lays out the same table.
  const saved = writeOoxmlPackage(alice.surface!.session.currentPackage());
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: saved,
  });
  editors.push(reopened);
  expect(tableGeometry(reopened.surface!.layout())).toEqual(tableGeometry(alice.surface!.layout()));
  expect(renderedPageBreaks(reopened.surface!.session.currentPackage())).toBe(1);
});

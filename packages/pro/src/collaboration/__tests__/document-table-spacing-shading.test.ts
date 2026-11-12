/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A table's own fill (`w:tblPr/w:shd`) paints in its cell-spacing gaps, and its outer borders
// draw a frame around them. Two participants: a row one adds beside the other's typing takes
// the fill and the frame on both editors, through undo, redo and a save and reopen, and the
// two editors paint the same bands and frame.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const fixture = zipDocument(
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblCellSpacing w:w="100" w:type="dxa"/>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${cell('a')}${cell('b')}</w:tr><w:tr>${cell('c')}${cell('d')}</w:tr></w:tbl>` +
    `<w:p><w:r><w:t>Tail</w:t></w:r></w:p>`
);

const peers: { destroy(): void }[] = [];
afterEach(() => {
  for (const created of peers.splice(0)) created.destroy();
});

async function peer(name: string, host?: { ydoc: Y.Doc }, document_ = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'table-spacing-shading',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: document_ },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
    author: name,
  });
  const runtime = DocxEditor.createBrowser(editor, { author: name });
  const created = {
    ydoc,
    editor,
    runtime,
    container,
    destroy() {
      runtime.dispose();
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
  peers.push(created);
  return created;
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function fingerprint(created: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await created.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** The painted gap bands: their fill, size and clip, in paint order. Rows of one fill share one. */
function bands(created: Peer): string[] {
  return [...created.container.querySelectorAll<HTMLElement>('.docx-table-spacing-shading')].map(
    (band) =>
      [band.style.backgroundColor, band.style.width, band.style.height, band.style.clipPath].join(
        ' '
      )
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Wait until layout and paint stop moving: a remote update repaints on a later frame. */
async function settle(...created: Peer[]): Promise<void> {
  for (const { editor, container } of created) {
    while (!editor.surface) await tick();
    let last = '';
    for (let quiet = 0; quiet < 3;) {
      await tick();
      const state = editor.surface.state();
      const key = `${state.revision}:${state.pageCount}`;
      if (key !== last || container.querySelector('[data-docx-layout-pending]')) {
        last = key;
        quiet = 0;
      } else quiet += 1;
    }
  }
}

const rowCount = (created: Peer) => created.container.querySelectorAll('.docx-table-row').length;

test('a row added beside typing takes the gap fill on both editors, through undo and reopen', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await settle(alice, bob);
  expect(bands(alice)).toHaveLength(1);
  expect(bands(bob)).toEqual(bands(alice));
  const twoRows = bands(bob)[0];

  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().addRows('End', 1, [['e', 'f']]);
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  await settle(alice, bob);
  expect(rowCount(alice)).toBe(3);
  expect(rowCount(bob)).toBe(3);
  // The band grows over the new row.
  expect(bands(bob)[0]).not.toBe(twoRows);
  expect(bands(alice)).toHaveLength(1);
  expect(bands(bob)).toEqual(bands(alice));
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  await settle(alice, bob);
  expect(bands(alice)).toHaveLength(1);
  expect(bands(bob)).toEqual(bands(alice));
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(alice, bob);
  await settle(alice, bob);
  expect(bands(bob)).toHaveLength(1);
  expect(bands(bob)).toEqual(bands(alice));

  // Save and reopen as a fresh room: the table keeps its fill and paints the same bands.
  const reopened = await peer('Carol', undefined, new Uint8Array(await bob.editor.save()));
  await settle(reopened);
  expect(bands(reopened)).toEqual(bands(bob));
});

test('a row deleted while the other participant types in it converges on the same bands', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().deleteRows(0, 1);
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 1).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  await settle(alice, bob);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
  expect(rowCount(bob)).toBe(rowCount(alice));
  expect(bands(alice)).toHaveLength(1);
  expect(bands(bob)).toEqual(bands(alice));
});

const outer = ['top', 'left', 'bottom', 'right']
  .map((side) => `<w:${side} w:val="single" w:sz="24" w:color="C00000"/>`)
  .join('');
const framed = zipDocument(
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblCellSpacing w:w="100" w:type="dxa"/>` +
    `<w:tblBorders>${outer}<w:insideH w:val="single" w:sz="4" w:color="0070C0"/>` +
    `<w:insideV w:val="single" w:sz="4" w:color="0070C0"/></w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${cell('a')}${cell('b')}</w:tr><w:tr>${cell('c')}${cell('d')}</w:tr></w:tbl>` +
    `<w:p><w:r><w:t>Tail</w:t></w:r></w:p>`
);

/** The painted frame: its size and its rules, in paint order. */
function frame(created: Peer): string {
  const element = created.container.querySelector<HTMLElement>('.docx-table-spacing-frame');
  if (!element) return 'none';
  const rules = [...element.querySelectorAll<HTMLElement>('*')].map((rule) =>
    [rule.style.left, rule.style.top, rule.style.width, rule.style.height].join(' ')
  );
  return [element.style.width, element.style.height, ...rules].join('|');
}

test('the frame of a spaced table follows rows added and typed on both editors', async () => {
  const alice = await peer('Alice', undefined, framed);
  const bob = await peer('Bob', alice);
  await settle(alice, bob);
  const before = frame(alice);
  expect(before).not.toBe('none');
  expect(frame(bob)).toBe(before);

  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().addRows('End', 1, [['e', 'f']]);
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  await settle(alice, bob);
  expect(rowCount(alice)).toBe(3);
  const grown = frame(alice);
  expect(grown).not.toBe(before);
  expect(frame(bob)).toBe(grown);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  await settle(alice, bob);
  expect(frame(bob)).toBe(frame(alice));
  expect(rowCount(bob)).toBe(2);

  const reopened = await peer('Carol', undefined, new Uint8Array(await bob.editor.save()));
  await settle(reopened);
  expect(frame(reopened)).toBe(frame(bob));
});

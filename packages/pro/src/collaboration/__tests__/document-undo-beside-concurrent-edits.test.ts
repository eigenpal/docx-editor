/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An undo while a peer edits the same content at the same time: each participant's undo takes
// back its own edit only, text a peer deleted stays deleted, and no text or caret goes missing.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  findNode,
  replaceChildren,
  withPart,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  BODY,
  createPeerHarness,
  CT,
  nodeText,
  OD,
  REL,
  W,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import { FIELD_SEP, PACKAGE_ATTRIBUTES_KEY } from '../document/schema.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];

/** A harness whose peers have fixed Yjs client IDs: concurrent writes resolve by client ID. */
function harnessWith(clientIds?: Readonly<Record<string, number>>) {
  const harness = createPeerHarness('undo-beside-concurrent-edits-room', undefined, clientIds);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

/** Both orders of the two peers' client IDs: the undoing peer's write wins one, loses one. */
const CLIENT_ORDERS = [
  { label: 'the undoing peer has the higher client ID', ids: { alice: 10, bob: 20, carol: 30 } },
  { label: 'the undoing peer has the lower client ID', ids: { alice: 20, bob: 10, carol: 30 } },
] as const;

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const TABLE =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell('a1')}${cell('b1')}</w:tr><w:tr>${cell('a2')}${cell('b2')}</w:tr></w:tbl>`;
const TABLE_DOCUMENT = zipDocument(
  paragraph('Before') + TABLE + paragraph('After') + '<w:sectPr/>'
);

type Element = Exclude<OoxmlNode, { kind: 'textValue' }>;

function texts(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') found.push(nodeText(node));
  });
  return found;
}

function elementIds(peer: Peer, localName: string): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found.push(node.id);
  });
  return found;
}

/** The paragraph identity (`w14:paraId`) a peer shows for a paragraph, or null. */
function paraIdOf(peer: Peer, id: string): string | null {
  const node = findNode(peer.store.bodyStore().part, id);
  if (!node || node.kind === 'textValue') return null;
  return node.attributes.find((attribute) => attribute.localName === 'paraId')?.value ?? null;
}

function bodyOf(peer: Peer): Element {
  const root = peer.store.bodyStore().part.root;
  const body = root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body;
}

/** Move the body block `id` to child index `to`, in one transaction, as a block drag does. */
function moveBlock(peer: Peer, id: string, to: number): void {
  const result = peer.store.transact(BODY, (context) =>
    context.applyPackage((pkg) => {
      const part = pkg.parts.get(pkg.mainDocumentPart)!;
      const body = findNode(part, bodyOf(peer).id);
      if (!body || body.kind === 'textValue') throw new Error('no body');
      const children = [...body.children];
      const from = children.findIndex((child) => child.id === id);
      const [block] = children.splice(from, 1);
      children.splice(to, 0, block!);
      const edited = replaceChildren(part, body.id, children);
      if (!edited.ok) throw new Error('move refused');
      return withPart(pkg, edited.part);
    })
  );
  if (!result.ok) throw new Error(result.reason);
  peer.port.flushPendingJournals();
}

describe('two peers delete the same table content and one undoes', () => {
  // One peer deletes typed text it saw, while the other peer, which never saw it, deletes the
  // same row, column, or table and undoes. Only the undoing peer's delete goes: the content
  // stays deleted, structure and text, whichever peer's write the shared state kept.
  const deletes: readonly {
    readonly name: string;
    readonly op: (peer: Peer) => TreeDocOp;
    /** The paragraphs and the cell count every peer shows at the end. */
    readonly after: readonly string[];
    readonly cells: number;
  }[] = [
    {
      name: 'a row',
      op: (peer) => ({
        op: 'deleteTableRow',
        tableId: elementIds(peer, 'tbl')[0]!,
        rowId: elementIds(peer, 'tr')[0]!,
      }),
      after: ['Before', 'a2', 'b2', 'After'],
      cells: 2,
    },
    {
      name: 'a column',
      op: (peer) => ({
        op: 'deleteTableColumn',
        tableId: elementIds(peer, 'tbl')[0]!,
        gridColumnId: elementIds(peer, 'gridCol')[1]!,
      }),
      after: ['Before', 'a1', 'a2', 'After'],
      cells: 2,
    },
    {
      name: 'the table',
      op: (peer) => ({ op: 'deleteBlock', blockId: elementIds(peer, 'tbl')[0]! }),
      after: ['Before', 'After'],
      cells: 0,
    },
  ];
  for (const { label, ids } of CLIENT_ORDERS) {
    for (const { name, op, after, cells } of deletes) {
      test(`${name} stays deleted, with the text the other peer deleted (${label})`, async () => {
        const harness = harnessWith(ids);
        const { alice, bob, pause, resume } = await harness.pair(TABLE_DOCUMENT);
        pause();
        // "b1", in the first row and the second column.
        const typedIn = harness.paragraphIdAt(alice, 2);
        harness.apply(alice, [{ op: 'insertText', paragraphId: typedIn, offset: 2, text: 'X' }]);
        harness.apply(alice, [op(alice)]);
        harness.apply(bob, [op(bob)]);
        expect(bob.room.session.undo()).toBe(true);
        resume();
        harness.expectConverged(alice, bob);
        for (const peer of [alice, bob]) {
          expect(texts(peer)).toEqual([...after]);
          expect(elementIds(peer, 'tc')).toHaveLength(cells);
        }
        // The other peer's own undo still takes its delete, and its typing, back.
        while (alice.room.session.undo()) {
          // Every step of Alice's.
        }
        harness.expectConverged(alice, bob);
        expect(texts(bob)).toEqual(['Before', 'a1', 'b1', 'a2', 'b2', 'After']);
      });
    }
  }

  test('a peer that undoes its own delete alone gets the row back', async () => {
    const harness = harnessWith(CLIENT_ORDERS[0].ids);
    const { alice, bob } = await harness.pair(TABLE_DOCUMENT);
    harness.apply(bob, [deletes[0]!.op(bob)]);
    expect(texts(alice)).toEqual(['Before', 'a2', 'b2', 'After']);
    expect(bob.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(alice)).toEqual(['Before', 'a1', 'b1', 'a2', 'b2', 'After']);
  });
});

describe('an undo of typing while a peer joins its paragraph', () => {
  for (const { label, ids } of CLIENT_ORDERS) {
    test(`the copy the join made goes with the typing (${label})`, async () => {
      const harness = harnessWith(ids);
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(paragraph('First') + paragraph('Second') + '<w:sectPr/>')
      );
      const first = harness.paragraphIdAt(alice, 0);
      const second = harness.paragraphIdAt(alice, 1);
      harness.apply(alice, [{ op: 'insertText', paragraphId: second, offset: 6, text: 'XYZ' }]);
      expect(texts(bob)).toEqual(['First', 'SecondXYZ']);
      pause();
      expect(alice.room.session.undo()).toBe(true);
      harness.apply(bob, [{ op: 'joinParagraphs', firstId: first, secondId: second }]);
      resume();
      harness.expectConverged(alice, bob);
      expect(texts(alice)).toEqual(['FirstSecond']);
      // The redo brings the typing back where the join put it.
      expect(alice.room.session.redo()).toBe(true);
      harness.expectConverged(alice, bob);
      expect(texts(bob)).toEqual(['FirstSecondXYZ']);
    });
  }
});

describe('an edit beside a split whose new paragraph is still arriving', () => {
  test('waits until the new paragraph is listed, and loses no text', async () => {
    const harness = harnessWith(CLIENT_ORDERS[0].ids);
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        ['Alpha beta', 'Second', 'Third', 'Fourth', 'Fifth'].map(paragraph).join('') + '<w:sectPr/>'
      )
    );
    // Carol reads Alice's updates, and Bob reads Carol's, by hand.
    const carol = await harness.joinDetached(alice, 'carol');
    alice.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'relay') Y.applyUpdate(carol.ydoc, update, 'relay');
    });
    const fromCarol: Uint8Array[] = [];
    carol.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'relay') return;
      fromCarol.push(update);
      Y.applyUpdate(alice.ydoc, update, 'relay');
    });
    const alpha = harness.paragraphIdAt(alice, 0);
    const fifth = harness.paragraphIdAt(alice, 4);
    // Alice splits "Alpha beta", and every peer shows the split.
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: alpha, offset: 6 }]);
    expect(texts(bob)).toEqual(['Alpha ', 'beta', 'Second', 'Third', 'Fourth', 'Fifth']);
    const tail = harness.paragraphIdAt(alice, 1);
    pause();
    // Alice moves "Fifth" above "Fourth", which Bob does not receive yet. Carol then moves the
    // new paragraph right after it: Bob can apply that move's removal of the old place, and
    // holds back its new place until Alice's move arrives.
    moveBlock(alice, fifth, 4);
    moveBlock(carol, tail, 4);
    expect(texts(carol)).toEqual(['Alpha ', 'Second', 'Third', 'Fifth', 'beta', 'Fourth']);
    for (const update of fromCarol) Y.applyUpdate(bob.ydoc, update, 'relay');
    // Bob shows the moved text where it came from, so an edit there waits.
    expect(texts(bob)).toEqual(['Alpha beta', 'Second', 'Third', 'Fourth', 'Fifth']);
    const deleteWord: TreeDocOp = { op: 'deleteText', paragraphId: alpha, start: 6, end: 10 };
    expect(bob.room.session.gateOperations([deleteWord], BODY)).not.toBeNull();
    // Alice's move arrives, and with it the new paragraph's place: the edit no longer waits.
    resume();
    expect(texts(bob)).toEqual(['Alpha ', 'Second', 'Third', 'Fifth', 'beta', 'Fourth']);
    expect(bob.room.session.gateOperations([deleteWord], BODY)).toBeNull();
    harness.expectConverged(alice, bob);
  });
});

describe('an undone table move whose separator a peer moved', () => {
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const identified = (id: string, text: string) =>
    `<w:p w14:paraId="${id}" w14:textId="${id}"><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const smallTable = (id: string, text: string) =>
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc>${identified(id, text)}</w:tc></w:tr></w:tbl>`;
  const DOCUMENT = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        identified('11111111', 'p0') +
        smallTable('22222222', 'T1') +
        identified('33333333', 'p1') +
        smallTable('44444444', 'T2') +
        '<w:sectPr/></w:body></w:document>'
    ),
  });

  test('keeps its paragraph identity, so a caret in it shows to the peer', async () => {
    const harness = harnessWith(CLIENT_ORDERS[0].ids);
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    const [, second] = elementIds(bob, 'tbl');
    const p1 = harness.paragraphIdAt(bob, 2);
    // Bob moves the second table above "p1": it would touch the first, so a separator goes in.
    harness.apply(bob, [{ op: 'moveTable', tableId: second!, beforeBlockId: p1 }]);
    const separator = bodyOf(alice).children.find(
      (node) => node.kind === 'paragraph' && nodeText(node) === ''
    );
    if (!separator) throw new Error('no separator');
    const paraId = paraIdOf(alice, separator.id);
    expect(paraId).not.toBeNull();
    pause();
    expect(bob.room.session.undo()).toBe(true);
    // Alice, who has not seen the undo, moves the separator to the top.
    moveBlock(alice, separator.id, 0);
    resume();
    harness.expectConverged(alice, bob);
    const top = bodyOf(bob).children[0]!;
    expect(top.id).toBe(separator.id);
    for (const peer of [alice, bob]) expect(paraIdOf(peer, separator.id)).toBe(paraId);
    // Alice types in it and puts her caret there; Bob shows the caret.
    harness.apply(alice, [
      { op: 'insertText', paragraphId: separator.id, offset: 0, text: 'typed' },
    ]);
    const point = { paragraphId: paraId!.toUpperCase(), offset: 5 };
    alice.room.session.setLocalSelection({ anchor: point, head: point });
    applyAwarenessUpdate(
      bob.awareness,
      encodeAwarenessUpdate(alice.awareness, [alice.awareness.clientID]),
      'relay'
    );
    const shown = bob.room.session.remoteSelections().find((s) => s.actorId === 'alice');
    expect(shown?.head).toMatchObject(point);
  });

  test('an undo with no concurrent move keeps only the created nodes attributes', async () => {
    const harness = harnessWith(CLIENT_ORDERS[0].ids);
    const { alice, bob } = await harness.pair(DOCUMENT);
    const [, second] = elementIds(bob, 'tbl');
    harness.apply(bob, [
      { op: 'moveTable', tableId: second!, beforeBlockId: harness.paragraphIdAt(bob, 2) },
    ]);
    const separator = bodyOf(bob).children.find(
      (node) => node.kind === 'paragraph' && nodeText(node) === ''
    );
    if (!separator) throw new Error('no separator');
    const paraId = paraIdOf(bob, separator.id);
    const attributes = bob.ydoc.getMap<string>(PACKAGE_ATTRIBUTES_KEY);
    const describing = () =>
      [...attributes.keys()].filter((key) => key.startsWith(`${separator.id}${FIELD_SEP}`));
    const before = describing();
    expect(before.length).toBeGreaterThan(0);
    expect(bob.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(bodyOf(alice).children.some((node) => node.id === separator.id)).toBe(false);
    // The record keeps its own attributes, and nothing more.
    expect(describing()).toEqual(before);
    expect(bob.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paraIdOf(alice, separator.id)).toBe(paraId);
  });
});

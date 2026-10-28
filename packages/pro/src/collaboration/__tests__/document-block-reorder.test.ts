/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One transaction that moves existing blocks among their siblings, as a table drag does: one
// child-list replacement in which every block keeps its id. Each peer must show exactly the
// order its author made, not only the same order as the other peer: a lost neighbour that
// every replica loses alike still converges.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  findNode,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  replaceChildren,
  TreePackageStore,
  withPart,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  BODY,
  createPeerHarness,
  nodeText,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

let harness = createPeerHarness('block-reorder-room');

afterEach(() => {
  harness.cleanup();
  harness = createPeerHarness('block-reorder-room');
});

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (text: string) =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr><w:tc>${paragraph(text)}</w:tc></w:tr></w:tbl>`;

/** `p0 p1 [T] p2 p3 p4`: a table with paragraphs on both sides, three below it. */
const BLOCKS = ['p0', 'p1', '[T]', 'p2', 'p3', 'p4'] as const;
const DOCUMENT = zipDocument(
  BLOCKS.map((name) => (name === '[T]' ? table('T') : paragraph(name))).join('') + '<w:sectPr/>'
);

type Element = Exclude<OoxmlNode, { kind: 'textValue' }>;

function bodyOf(peer: Peer): Element {
  const root = peer.store.bodyStore().part.root;
  const body = root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body;
}

/** The body's blocks by text, a table as `[text]`, as the peer shows them. */
function order(peer: Peer): string[] {
  return bodyOf(peer)
    .children.filter((node) => node.kind === 'paragraph' || node.kind === 'table')
    .map((node) => (node.kind === 'table' ? `[${nodeText(node)}]` : nodeText(node)));
}

function blockId(peer: Peer, name: string): string {
  const found = bodyOf(peer).children.find(
    (node) =>
      (node.kind === 'table' ? `[${nodeText(node)}]` : nodeText(node)) === name &&
      (node.kind === 'paragraph' || node.kind === 'table')
  );
  if (!found) throw new Error(`no block ${name}`);
  return found.id;
}

/** `order` with the block `name` moved to index `to`. */
function moved(list: readonly string[], name: string, to: number): string[] {
  const next = list.filter((entry) => entry !== name);
  next.splice(to, 0, name);
  return next;
}

/**
 * Reorder the body in ONE transaction: each move takes a block by name to an index among the
 * blocks, and the whole result is one child-list replacement.
 */
function reorder(peer: Peer, moves: readonly (readonly [string, number])[]): void {
  const result = peer.store.transact(BODY, (context) =>
    context.applyPackage((pkg) => {
      const part = pkg.parts.get(pkg.mainDocumentPart)!;
      const body = findNode(part, bodyOf(peer).id);
      if (!body || body.kind === 'textValue') throw new Error('no body');
      const children = [...body.children];
      for (const [name, to] of moves) {
        const id = blockId(peer, name);
        const from = children.findIndex((child) => child.id === id);
        const [block] = children.splice(from, 1);
        // Blocks come first in this body, so a block index is a child index.
        children.splice(to, 0, block!);
      }
      const edited = replaceChildren(part, body.id, children);
      if (!edited.ok) throw new Error('reorder refused');
      return withPart(pkg, edited.part);
    })
  );
  if (!result.ok) throw new Error(result.reason);
  peer.port.flushPendingJournals();
}

function expectBoth(alice: Peer, bob: Peer, expected: readonly string[]): void {
  expect(order(alice)).toEqual([...expected]);
  expect(order(bob)).toEqual([...expected]);
  harness.expectConverged(alice, bob);
}

describe('a block moved among its siblings in one transaction', () => {
  // Every distance up and down, for the table and for a paragraph, to every index.
  for (const name of ['[T]', 'p3'] as const) {
    const from = BLOCKS.indexOf(name);
    for (let to = 0; to < BLOCKS.length; to += 1) {
      if (to === from) continue;
      const label =
        to === 0
          ? 'to the first index'
          : to === BLOCKS.length - 1
            ? 'to the last index'
            : `${to < from ? 'up' : 'down'} by ${Math.abs(to - from)}`;
      test(`${name} ${label} keeps every block on both peers`, async () => {
        const { alice, bob } = await harness.pair(DOCUMENT);
        reorder(alice, [[name, to]]);
        expectBoth(alice, bob, moved(BLOCKS, name, to));
      });
    }
  }

  test('two moves in one transaction', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    reorder(alice, [
      ['[T]', 0],
      ['p4', 1],
    ]);
    expectBoth(alice, bob, ['[T]', 'p4', 'p0', 'p1', 'p2', 'p3']);
  });

  test('two blocks swapped across each other in one transaction', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    reorder(alice, [
      ['p3', 0],
      ['p0', 5],
    ]);
    expectBoth(alice, bob, ['p3', 'p1', '[T]', 'p2', 'p4', 'p0']);
  });

  test('typing inside the moved table at the same time survives the move', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    reorder(alice, [['[T]', 0]]);
    const cell = findNode(bob.store.bodyStore().part, blockId(bob, '[T]'))!;
    let cellParagraph = '';
    if (cell.kind !== 'textValue') {
      const visit = (node: OoxmlNode): void => {
        if (node.kind === 'paragraph' && !cellParagraph) cellParagraph = node.id;
        if (node.kind !== 'textValue') node.children.forEach(visit);
      };
      visit(cell);
    }
    harness.apply(bob, [{ op: 'insertText', paragraphId: cellParagraph, offset: 1, text: 'x' }]);
    resume();
    expectBoth(alice, bob, ['[Tx]', 'p0', 'p1', 'p2', 'p3', 'p4']);
  });

  test('a peer deleting a neighbour at the same time loses only that neighbour', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    reorder(alice, [['[T]', 0]]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: blockId(bob, 'p2') } as TreeDocOp]);
    resume();
    expectBoth(alice, bob, ['[T]', 'p0', 'p1', 'p3', 'p4']);
  });

  test('a peer typing into a neighbour at the same time keeps both edits', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    reorder(alice, [['[T]', 0]]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: blockId(bob, 'p2'), offset: 2, text: '!' },
    ]);
    resume();
    expectBoth(alice, bob, ['[T]', 'p0', 'p1', 'p2!', 'p3', 'p4']);
  });

  test('two peers moving the same table at the same time agree on one place', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    reorder(alice, [['[T]', 0]]);
    reorder(bob, [['[T]', 5]]);
    resume();
    expect(order(alice)).toEqual(order(bob));
    expect([...order(alice)].sort()).toEqual([...BLOCKS].sort());
    harness.expectConverged(alice, bob);
    // A later move from the agreed place lands where its author put it.
    reorder(bob, [['[T]', 2]]);
    expectBoth(alice, bob, moved(order(alice), '[T]', 2));
  });

  // Two concurrent moves of one block leave it listed twice, and peers show the first listing.
  // A later move must take the other listing along, or it shows again where the block was.
  for (const to of [0, 2, 4, 5]) {
    test(`a move to index ${to} after two concurrent moves of the same block`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
      pause();
      reorder(alice, [['[T]', 0]]);
      reorder(bob, [['[T]', 4]]);
      resume();
      const agreed = order(alice);
      expect(order(bob)).toEqual(agreed);
      reorder(alice, [['[T]', to]]);
      const first = moved(agreed, '[T]', to);
      expectBoth(alice, bob, first);
      reorder(bob, [['[T]', 5 - to]]);
      expectBoth(alice, bob, moved(first, '[T]', 5 - to));
    });
  }
});

describe('moveTable after two concurrent moves of the same table', () => {
  // `p0 p1 [T] p2 [U] p3`: a move of T before U needs an empty paragraph between the tables.
  const TWO_TABLES = zipDocument(
    [paragraph('p0'), paragraph('p1'), table('T'), paragraph('p2'), table('U'), paragraph('p3')]
      .join('')
      .concat('<w:sectPr/>')
  );

  // Both peers move T to the start at once, so the body lists it twice before the place it
  // moves to. The move removes both listings, so the separator it adds next must land between
  // the two tables.
  test('the separator lands between the tables on both peers', async () => {
    const { alice, bob, pause, resume } = await harness.pair(TWO_TABLES);
    pause();
    reorder(alice, [['[T]', 0]]);
    reorder(bob, [['[T]', 0]]);
    resume();
    expect(order(bob)).toEqual(order(alice));
    harness.apply(alice, [
      { op: 'moveTable', tableId: blockId(alice, '[T]'), beforeBlockId: blockId(alice, '[U]') },
    ]);
    const expected = ['p0', 'p1', 'p2', '[T]', '', '[U]', 'p3'];
    expectBoth(alice, bob, expected);
    const late = await harness.join(alice, 'late');
    expect(order(late)).toEqual(expected);
    expect(alice.room.session.undo()).toBe(true);
    expect(order(alice)).toEqual(order(bob));
    expect(order(alice).filter((name) => name === '[T]')).toEqual(['[T]']);
    harness.expectConverged(alice, bob);
  });
});

describe('properties a formatting edit puts back in schema order', () => {
  // A formatting edit writes paragraph and run properties in schema order. Properties
  // authored out of order then move toward the start of their container, the same reorder
  // as a block moved up, inside one transaction with the formatting change.
  const OUT_OF_ORDER = zipDocument(
    '<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720"/><w:spacing w:after="0"/>' +
      '<w:keepNext/><w:pStyle w:val="Heading1"/></w:pPr>' +
      '<w:r><w:rPr><w:u w:val="single"/><w:i/><w:color w:val="FF0000"/><w:b/></w:rPr>' +
      '<w:t>Out of order</w:t></w:r></w:p><w:sectPr/>'
  );

  /** The children of every `localName` container in the body, by name, in order. */
  const names = (root: OoxmlNode, localName: 'pPr' | 'rPr'): string[] => {
    const found: string[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === localName) {
        for (const child of node.children) {
          if (child.kind !== 'textValue') found.push(child.localName);
        }
        return;
      }
      node.children.forEach(visit);
    };
    visit(root);
    return found;
  };

  /** The same op on a plain store, with no collaboration attached. */
  const plainResult = (op: TreeDocOp, localName: 'pPr' | 'rPr'): string[] => {
    const loaded = readOoxmlPackage(OUT_OF_ORDER);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const paragraph = names(store.bodyStore().part.root, localName);
    const result = store.transact(BODY, (context) => context.apply(op));
    if (!result.ok) throw new Error(result.reason);
    const after = names(store.bodyStore().part.root, localName);
    // The edit must reorder what it keeps, or this test checks nothing.
    expect(after).not.toEqual(paragraph);
    return after;
  };

  const cases: readonly [string, 'pPr' | 'rPr', (paragraphId: string) => TreeDocOp][] = [
    [
      'a paragraph property edit',
      'pPr',
      (paragraphId) =>
        ({
          op: 'setParagraphProperties',
          paragraphId,
          properties: [
            { localName: 'pStyle', attributes: { val: 'Heading1' } },
            { localName: 'keepNext' },
            { localName: 'spacing', attributes: { after: '0' } },
            { localName: 'ind', attributes: { left: '720' } },
            { localName: 'jc', attributes: { val: 'right' } },
          ],
        }) as TreeDocOp,
    ],
    [
      'a run property edit',
      'rPr',
      (paragraphId) =>
        ({
          op: 'setRunProperties',
          paragraphId,
          start: 0,
          end: 12,
          properties: [
            { localName: 'u', attributes: { val: 'single' } },
            { localName: 'i' },
            { localName: 'color', attributes: { val: 'FF0000' } },
            { localName: 'b' },
            { localName: 'strike' },
          ],
        }) as TreeDocOp,
    ],
  ];
  for (const [label, localName, opFor] of cases) {
    test(`${label} leaves both peers with the properties a plain store keeps`, async () => {
      const { alice, bob } = await harness.pair(OUT_OF_ORDER);
      const op = opFor(harness.paragraphIdAt(alice, 0));
      harness.apply(alice, [op]);
      const expected = plainResult(opFor(harness.paragraphIdAt(alice, 0)), localName);
      expect(names(bodyOf(alice), localName)).toEqual(expected);
      expect(names(bodyOf(bob), localName)).toEqual(expected);
      harness.expectConverged(alice, bob);
    });
  }
});

describe('undo, redo, remount, and late join of a block move', () => {
  test('undo and redo of a move restore each order on both peers', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    reorder(alice, [['[T]', 0]]);
    expectBoth(alice, bob, moved(BLOCKS, '[T]', 0));
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(alice, bob, BLOCKS);
    expect(alice.room.session.redo()).toBe(true);
    expectBoth(alice, bob, moved(BLOCKS, '[T]', 0));
  });

  test('a remounted peer and a late joiner show the moved order', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    reorder(alice, [
      ['[T]', 0],
      ['p4', 2],
    ]);
    const expected = ['[T]', 'p0', 'p4', 'p1', 'p2', 'p3'];
    expectBoth(alice, bob, expected);
    const remounted = await harness.remount(bob);
    expect(order(remounted)).toEqual(expected);
    const late = await harness.join(alice, 'late');
    expect(order(late)).toEqual(expected);
    harness.expectConverged(alice, late);
  });
});

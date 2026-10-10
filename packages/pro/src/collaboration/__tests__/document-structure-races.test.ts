/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants edit the same structure at the same time: formatting, inline objects,
// lists, tables, links, images, text boxes, and undo. Every race must converge, keep each
// participant's typing unless the other deleted its container, match a participant who
// joins afterwards, and survive save and reopen.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { resolve } from 'node:path';
import { addPackageComment, type OoxmlNode, type TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import { readNodeShell } from '../document/schema.ts';

const harness = createPeerHarness('structure-races-room');

afterEach(() => {
  harness.cleanup();
});

const SAMPLE = new Uint8Array(
  readFileSync(resolve(import.meta.dir, '../../../../../examples/vite/public/sample.docx'))
);
const TEXT_BOX = new Uint8Array(
  readFileSync(
    resolve(import.meta.dir, '../../../../../e2e/fixtures/issue-472-floating-textbox.docx')
  )
);

function nodes(peer: Peer, localName: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found.push(node);
  });
  return found;
}

function text(peer: Peer): string {
  return nodeText(peer.store.bodyStore().part.root);
}

/** A paragraph inside `container`, the first with text. */
function paragraphIn(container: OoxmlNode): OoxmlNode {
  let found: OoxmlNode | null = null;
  walk(container, (node) => {
    if (!found && node.kind === 'paragraph') found = node;
  });
  if (!found) throw new Error('no paragraph');
  return found;
}

function paragraphTexts(peer: Peer): string[] {
  return nodes(peer, 'p').map(nodeText);
}

function textLength(paragraph: OoxmlNode): number {
  return nodeText(paragraph).length;
}

/** Alice and Bob edit at once; returns both, after a late joiner matched them. */
async function race(
  bytes: Uint8Array,
  alice: (peer: Peer) => TreeDocOp[],
  bob: (peer: Peer) => TreeDocOp[]
): Promise<{ alice: Peer; bob: Peer }> {
  const pair = await harness.pair(bytes);
  pair.pause();
  harness.apply(pair.alice, alice(pair.alice));
  harness.apply(pair.bob, bob(pair.bob));
  pair.resume();
  expect(pair.alice.room.session.status()).toBe('ready');
  expect(pair.bob.room.session.status()).toBe('ready');
  harness.expectConverged(pair.alice, pair.bob);
  const late = await harness.join(pair.alice, 'late');
  harness.expectConverged(pair.alice, late);
  return pair;
}

const ONE_RUN = zipDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>');
const at = (peer: Peer) => harness.paragraphIdAt(peer, 0);

describe('formatting races', () => {
  test('clearing formatting while a peer formats an overlapping range converges', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [
        {
          op: 'setRunProperties',
          paragraphId: at(p),
          start: 0,
          end: 8,
          properties: [{ localName: 'b' }],
        },
      ],
      (p) => [{ op: 'setRunProperties', paragraphId: at(p), start: 4, end: 11, properties: [] }]
    );
    expect(text(alice)).toBe('Hello world');
  });

  test('two formats over overlapping ranges both land where they overlap', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [
        {
          op: 'setRunProperties',
          paragraphId: at(p),
          start: 0,
          end: 7,
          properties: [{ localName: 'b' }],
        },
      ],
      (p) => [
        {
          op: 'setRunProperties',
          paragraphId: at(p),
          start: 3,
          end: 11,
          properties: [{ localName: 'i' }],
        },
      ]
    );
    const overlap = nodes(alice, 'r').find((run) => nodeText(run).startsWith('lo'));
    const names = new Set<string>();
    if (overlap) walk(overlap, (node) => node.kind !== 'textValue' && names.add(node.localName));
    expect([...names]).toEqual(expect.arrayContaining(['b', 'i']));
    expect(text(alice)).toBe('Hello world');
  });
});

describe('inline object races', () => {
  test('typing right after a tab a peer deletes keeps the typing', async () => {
    const bytes = zipDocument(
      '<w:p><w:r><w:t>One</w:t><w:tab/><w:t>Two</w:t></w:r></w:p><w:sectPr/>'
    );
    const { alice } = await race(
      bytes,
      (p) => [{ op: 'deleteText', paragraphId: at(p), start: 3, end: 4 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 4, text: 'X' }]
    );
    expect(text(alice)).toBe('OneXTwo');
    expect(nodes(alice, 'tab')).toHaveLength(0);
  });

  test('typing after a line break in a run a peer deletes whole keeps the typing', async () => {
    const bytes = zipDocument(
      '<w:p><w:r><w:t>Keep </w:t></w:r><w:r><w:t>gone</w:t><w:br/><w:t>too</w:t></w:r></w:p><w:sectPr/>'
    );
    const { alice } = await race(
      bytes,
      (p) => [{ op: 'deleteText', paragraphId: at(p), start: 5, end: 13 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 10, text: 'Y' }]
    );
    expect(text(alice)).toBe('Keep Y');
  });
});

describe('list races', () => {
  test('two peers put one paragraph in different lists: one list, one numbering', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [{ op: 'setListNumbering', paragraphId: at(p), numId: '1', level: 0 }],
      (p) => [{ op: 'setListNumbering', paragraphId: at(p), numId: '2', level: 1 }]
    );
    expect(nodes(alice, 'numPr')).toHaveLength(1);
  });

  test('a list level change and typing in the same paragraph both apply', async () => {
    const pair = await harness.pair(SAMPLE);
    const listed = nodes(pair.alice, 'p').find((paragraph) => {
      let numbered = false;
      walk(
        paragraph,
        (node) => (numbered ||= node.kind !== 'textValue' && node.localName === 'numPr')
      );
      return numbered;
    })!;
    pair.pause();
    harness.apply(pair.alice, [{ op: 'setListLevel', paragraphId: listed.id, level: 2 }]);
    harness.apply(pair.bob, [{ op: 'insertText', paragraphId: listed.id, offset: 0, text: 'Z' }]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    const after = nodes(pair.bob, 'p').find((paragraph) => paragraph.id === listed.id)!;
    expect(nodeText(after).startsWith('Z')).toBe(true);
    const level = nodes(pair.bob, 'ilvl').find(() => true);
    expect(level).toBeDefined();
  });
});

describe('table races', () => {
  async function tablePair() {
    const pair = await harness.pair(SAMPLE);
    const table = nodes(pair.alice, 'tbl')[0]!;
    const row = nodes(pair.alice, 'tr').find((candidate) => {
      let inside = false;
      walk(table, (node) => (inside ||= node.id === candidate.id));
      return inside;
    })!;
    return { ...pair, table, row, cellParagraph: paragraphIn(row) };
  }

  test('typing in a cell while a peer inserts a row above keeps the typing', async () => {
    const { alice, bob, pause, resume, table, row, cellParagraph } = await tablePair();
    pause();
    harness.apply(alice, [
      { op: 'insertTableRow', tableId: table.id, rowId: row.id, where: 'above' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: cellParagraph.id, offset: 0, text: 'cellX' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(text(alice)).toContain('cellX');
  });

  test('typing in a cell while a peer inserts a column keeps the typing', async () => {
    const { alice, bob, pause, resume, table, cellParagraph } = await tablePair();
    const column = nodes(alice, 'gridCol').find((candidate) => {
      let inside = false;
      walk(table, (node) => (inside ||= node.id === candidate.id));
      return inside;
    })!;
    pause();
    harness.apply(alice, [
      { op: 'insertTableColumn', tableId: table.id, gridColumnId: column.id, where: 'right' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: cellParagraph.id, offset: 0, text: 'colX' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(text(alice)).toContain('colX');
  });

  test('deleting a row while a peer types in it converges on the deletion', async () => {
    const { alice, bob, pause, resume, table, row, cellParagraph } = await tablePair();
    pause();
    harness.apply(alice, [{ op: 'deleteTableRow', tableId: table.id, rowId: row.id }]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: cellParagraph.id, offset: 0, text: 'rowX' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(nodes(alice, 'tr').some((candidate) => candidate.id === row.id)).toBe(false);
  });
});

describe('link races', () => {
  test('linking a range while a peer types inside it keeps the typing', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [{ op: 'insertHyperlink', paragraphId: at(p), start: 0, end: 5, anchor: 'top' }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 2, text: 'Q' }]
    );
    expect(text(alice)).toBe('HeQllo world');
    expect(nodes(alice, 'hyperlink')).toHaveLength(1);
  });

  test('removing a link while a peer types inside it keeps the typing', async () => {
    const bytes = zipDocument(
      '<w:p><w:hyperlink w:anchor="top"><w:r><w:t>Linked</w:t></w:r></w:hyperlink><w:r><w:t> text</w:t></w:r></w:p><w:sectPr/>'
    );
    const pair = await harness.pair(bytes);
    const link = nodes(pair.alice, 'hyperlink')[0]!;
    pair.pause();
    harness.apply(pair.alice, [{ op: 'removeHyperlink', linkId: link.id }]);
    harness.apply(pair.bob, [
      { op: 'insertText', paragraphId: at(pair.bob), offset: 3, text: 'W' },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(text(pair.alice)).toBe('LinWked text');
  });
});

describe('image races', () => {
  test('two peers resize one image: one size on every replica', async () => {
    const pair = await harness.pair(SAMPLE);
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    pair.pause();
    harness.apply(pair.alice, [
      { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 900_000, cy: 600_000 } },
    ]);
    harness.apply(pair.bob, [
      { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 1_200_000, cy: 800_000 } },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(nodes(pair.alice, 'drawing')).toHaveLength(nodes(pair.bob, 'drawing').length);
  });

  test('deleting an image while a peer resizes it converges on the deletion', async () => {
    const pair = await harness.pair(SAMPLE);
    const before = nodes(pair.alice, 'drawing').length;
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    pair.pause();
    harness.apply(pair.alice, [{ op: 'deleteDrawing', drawingNodeId: drawing.id }]);
    harness.apply(pair.bob, [
      { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 700_000, cy: 700_000 } },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(nodes(pair.alice, 'drawing')).toHaveLength(before - 1);
  });

  test('splitting the paragraph of an image while a peer resizes it shows the image once', async () => {
    const pair = await harness.pair(SAMPLE);
    const before = nodes(pair.alice, 'drawing').length;
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    const paragraph = nodes(pair.alice, 'p').find((candidate) => {
      let inside = false;
      walk(candidate, (node) => (inside ||= node.id === drawing.id));
      return inside;
    })!;
    pair.pause();
    harness.apply(pair.alice, [{ op: 'splitParagraph', paragraphId: paragraph.id, offset: 0 }]);
    harness.apply(pair.bob, [
      { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 800_000, cy: 500_000 } },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(nodes(pair.alice, 'drawing')).toHaveLength(before);
  });
});

describe('text box races', () => {
  test('two moves of one floating drawing, both undone, leave a valid position', async () => {
    const { alice, bob } = await harness.pair(TEXT_BOX);
    const drawing = nodes(alice, 'drawing')[0]!;
    harness.apply(bob, [
      {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 2_037_550, verticalEmu: 197_240 },
      },
    ]);
    harness.apply(alice, [
      {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 8_112, verticalEmu: 2_423_726 },
      },
    ]);
    expect(alice.room.session.undo()).toBe(true);
    expect(bob.room.session.undo()).toBe(true);
    expect(alice.room.session.statusSnapshot().reason).toBeUndefined();
    expect(bob.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(alice, bob);
    expect(nodes(alice, 'posOffset').every((offset) => nodeText(offset).length > 0)).toBe(true);
  });

  test('two peers change the wrap of one picture: one wrap on every replica', async () => {
    const pair = await harness.pair(SAMPLE);
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    pair.pause();
    harness.apply(pair.alice, [
      { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'square' },
    ]);
    harness.apply(pair.bob, [{ op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'tight' }]);
    pair.resume();
    expect(pair.alice.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(pair.alice, pair.bob);
    const late = await harness.join(pair.alice, 'late');
    harness.expectConverged(pair.alice, late);
  });

  test('two peers resize and move one floating drawing at once: both apply', async () => {
    const pair = await harness.pair(TEXT_BOX);
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    pair.pause();
    harness.apply(pair.alice, [
      { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 900_000, cy: 700_000 } },
    ]);
    harness.apply(pair.bob, [
      {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 100_000, verticalEmu: 200_000 },
      },
    ]);
    pair.resume();
    expect(pair.alice.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(pair.alice, pair.bob);
  });

  test('two peers move one floating drawing: one position on every replica', async () => {
    const pair = await harness.pair(TEXT_BOX);
    const drawing = nodes(pair.alice, 'drawing')[0]!;
    pair.pause();
    harness.apply(pair.alice, [
      {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 2_239_080, verticalEmu: 3_694_774 },
      },
    ]);
    harness.apply(pair.bob, [
      {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { horizontalEmu: 2_458_588, verticalEmu: 2_119_440 },
      },
    ]);
    pair.resume();
    expect(pair.alice.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(pair.alice, pair.bob);
    expect(nodes(pair.alice, 'positionH')).toHaveLength(nodes(pair.bob, 'positionH').length);
  });

  test('two peers type into one text box paragraph: both texts stay', async () => {
    const pair = await harness.pair(TEXT_BOX);
    const box = nodes(pair.alice, 'txbxContent')[0]!;
    const inside = paragraphIn(box);
    const length = textLength(inside);
    pair.pause();
    harness.apply(pair.alice, [
      { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'AA' },
    ]);
    harness.apply(pair.bob, [
      { op: 'insertText', paragraphId: inside.id, offset: length, text: 'BB' },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    const after = nodes(pair.alice, 'p').find((candidate) => candidate.id === inside.id)!;
    expect(nodeText(after).startsWith('AA')).toBe(true);
    expect(nodeText(after).endsWith('BB')).toBe(true);
  });
});

describe('undo races', () => {
  test('undoing a format after a peer typed inside the range keeps the typing', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: at(alice),
        start: 0,
        end: 5,
        properties: [{ localName: 'b' }],
      },
    ]);
    alice.room.session.flushPendingJournals();
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob), offset: 2, text: 'K' }]);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(text(bob)).toBe('HeKllo world');
    expect(nodes(bob, 'b')).toHaveLength(0);
  });

  test('redo after a peer edit converges', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    harness.apply(alice, [{ op: 'deleteText', paragraphId: at(alice), start: 0, end: 6 }]);
    alice.room.session.flushPendingJournals();
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob), offset: 11, text: '!' }]);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(text(alice)).toBe('world!');
  });

  test('undoing a split after a peer typed in the new paragraph keeps the typing', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice), offset: 5 }]);
    alice.room.session.flushPendingJournals();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 1, text: 'N' },
    ]);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(text(bob)).toContain('N');
  });

  test('undoing a split after a peer typed at the start of the new paragraph keeps the typing', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice), offset: 5 }]);
    alice.room.session.flushPendingJournals();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'S' },
    ]);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(text(bob)).toBe('HelloS world');
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
  });

  test('undoing a split while a peer types in the new paragraph keeps the typing', async () => {
    const pair = await harness.pair(ONE_RUN);
    harness.apply(pair.alice, [{ op: 'splitParagraph', paragraphId: at(pair.alice), offset: 5 }]);
    pair.alice.room.session.flushPendingJournals();
    pair.pause();
    harness.apply(pair.bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(pair.bob, 1), offset: 3, text: 'C' },
    ]);
    expect(pair.alice.room.session.undo()).toBe(true);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(text(pair.alice)).toBe('Hello woCrld');
    expect(pair.alice.room.session.redo()).toBe(true);
    harness.expectConverged(pair.alice, pair.bob);
    expect(text(pair.bob)).toBe('Hello woCrld');
  });
});

const TWO = zipDocument(
  '<w:p><w:r><w:t>Alpha one</w:t></w:r></w:p><w:p><w:r><w:t>Beta two</w:t></w:r></w:p><w:sectPr/>'
);

describe('paragraph races', () => {
  test('typing into a cell of a row a peer inserted writes shared text, not run records', async () => {
    const pair = await harness.pair(SAMPLE);
    const { alice, bob } = pair;
    const table = nodes(alice, 'tbl')[0]!;
    const row = nodes(alice, 'tr').find((candidate) => {
      let inside = false;
      walk(table, (node) => (inside ||= node.id === candidate.id));
      return inside;
    })!;
    harness.apply(alice, [
      { op: 'insertTableRow', tableId: table.id, rowId: row.id, where: 'above' },
    ]);
    const added = nodes(bob, 'tr').find(
      (candidate) => candidate.id !== row.id && nodeText(candidate) === ''
    )!;
    const cell = paragraphIn(added);
    harness.apply(bob, [{ op: 'insertText', paragraphId: cell.id, offset: 0, text: 'cell text' }]);
    harness.apply(alice, [{ op: 'insertText', paragraphId: cell.id, offset: 4, text: '!' }]);
    harness.expectConverged(alice, bob);
    const shared = bob.ydoc.getMap('docx-package-nodes-v1');
    const record = shared.get(cell.id) as Y.Map<unknown>;
    expect(record.get('inline')).toBeInstanceOf(Y.Text);
    for (const child of (record.get('children') as Y.Array<string> | undefined)?.toArray() ?? []) {
      expect(readNodeShell(shared.get(child) as Y.Map<unknown>).kind).not.toBe('run');
    }
    expect(nodeText(nodes(alice, 'p').find((paragraph) => paragraph.id === cell.id)!)).toBe(
      'cell! text'
    );
  });

  test('joining two paragraphs while a peer bolds the second converges', async () => {
    // The join copies the text as it stood. Formatting that a peer applies at the same time
    // to the text it copies does not reach the copy: the documented limit.
    const { alice } = await race(
      TWO,
      (p) => [{ op: 'joinParagraphs', firstId: at(p), secondId: harness.paragraphIdAt(p, 1) }],
      (p) => [
        {
          op: 'setRunProperties',
          paragraphId: harness.paragraphIdAt(p, 1),
          start: 0,
          end: 4,
          properties: [{ localName: 'b' }],
        },
      ]
    );
    expect(text(alice)).toBe('Alpha oneBeta two');
  });

  test('typing at the end of a paragraph after a known Enter stays in that paragraph', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice), offset: 5 }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob), offset: 5, text: 'Z' }]);
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(alice)).toEqual(['HelloZ', ' world']);
    const late = await harness.join(alice, 'late');
    expect(paragraphTexts(late)).toEqual(['HelloZ', ' world']);
  });

  test('typing at the end of a tail a peer moves with Enter follows the tail', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 11, text: '!' }]
    );
    expect(paragraphTexts(alice)).toEqual(['Hello', ' world!']);
  });

  test('typing after deleted text while a peer moves the text around it keeps its place', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [
        { op: 'deleteText', paragraphId: at(p), start: 6, end: 9 },
        { op: 'insertText', paragraphId: at(p), offset: 6, text: 'XY' },
      ]
    );
    expect(paragraphTexts(alice).join('|')).toContain('XY');
  });

  test('deleting across two paragraphs while a peer types in the second keeps the typing', async () => {
    const { alice } = await race(
      TWO,
      (p) => [
        { op: 'deleteText', paragraphId: at(p), start: 5, end: 9 },
        { op: 'deleteText', paragraphId: harness.paragraphIdAt(p, 1), start: 0, end: 4 },
        { op: 'joinParagraphs', firstId: at(p), secondId: harness.paragraphIdAt(p, 1) },
      ],
      (p) => [{ op: 'insertText', paragraphId: harness.paragraphIdAt(p, 1), offset: 8, text: '!' }]
    );
    expect(text(alice)).toBe('Alpha two!');
  });

  test('deleting a paragraph while a peer types in it converges on the deletion', async () => {
    const { alice } = await race(
      TWO,
      (p) => [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(p, 1) }],
      (p) => [{ op: 'insertText', paragraphId: harness.paragraphIdAt(p, 1), offset: 0, text: 'Z' }]
    );
    expect(text(alice)).toBe('Alpha one');
  });

  test('two peers split the same paragraph at different places', async () => {
    const { alice } = await race(
      TWO,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 2 }],
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 6 }]
    );
    expect(text(alice)).toBe('Alpha oneBeta two');
    expect(nodes(alice, 'p')).toHaveLength(4);
  });
});

describe('inline insert races', () => {
  test('a page break and typing at one offset both land', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [{ op: 'insertPageBreak', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 5, text: 'P' }]
    );
    expect(text(alice)).toContain('HelloP');
    expect(nodes(alice, 'br')).toHaveLength(1);
  });

  test('two content controls at one offset both land once', async () => {
    const { alice } = await race(
      ONE_RUN,
      (p) => [
        { op: 'insertInlineContentControl', paragraphId: at(p), offset: 5, tag: 'a', text: 'AA' },
      ],
      (p) => [
        { op: 'insertInlineContentControl', paragraphId: at(p), offset: 5, tag: 'b', text: 'BB' },
      ]
    );
    expect(nodes(alice, 'sdt')).toHaveLength(2);
    expect(text(alice)).toContain('AA');
    expect(text(alice)).toContain('BB');
  });

  test('setting a content control value while a peer types after it keeps both', async () => {
    const bytes = zipDocument(
      '<w:p><w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent><w:r><w:t>old</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t> tail</w:t></w:r></w:p><w:sectPr/>'
    );
    const pair = await harness.pair(bytes);
    const control = nodes(pair.alice, 'sdt')[0]!;
    pair.pause();
    harness.apply(pair.alice, [
      { op: 'setContentControlValue', controlId: control.id, value: 'new' },
    ]);
    harness.apply(pair.bob, [
      { op: 'insertText', paragraphId: at(pair.bob), offset: 8, text: '!' },
    ]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(text(pair.alice)).toBe('new tail!');
  });

  test('two footnotes in one paragraph both land', async () => {
    const pair = await harness.pair(SAMPLE);
    const paragraph = nodes(pair.alice, 'p').find((candidate) => textLength(candidate) > 10)!;
    const before = nodes(pair.alice, 'footnoteReference').length;
    pair.pause();
    // A note adds to the notes part, so the package applies it, not a story transaction.
    const note = (peer: Peer, offset: number) => {
      const result = peer.store.applyLifecycleOp({
        op: 'insertNote',
        noteKind: 'footnote',
        paragraphId: paragraph.id,
        offset,
      });
      expect(result.ok).toBe(true);
      peer.port.flushPendingJournals();
    };
    note(pair.alice, 2);
    note(pair.bob, 6);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    expect(nodes(pair.alice, 'footnoteReference')).toHaveLength(before + 2);
  });
});

describe('replayed fuzzer cases', () => {
  test('a split after a join and a remote tab keeps every node for a peer that gets the split before the tab', async () => {
    const { alice, bob } = await harness.pair(SAMPLE);
    const initial = new Y.Doc();
    Y.applyUpdate(initial, Y.encodeStateAsUpdate(alice.ydoc));
    const own = (peer: Peer) => {
      const updates: Uint8Array[] = [];
      peer.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== 'relay' && origin !== 'join') updates.push(update);
      });
      return updates;
    };
    const fromAlice = own(alice);
    const fromBob = own(bob);
    const first = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [
      { op: 'joinParagraphs', firstId: first, secondId: harness.paragraphIdAt(alice, 1) },
    ]);
    harness.apply(bob, [{ op: 'insertTab', paragraphId: first, offset: 16 }]);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: first, offset: 15 }]);
    harness.expectConverged(alice, bob);
    const carol = await harness.join({ ydoc: initial } as Peer, 'carol');
    // The split embeds the tab, whose record is in an update that has not arrived yet.
    for (const update of [...fromAlice, ...fromBob]) {
      Y.applyUpdate(carol.ydoc, update, 'relay');
      expect(carol.room.session.statusSnapshot().reason?.code).toBeUndefined();
    }
    harness.expectConverged(alice, carol);
  });

  test('a resize that arrives before the typing it follows heals for a peer that gets it all at once', async () => {
    const pair = await harness.pair(SAMPLE);
    const { alice, bob } = pair;
    const initial = new Y.Doc();
    Y.applyUpdate(initial, Y.encodeStateAsUpdate(alice.ydoc));
    const own = (peer: Peer) => {
      const updates: Uint8Array[] = [];
      peer.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== 'relay' && origin !== 'join') updates.push(update);
      });
      return updates;
    };
    const fromAlice = own(alice);
    const fromBob = own(bob);
    pair.pause();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 4), offset: 0, text: 'lor' },
    ]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 1), offset: 12, text: 'lore' },
    ]);
    pair.resume();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 12, text: 'lo' },
    ]);
    const drawing = nodes(bob, 'drawing')[0]!;
    harness.apply(bob, [
      {
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: 1_348_443, cy: 1_180_995 },
      },
    ]);
    harness.expectConverged(alice, bob);
    const carol = await harness.join({ ydoc: initial } as Peer, 'carol');
    for (const update of [...fromBob, ...fromAlice]) Y.applyUpdate(carol.ydoc, update, 'relay');
    expect(carol.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(alice, carol);
  });

  test('a comment whose text holds the commented letters moves nothing into the comment', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Document Version: 2.0</w:t></w:r></w:p><w:sectPr/>')
    );
    const result = addPackageComment(alice.store, {
      anchor: { paragraphId: at(alice), start: 4, end: 8 },
      author: 'Reviewer',
      text: 'comment',
      actorId: 'alice',
    });
    expect(result.ok).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['Document Version: 2.0']);
    const late = await harness.join(alice, 'late');
    expect(paragraphTexts(late)).toEqual(['Document Version: 2.0']);
  });

  test('two first comments at once, then an undo of one, leave a valid comments part', async () => {
    const pair = await harness.pair(TEXT_BOX);
    const { alice, bob } = pair;
    const comment = (peer: Peer, paragraphId: string, start: number, end: number) => {
      const result = addPackageComment(peer.store, {
        anchor: { paragraphId, start, end },
        author: 'Reviewer',
        text: 'comment',
        actorId: peer === alice ? 'alice' : 'bob',
      });
      expect(result.ok).toBe(true);
      peer.port.flushPendingJournals();
    };
    const boxed = paragraphIn(nodes(alice, 'txbxContent')[0]!);
    const first = nodes(alice, 'p').find((paragraph) => textLength(paragraph) > 4)!;
    pair.pause();
    comment(alice, boxed.id, 1, 2);
    comment(bob, first.id, 1, 3);
    pair.resume();
    expect(bob.room.session.undo()).toBe(true);
    expect(alice.room.session.statusSnapshot().reason).toBeUndefined();
    expect(bob.room.session.statusSnapshot().reason?.code).toBeUndefined();
    harness.expectConverged(alice, bob);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
    // The comment nobody undid keeps its part.
    const comments = late.store.currentPackage().parts.get('/word/comments.xml');
    expect(comments).toBeDefined();
    let count = 0;
    walk(comments!.root, (node) => {
      if (node.kind !== 'textValue' && node.localName === 'comment') count += 1;
    });
    expect(count).toBe(1);
  });

  test('undoing and redoing a comment removes it and brings it back on every replica', async () => {
    const { alice, bob } = await harness.pair(ONE_RUN);
    const count = (peer: Peer): number => {
      const part = peer.store.currentPackage().parts.get('/word/comments.xml');
      let found = 0;
      if (part) {
        walk(part.root, (node) => {
          if (node.kind !== 'textValue' && node.localName === 'comment') found += 1;
        });
      }
      return found;
    };
    const result = addPackageComment(alice.store, {
      anchor: { paragraphId: at(alice), start: 0, end: 5 },
      author: 'Reviewer',
      text: 'note',
      actorId: 'alice',
    });
    expect(result.ok).toBe(true);
    alice.port.flushPendingJournals();
    expect(count(bob)).toBe(1);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(count(bob)).toBe(0);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(count(bob)).toBe(1);
    const late = await harness.join(alice, 'late');
    expect(count(late)).toBe(1);
  });
});

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers who each give one row or cell a property at once. Each can write the row its own
// `w:trPr`, or the cell its own `w:tcPr` or `w:vAlign`, and the merge keeps both. Every
// replica shows the same merge, and a save writes one container per row and cell, in schema
// order, whichever peer's insert lands first. A late joiner and a reopen agree.
import { afterEach, describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

/** Both concurrent insert orders: Alice's client id below Bob's, then above it. */
const ORDERS = [
  { alice: 1, bob: 2 },
  { alice: 2, bob: 1 },
] as const;

const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const ROW_BARE = '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>';
const ROW_HELD =
  '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>' +
  '</w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>';
const table = (row: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${row}</w:tbl><w:p/><w:sectPr/>`;

/** The ids of the table, its row, and its cell. */
function idsOf(peer: Peer): { table: string; row: string; cell: string } {
  const found: Record<string, string> = {};
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (['tbl', 'tr', 'tc'].includes(node.localName)) found[node.localName] ??= node.id;
    node.children.forEach(visit);
  };
  visit(peer.store.bodyStore().part.root);
  return { table: found.tbl!, row: found.tr!, cell: found.tc! };
}

/** The saved table row. */
const savedRow = (peer: Peer): string => {
  const xml = serializeOoxmlPart(peer.store.bodyStore().part);
  return xml.slice(xml.indexOf('<w:tr>'), xml.indexOf('</w:tr>'));
};

async function concurrent(
  row: string,
  order: (typeof ORDERS)[number],
  aliceOps: (ids: ReturnType<typeof idsOf>) => TreeDocOp[],
  bobOps: (ids: ReturnType<typeof idsOf>) => TreeDocOp[]
) {
  const harness = createPeerHarness('table-property-containers-room', undefined, order);
  harnesses.push(harness);
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(table(row)));
  const ids = idsOf(alice);
  pause();
  harness.apply(alice, aliceOps(ids));
  harness.apply(bob, bobOps(ids));
  resume();
  harness.expectConverged(alice, bob);
  expect(savedRow(bob)).toBe(savedRow(alice));
  // A late joiner reads the shared state the same way.
  const late = await harness.join(alice, 'late');
  harness.expectConverged(alice, late);
  // The saved part reopens to the row it saved.
  const part = alice.store.bodyStore().part;
  const reopened = readOoxmlPart(serializeOoxmlPart(part), {
    name: part.name,
    contentType: part.contentType,
  });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(serializeOoxmlPart(reopened.part)).toBe(serializeOoxmlPart(part));
  return { alice, bob, harness, saved: savedRow(alice) };
}

for (const order of ORDERS)
  describe(`Alice's client id ${order.alice}, Bob's ${order.bob}`, () => {
    test('a row height and a header row on a row with no w:trPr save as one w:trPr', async () => {
      const { saved } = await concurrent(
        ROW_BARE,
        order,
        ({ table: tableId, row: rowId }) => [
          { op: 'setTableRowHeight', tableId, rowId, heightTwips: 400 },
        ],
        ({ table: tableId }) => [{ op: 'setTableProperties', tableId, headerRowCount: 1 }]
      );
      expect(saved.split('<w:trPr>').length - 1).toBe(1);
      expect(saved).toContain('<w:trHeight w:hRule="exact" w:val="400"/>');
      expect(saved).toContain('<w:tblHeader w:val="1"/>');
    });

    test('a fill and an alignment on a cell with no w:tcPr save as one w:tcPr in order', async () => {
      const { saved } = await concurrent(
        ROW_BARE,
        order,
        ({ table: tableId, cell }) => [
          { op: 'setTableCellVerticalAlignment', tableId, cellIds: [cell], alignment: 'center' },
        ],
        ({ table: tableId, cell }) => [
          {
            op: 'setTableCellFill',
            tableId,
            cellIds: [cell],
            color: { kind: 'hex', value: 'FF0000' },
          },
        ]
      );
      expect(saved).toContain(
        '<w:tcPr><w:shd w:fill="FF0000" w:val="clear"/><w:vAlign w:val="center"/></w:tcPr>'
      );
    });

    test('two alignments on one w:tcPr save as one, and the other properties keep their order', async () => {
      const { saved } = await concurrent(
        ROW_HELD,
        order,
        ({ table: tableId, cell }) => [
          { op: 'setTableCellVerticalAlignment', tableId, cellIds: [cell], alignment: 'center' },
        ],
        ({ table: tableId, cell }) => [
          {
            op: 'setTableCellFill',
            tableId,
            cellIds: [cell],
            color: { kind: 'hex', value: 'FF0000' },
          },
          { op: 'setTableCellVerticalAlignment', tableId, cellIds: [cell], alignment: 'bottom' },
        ]
      );
      expect(saved.split('<w:vAlign').length - 1).toBe(1);
      expect(saved).toMatch(
        /<w:tcPr><w:tcW w:type="dxa" w:w="3000"\/><w:shd w:fill="FF0000" w:val="clear"\/><w:vAlign w:val="(center|bottom)"\/><\/w:tcPr>/
      );
    });
  });

test('undo and redo of one peer around the merge keep the saved row valid', async () => {
  const { alice, bob, harness } = await concurrent(
    ROW_BARE,
    ORDERS[0],
    ({ table: tableId, row: rowId }) => [
      { op: 'setTableRowHeight', tableId, rowId, heightTwips: 400 },
    ],
    ({ table: tableId }) => [{ op: 'setTableProperties', tableId, headerRowCount: 1 }]
  );
  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(savedRow(bob)).toContain('<w:trPr><w:tblHeader w:val="1"/></w:trPr>');
  expect(savedRow(bob)).not.toContain('trHeight');
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(savedRow(bob).split('<w:trPr>').length - 1).toBe(1);
  expect(savedRow(bob)).toContain('trHeight');
});

/** How many `localName` containers the live row holds, on `peer`'s replica. */
function liveCount(peer: Peer, localName: string): number {
  let count = 0;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) count += 1;
    node.children.forEach(visit);
  };
  visit(peer.store.bodyStore().part.root);
  return count;
}

for (const order of ORDERS) {
  test(`the next table edit merges the repeated containers (client ids ${order.alice}, ${order.bob})`, async () => {
    const { alice, bob, harness } = await concurrent(
      ROW_BARE,
      order,
      ({ table: tableId, row: rowId }) => [
        { op: 'setTableRowHeight', tableId, rowId, heightTwips: 400 },
      ],
      ({ table: tableId }) => [{ op: 'setTableProperties', tableId, headerRowCount: 1 }]
    );
    expect(liveCount(alice, 'trPr')).toBe(2);
    // The header row sits in one copy only; turning it off must reach it.
    harness.apply(alice, [
      { op: 'setTableProperties', tableId: idsOf(alice).table, headerRowCount: 0 },
    ]);
    harness.expectConverged(alice, bob);
    expect(liveCount(bob, 'trPr')).toBe(1);
    expect(savedRow(bob)).not.toContain('tblHeader');
    expect(savedRow(bob)).toContain('<w:trHeight w:hRule="exact" w:val="400"/>');
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(savedRow(bob)).toContain('tblHeader');
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(savedRow(bob)).not.toContain('tblHeader');
  });
}

test('two peers who heal at once converge, and the table stays editable', async () => {
  const harness = createPeerHarness('table-property-containers-room', undefined, ORDERS[0]);
  harnesses.push(harness);
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(table(ROW_BARE)));
  const { table: tableId, row: rowId, cell } = idsOf(alice);
  pause();
  harness.apply(alice, [{ op: 'setTableRowHeight', tableId, rowId, heightTwips: 400 }]);
  harness.apply(bob, [{ op: 'setTableProperties', tableId, headerRowCount: 1 }]);
  resume();
  pause();
  harness.apply(alice, [{ op: 'setTableRowHeight', tableId, rowId, heightTwips: 600 }]);
  harness.apply(bob, [
    { op: 'setTableCellVerticalAlignment', tableId, cellIds: [cell], alignment: 'center' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  // Each heal carried its own edit, and both survive the other's heal.
  const healed = savedRow(bob);
  expect(healed).toContain('<w:trHeight w:hRule="exact" w:val="600"/>');
  expect(healed).toContain('<w:vAlign w:val="center"/>');
  expect(healed).toContain('tblHeader');
  harness.apply(bob, [{ op: 'setTableRowHeight', tableId, rowId, heightTwips: 800 }]);
  harness.expectConverged(alice, bob);
  const saved = savedRow(alice);
  expect(saved.split('<w:trPr>').length - 1).toBe(1);
  expect(saved).toContain('w:val="800"');
  expect(saved).toContain('tblHeader');
  expect(saved).toContain('<w:vAlign w:val="center"/>');
});

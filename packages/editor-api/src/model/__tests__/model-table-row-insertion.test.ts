/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { createServer } from '../../runtime/server.ts';
import { expect, test } from 'bun:test';
import { docx, p, serverRuntime, reopen, mainXmlOf } from './support/documents.ts';

const cell = (text: string, properties = '') => `<w:tc>${properties}${p(text)}</w:tc>`;
const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
const header =
  '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
  cell('Heading', '<w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="EEEEEE"/></w:tcPr>') +
  '</w:tr>';
const fixture = (rows = header + row('A', 'B') + row('C', 'D')) =>
  docx(
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      rows +
      '</w:tbl>' +
      p('Tail')
  );

for (const tracking of [false, true]) {
  test(`row-relative insertion preserves merged headers and values; tracking=${tracking}`, async () => {
    const runtime = await createServer(fixture(), { author: 'Reviewer' });
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        table.rows.load('items');
        await context.sync();
        if (tracking) context.document.changeTrackingMode = 'TrackMineOnly';
        const added = table.rows.items[1]!.insertRows('After', 2, [
          ['E', 'F'],
          ['G', 'H'],
        ]);
        await context.sync();
        expect(added.items).toHaveLength(2);
        table.load('values,headerRowCount');
        await context.sync();
        expect(table.values).toEqual([['Heading'], ['A', 'B'], ['E', 'F'], ['G', 'H'], ['C', 'D']]);
        expect(table.headerRowCount).toBe(1);
      });
      const saved = await reopen(runtime);
      try {
        const xml = await mainXmlOf(saved);
        expect(xml).toContain('<w:gridSpan w:val="2"/>');
        expect(xml).toContain('EEEEEE');
        expect(xml).toContain('Tail');
        expect((xml.match(/<w:ins /g) ?? []).length > 0).toBe(tracking);
      } finally {
        saved.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('edge and Before insertion keep document order and unrelated merges', async () => {
  const runtime = await serverRuntime(fixture());
  try {
    await runtime.run(async (context) => {
      const table = context.document.body.tables.getFirst();
      table.rows.load('items');
      await context.sync();
      table.rows.items[1]!.insertRows('Before', 2, [
        ['1', '2'],
        ['3', '4'],
      ]);
      await context.sync();
      table.addRows('End', 1, [['5', '6']]);
      await context.sync();
      table.load('values');
      await context.sync();
      expect(table.values).toEqual([
        ['Heading'],
        ['1', '2'],
        ['3', '4'],
        ['A', 'B'],
        ['C', 'D'],
        ['5', '6'],
      ]);
    });
  } finally {
    runtime.dispose();
  }
});

test('merged source rows and invalid values refuse without mutation', async () => {
  const runtime = await serverRuntime(fixture());
  try {
    const before = await mainXmlOf(runtime);
    await expect(
      runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        table.addRows('Start', 1, [['X', 'Y']]);
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await mainXmlOf(runtime)).toBe(before);
    await expect(
      runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        table.rows.load('items');
        await context.sync();
        table.rows.items[1]!.insertRows('After', 1, [['X']]);
        await context.sync();
      })
    ).rejects.toBeDefined();
    expect(await mainXmlOf(runtime)).toBe(before);
  } finally {
    runtime.dispose();
  }
});

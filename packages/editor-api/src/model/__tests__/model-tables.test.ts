/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { styledTableDocument } from './support/table-documents.ts';
import { docx, p, serverRuntime, reopen, mainXmlOf } from './support/documents.ts';

describe('Office-shaped table editing', () => {
  test('values, returned rows, named styles, and table deletion use the public contract', async () => {
    const runtime = await serverRuntime(styledTableDocument());
    try {
      await runtime.run(async (context) => {
        const range = context.document.body.getRange('Start');
        await context.sync();
        const table = range.insertTable(1, 2, 'Before', [['old', 'old']]);
        await context.sync();
        table.values = [['New', 'Values']];
        table.style = 'Contract table';
        await context.sync();
        table.load('values,style');
        await context.sync();
        expect(table.values).toEqual([['New', 'Values']]);
        expect(table.style).toBe('Contract table');
        const rows = table.addRows('End', 1, [['Final', 'Row']]);
        await context.sync();
        expect(rows.items.length).toBe(1);
      });
      const reopened = await reopen(runtime);
      try {
        await reopened.run(async (context) => {
          const table = context.document.body.tables.getFirst();
          await context.sync();
          table.load('values,style');
          await context.sync();
          expect(table.style).toBe('Contract table');
          expect(table.values).toEqual([
            ['New', 'Values'],
            ['Final', 'Row'],
          ]);
          table.delete();
          await context.sync();
          const remaining = context.document.body.tables;
          remaining.load('items');
          await context.sync();
          expect(remaining.items.length).toBe(0);
        });
        expect(await mainXmlOf(reopened)).toContain('Keep this paragraph');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('an authoring workflow survives DOCX save/reopen', async () => {
    const runtime = await serverRuntime(docx(p('Report ends here')));
    try {
      await runtime.run(async (context) => {
        const range = context.document.body.getRange('Start');
        await context.sync();
        const table = range.insertTable(2, 2, 'Before', [
          ['Item', 'Price'],
          ['Service', '100'],
        ]);
        await context.sync();
        table.headerRowCount = 1;
        await context.sync();
        table.addRows('End', 1, [['Tax', '10']]);
        await context.sync();
        table.addColumns('Start', 1, [['ID'], ['1'], ['2']]);
        await context.sync();
        const cell = table.getCell(0, 0);
        await context.sync();
        cell.value = 'Reference';
        cell.shadingColor = '#EEDDCC';
        cell.verticalAlignment = 'Center';
        cell.columnWidth = 80;
        await context.sync();
        table.deleteRows(1, 1);
        await context.sync();
        table.deleteColumns(1, 1);
        await context.sync();
      });
      const saved = await reopen(runtime);
      try {
        const result = await saved.run(async (context) => {
          const tables = context.document.body.tables;
          tables.load('items');
          await context.sync();
          expect(tables.items.length).toBe(1);
          const table = tables.items[0]!;
          table.load('values,headerRowCount,rowCount,columnCount');
          const cell = table.getCell(0, 0);
          await context.sync();
          cell.load('value,columnWidth,shadingColor,verticalAlignment');
          await context.sync();
          return {
            values: table.values,
            headerRowCount: table.headerRowCount,
            rowCount: table.rowCount,
            columnCount: table.columnCount,
            cell: {
              value: cell.value,
              width: cell.columnWidth,
              fill: cell.shadingColor,
              alignment: cell.verticalAlignment,
            },
          };
        });
        expect(result).toEqual({
          values: [
            ['Reference', 'Price'],
            ['2', '10'],
          ],
          headerRowCount: 1,
          rowCount: 2,
          columnCount: 2,
          cell: { value: 'Reference', width: 80, fill: '#EEDDCC', alignment: 'Center' },
        });
        expect(await mainXmlOf(saved)).toContain('Report ends here');
      } finally {
        saved.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
  test('row/cell collections and cell body target only that cell', async () => {
    const runtime = await serverRuntime(docx(p('Outside')));
    try {
      await runtime.run(async (context) => {
        const range = context.document.body.getRange('Start');
        await context.sync();
        const table = range.insertTable(1, 2, 'Before', [['Left', 'Right']]);
        await context.sync();
        const rows = table.rows;
        rows.load('items');
        await context.sync();
        const cells = rows.items[0]!.cells;
        cells.load('items');
        await context.sync();
        const body = cells.items[1]!.body;
        await context.sync();
        body.insertText('Changed', 'Replace');
        await context.sync();
        table.load('values');
        await context.sync();
        expect(table.values).toEqual([['Left', 'Changed']]);
      });
      expect(await mainXmlOf(runtime)).toContain('Outside');
    } finally {
      runtime.dispose();
    }
  });
  test('read-derived table cells can be written and loaded in the requesting sync', async () => {
    const runtime = await serverRuntime(docx(p('Outside')));
    try {
      await runtime.run(async (context) => {
        const table = context.document.body
          .getRange('Start')
          .insertTable(1, 1, 'Before', [['Before']]);
        await context.sync();
        const cell = table.getCell(0, 0);
        cell.value = 'After';
        await context.sync();
        const queried = table.getCell(0, 0);
        queried.load('value');
        await context.sync();
        expect(queried.value).toBe('After');
        const chained = context.document.body.tables.getFirst().rows.getFirst().cells.getFirst();
        chained.load('value');
        await context.sync();
        expect(chained.value).toBe('After');
        const body = table.getCell(0, 0).body;
        body.load('text');
        const cellRange = body.getRange('Whole');
        cellRange.load('text');
        await context.sync();
        expect(body.text).toBe('After');
        expect(cellRange.text).toBe('After');
      });
    } finally {
      runtime.dispose();
    }
  });
  test('overlapping text edits refuse atomically and deleted cell proxies become stale', async () => {
    const runtime = await serverRuntime(docx(p('Outside')));
    try {
      await runtime.run(async (context) => {
        const range = context.document.body.getRange('Start');
        await context.sync();
        const table = range.insertTable(2, 1, 'Before', [['UniqueCell'], ['OtherCell']]);
        await context.sync();
        const cell = table.getCell(0, 0);
        const matches = context.document.body.search('UniqueCell', { matchCase: true });
        matches.load('items');
        await context.sync();
        cell.value = 'First';
        matches.items[0]!.insertText('Second', 'Replace');
        await expect(context.sync()).rejects.toThrow();
      });
      await runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        await context.sync();
        table.load('values');
        const cell = table.getCell(0, 0);
        await context.sync();
        expect(table.values).toEqual([['UniqueCell'], ['OtherCell']]);
        table.deleteRows(0, 1);
        await context.sync();
        cell.value = 'Stale';
        await expect(context.sync()).rejects.toThrow();
      });
      expect(await mainXmlOf(runtime)).toContain('OtherCell');
      expect(await mainXmlOf(runtime)).toContain('Outside');
    } finally {
      runtime.dispose();
    }
  });
  test('invalid matrix refuses the whole sync and preserves cell formatting', async () => {
    const runtime = await serverRuntime(docx(p('Outside')));
    try {
      await runtime.run(async (context) => {
        const range = context.document.body.getRange('Start');
        await context.sync();
        const table = range.insertTable(1, 2, 'Before', [['A', 'B']]);
        await context.sync();
        table.values = [['wrong shape']];
        await expect(context.sync()).rejects.toThrow();
      });
      await runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        await context.sync();
        table.load('values');
        await context.sync();
        expect(table.values).toEqual([['A', 'B']]);
      });
    } finally {
      runtime.dispose();
    }
  });
});

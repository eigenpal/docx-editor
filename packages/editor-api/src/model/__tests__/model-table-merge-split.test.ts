/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, mainXmlOf, p, reopen, serverRuntime } from './support/documents.ts';

describe('Table.mergeCells and TableCell.split', () => {
  test('a table with a merged header row survives save and reopen', async () => {
    const runtime = await serverRuntime(docx(p('After the table')));
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.getRange('Start').insertTable(3, 3, 'Before', [
          ['Quarterly results', '', ''],
          ['Region', 'Q1', 'Q2'],
          ['North', '10', '12'],
        ]);
        await context.sync();
        // The returned cell takes edits in the same sync.
        const header = table.mergeCells(0, 0, 0, 2);
        header.value = 'Quarterly results';
        header.verticalAlignment = 'Center';
        await context.sync();
        // The merged table still takes ordinary column edits; this one must sync alone.
        table.addColumns('End', 1);
        await context.sync();
        table.load('values,rowCount,columnCount');
        await context.sync();
        expect(table.rowCount).toBe(3);
        expect(table.columnCount).toBe(4);
        // A column added past the merged cell's edge gives the header row a cell too.
        expect(table.values).toEqual([
          ['Quarterly results', ''],
          ['Region', 'Q1', 'Q2', ''],
          ['North', '10', '12', ''],
        ]);
      });
      expect(await mainXmlOf(runtime)).toContain('<w:gridSpan w:val="3"/>');
      const reopened = await reopen(runtime);
      try {
        await reopened.run(async (context) => {
          const table = context.document.body.tables.getFirst();
          table.load('values');
          await context.sync();
          expect(table.values[0]).toEqual(['Quarterly results', '']);
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('mergeCells returns the merged cell, also when a merge reaches above the corner', async () => {
    const runtime = await serverRuntime(docx(p('x')));
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.getRange('Start').insertTable(3, 2, 'Before', [
          ['a', 'b'],
          ['c', 'd'],
          ['e', 'f'],
        ]);
        await context.sync();
        table.mergeCells(0, 0, 1, 0);
        await context.sync();
        // Row 1's first cell is now the merge's continuation; merging from it takes the whole
        // merged cell, so the result is the top-left cell of row 0.
        const merged = table.mergeCells(1, 0, 2, 0);
        await context.sync();
        merged.load('value');
        await context.sync();
        // One paragraph per merged cell that had content, in reading order.
        expect(merged.value).toBe('a\rc\re');
      });
    } finally {
      runtime.dispose();
    }
  });

  test('split adds columns and rows; a merged cell splits back', async () => {
    const runtime = await serverRuntime(docx(p('x')));
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.getRange('Start').insertTable(2, 2, 'Before', [
          ['a', 'b'],
          ['c', 'd'],
        ]);
        await context.sync();
        table.getCell(0, 0).split(2, 2);
        await context.sync();
        table.load('values,rowCount,columnCount');
        await context.sync();
        expect(table.rowCount).toBe(3);
        expect(table.columnCount).toBe(3);
        expect(table.values).toEqual([
          ['a', '', 'b'],
          ['', '', ''],
          ['c', 'd'],
        ]);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('invalid arguments and ragged rectangles refuse with InvalidArgument', async () => {
    const runtime = await serverRuntime(docx(p('x')));
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.getRange('Start').insertTable(3, 2, 'Before', [
          ['a', 'b'],
          ['c', 'd'],
          ['e', 'f'],
        ]);
        await context.sync();
        // Column 1 merges over rows 0 and 1.
        table.mergeCells(0, 1, 1, 1);
        await context.sync();
      });
      const before = await mainXmlOf(runtime);
      for (const action of ['single', 'bounds', 'split', 'ragged'] as const) {
        await expect(
          runtime.run(async (context) => {
            const table = context.document.body.tables.getFirst();
            if (action === 'single') table.mergeCells(0, 0, 0, 0);
            else if (action === 'bounds') table.mergeCells(0, 0, 5, 0);
            else if (action === 'split') table.getCell(0, 0).split(1, 1);
            // Rows 1 and 2: the merged cell in column 1 reaches up into row 0, so the
            // rectangle is ragged at its top edge.
            else table.mergeCells(1, 0, 2, 1);
            await context.sync();
          })
        ).rejects.toMatchObject({
          code: 'InvalidArgument',
          ...(action === 'ragged' || action === 'single'
            ? { debugInfo: { innerError: { code: 'edit.table-merge-not-rectangle' } } }
            : {}),
        });
      }
      expect(await mainXmlOf(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test('tracking modes refuse merge and split without changing the document', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        context.document.body.getRange('Start').insertTable(2, 2, 'Before', [
          ['a', 'b'],
          ['c', 'd'],
        ]);
        await context.sync();
        context.document.changeTrackingMode = 'TrackMineOnly';
        await context.sync();
      });
      const before = await mainXmlOf(runtime);
      for (const action of ['merge', 'split'] as const) {
        await expect(
          runtime.run(async (context) => {
            const table = context.document.body.tables.getFirst();
            if (action === 'merge') table.mergeCells(0, 0, 0, 1);
            else table.getCell(0, 0).split(1, 2);
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'NotSupported' });
        expect(await mainXmlOf(runtime)).toBe(before);
      }
    } finally {
      runtime.dispose();
    }
  });
});

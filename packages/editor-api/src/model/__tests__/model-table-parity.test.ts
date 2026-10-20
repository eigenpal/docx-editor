/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { createBrowser } from '../../runtime/browser.ts';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { styledTableDocument } from './support/table-documents.ts';
import { mainXmlOf } from './support/documents.ts';

async function tableSnapshot(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const table = context.document.body.tables.getFirst();
    table.load('values,style,headerRowCount,rowCount,columnCount');
    const cell = table.getCell(0, 0);
    cell.load('value,columnWidth,shadingColor,verticalAlignment');
    context.document.body.load('text');
    await context.sync();
    return {
      values: table.values,
      style: table.style,
      headerRowCount: table.headerRowCount,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      cell: {
        value: cell.value,
        width: cell.columnWidth,
        fill: cell.shadingColor,
        alignment: cell.verticalAlignment,
      },
      bodyText: context.document.body.text,
    };
  });
}
async function author(runtime: DocxEditorRuntime) {
  const steps: string[] = [];
  await runtime.run(async (context) => {
    const table = context.document.body.getRange('Start').insertTable(2, 2, 'Before', [
      ['Label', 'Cost'],
      ['Draft', '1'],
    ]);
    await context.sync();
    steps.push('insert');
    table.values = [
      ['Item', 'Price'],
      ['Service', '100'],
    ];
    table.style = 'Contract table';
    table.headerRowCount = 1;
    await context.sync();
    steps.push('populate-style-header');
    const rows = table.addRows('End', 1, [['Tax', '10']]);
    await context.sync();
    steps.push(`rows:${rows.items.length}`);
    table.addColumns('Start', 1, [['ID'], ['1'], ['2']]);
    await context.sync();
    steps.push('columns');
    const cell = table.getCell(0, 0);
    cell.value = 'Reference';
    cell.shadingColor = '#EEDDCC';
    cell.verticalAlignment = 'Center';
    cell.columnWidth = 80;
    await context.sync();
    steps.push('cell-properties');
    table.deleteRows(1, 1);
    await context.sync();
    table.deleteColumns(1, 1);
    await context.sync();
    steps.push('delete-row-column');
    const body = table.getCell(1, 1).body;
    body.insertText('11', 'Replace');
    await context.sync();
    steps.push('cell-body');
    const temporary = context.document.body
      .getRange('End')
      .insertTable(1, 1, 'After', [['Temporary']]);
    await context.sync();
    temporary.delete();
    await context.sync();
    steps.push('delete-table');
  });
  return { steps, snapshot: await tableSnapshot(runtime) };
}
async function invalidMatrix(runtime: DocxEditorRuntime): Promise<string> {
  try {
    await runtime.run(async (context) => {
      const table = context.document.body.tables.getFirst();
      table.values = [['wrong shape']];
      await context.sync();
    });
  } catch (error) {
    if (isDocxEditorError(error)) return error.code;
    throw error;
  }
  throw new Error('invalid matrix did not refuse');
}

describe('browser/server table authoring parity', () => {
  test('the same public agent workflow produces the same reads, paint, and saved document', async () => {
    const bytes = styledTableDocument();
    const server = await createServer(bytes);
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: bytes });
    if (!editor.surface) throw new Error('browser surface did not mount');
    const browser = createBrowser(editor);
    try {
      const serverTranscript = await author(server);
      const browserTranscript = await author(browser);
      expect(browserTranscript).toEqual(serverTranscript);
      expect(browserTranscript.snapshot).toMatchObject({
        values: [
          ['Reference', 'Price'],
          ['2', '11'],
        ],
        style: 'Contract table',
        headerRowCount: 1,
        rowCount: 2,
        columnCount: 2,
        cell: { value: 'Reference', width: 80, fill: '#EEDDCC', alignment: 'Center' },
      });
      expect(container.querySelector('[data-table-id]')).not.toBeNull();
      expect(container.textContent).toContain('Reference');
      expect(container.textContent).toContain('Keep this paragraph');
      const codes = { server: await invalidMatrix(server), browser: await invalidMatrix(browser) };
      expect(codes.browser).toBe(codes.server);
      expect(await tableSnapshot(browser)).toEqual(browserTranscript.snapshot);
      expect(await tableSnapshot(server)).toEqual(serverTranscript.snapshot);
      const savedServer = await createServer(await server.save());
      const savedBrowser = await createServer(new Uint8Array(await editor.save()));
      try {
        expect(await tableSnapshot(savedBrowser)).toEqual(await tableSnapshot(savedServer));
        expect(await tableSnapshot(savedBrowser)).toEqual(browserTranscript.snapshot);
        expect(await mainXmlOf(savedBrowser)).toContain('Keep this paragraph');
        expect(await mainXmlOf(savedBrowser)).not.toContain('Temporary');
      } finally {
        savedServer.dispose();
        savedBrowser.dispose();
      }
    } finally {
      browser.dispose();
      server.dispose();
      editor.destroy();
      container.remove();
    }
  });
});

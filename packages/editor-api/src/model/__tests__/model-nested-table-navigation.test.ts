/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { cell, docx, p, row, serverRuntime, table } from './support/documents.ts';

const fixture = docx(
  p('before') +
    table(
      row(
        cell(
          p('outer'),
          table(row(cell(p('nested')), cell(p('nested neighbor')))),
          p('outer last')
        ),
        cell(p('outer neighbor'))
      )
    ) +
    p('after')
);

test('nested cell navigation edits only its cell and survives reopening', async () => {
  const runtime = await serverRuntime(fixture);
  try {
    await runtime.run(async (context) => {
      const outer = context.document.body.tables.getFirst().getCell(0, 0).body;
      const nested = outer.tables.getFirst();
      const cell = nested.getCell(0, 0);
      cell.body.insertText('updated', 'Replace');
      await context.sync();
      cell.shadingColor = '#FFFF00';
      await context.sync();
      const row = nested.rows.getFirst();
      const first = row.cells.getFirst();
      first.load('value,shadingColor');
      await context.sync();
      expect(first.value).toBe('updated');
      expect(first.shadingColor).toBe('#FFFF00');
    });
    const reopened = await serverRuntime(await runtime.save());
    try {
      await reopened.run(async (context) => {
        const body = context.document.body;
        const outer = body.tables.getFirst().getCell(0, 0).body;
        const nested = outer.tables.getFirst();
        nested.load('values');
        body.load('text');
        await context.sync();
        expect(nested.values).toEqual([['updated', 'nested neighbor']]);
        expect(body.text).toBe(
          'before\router\rupdated\rnested neighbor\router last\router neighbor\rafter'
        );
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('cell body endpoints insert paragraphs without changing neighboring text', async () => {
  const runtime = await serverRuntime(fixture);
  try {
    await runtime.run(async (context) => {
      const body = context.document.body.tables.getFirst().getCell(0, 1).body;
      await context.sync();
      const first = body.insertParagraph('cell start', 'Start');
      await context.sync();
      const last = body.insertParagraph('cell end', 'End');
      await context.sync();
      first.font.bold = true;
      last.font.italic = true;
      const start = body.getRange('Start');
      const end = body.getRange('End');
      await context.sync();
      start.insertText('[', 'Start');
      end.insertText(']', 'End');
      await context.sync();
      body.load('text');
      context.document.body.load('text');
      first.load('text');
      last.load('text');
      await context.sync();
      expect(body.text).toBe('[cell start\router neighbor\rcell end]');
      expect(first.text).toBe('[cell start');
      expect(last.text).toBe('cell end]');
      expect(context.document.body.text).toBe(
        'before\router\rnested\rnested neighbor\router last\r[cell start\router neighbor\rcell end]\rafter'
      );
    });
  } finally {
    runtime.dispose();
  }
});

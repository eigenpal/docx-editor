/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { cell, docx, mainXmlOf, p, row, serverRuntime, table } from './support/documents.ts';

for (const assignment of ['table', 'cell'] as const) {
  test(`${assignment} value replacement preserves direct formatting and neighboring content`, async () => {
    const runtime = await serverRuntime(
      docx(p('before') + table(row(cell(p('old')), cell(p('neighbor')))) + p('after'))
    );
    try {
      await runtime.run(async (context) => {
        const table = context.document.body.tables.getFirst();
        const cell = table.getCell(0, 0);
        cell.body.font.bold = true;
        cell.body.font.italic = true;
        cell.body.font.color = '#143B52';
        cell.shadingColor = '#FFFF00';
        await context.sync();
        if (assignment === 'table') table.values = [['new value', 'neighbor']];
        else cell.value = 'new value';
        await context.sync();
      });
      const reopened = await serverRuntime(await runtime.save());
      try {
        await reopened.run(async (context) => {
          const table = context.document.body.tables.getFirst();
          const cell = table.getCell(0, 0);
          const neighbor = table.getCell(0, 1);
          context.document.body.load('text');
          cell.body.font.load('bold,italic,color');
          neighbor.body.font.load('bold,italic,color');
          cell.load('shadingColor');
          await context.sync();
          expect(context.document.body.text).toBe('before\rnew value\rneighbor\rafter');
          expect(cell.body.font.bold).toBe(true);
          expect(cell.body.font.italic).toBe(true);
          expect(cell.body.font.color).toBe('#143B52');
          expect(cell.shadingColor).toBe('#FFFF00');
          expect(neighbor.body.font.bold).toBeNull();
          expect(neighbor.body.font.italic).toBeNull();
          expect(neighbor.body.font.color).toBeNull();
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('table value replacement refuses complex cells without changing any cell', async () => {
  const runtime = await serverRuntime(
    docx(table(row(cell(p('ordinary')), cell(p('first paragraph'), p('second paragraph')))))
  );
  try {
    const before = await mainXmlOf(runtime);
    await expect(
      runtime.run(async (context) => {
        context.document.body.tables.getFirst().values = [['changed', 'unsafe replacement']];
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await mainXmlOf(runtime)).toBe(before);
  } finally {
    runtime.dispose();
  }
});

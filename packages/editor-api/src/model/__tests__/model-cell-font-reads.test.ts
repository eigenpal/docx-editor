/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { cell, docx, p, row, serverRuntime, table } from './support/documents.ts';

test('cell body font reads agree with direct paragraph formatting before and after reopening', async () => {
  const runtime = await serverRuntime(
    docx(p('before') + table(row(cell(p('first'), p('second')), cell(p('neighbor')))) + p('after'))
  );
  try {
    await runtime.run(async (context) => {
      const body = context.document.body.tables.getFirst().getCell(0, 0).body;
      body.font.bold = true;
      body.font.color = '#143B52';
      await context.sync();
    });
    const reopened = await serverRuntime(await runtime.save());
    try {
      for (const current of [runtime, reopened]) {
        await current.run(async (context) => {
          const table = context.document.body.tables.getFirst();
          const body = table.getCell(0, 0).body;
          const other = table.getCell(0, 1).body;
          const first = body.paragraphs.getFirst();
          body.font.load('bold,color');
          first.font.load('bold,color');
          other.font.load('bold,color');
          context.document.body.font.load('bold,color');
          await context.sync();
          expect(body.font.bold).toBe(true);
          expect(body.font.color).toBe('#143B52');
          expect(first.font.bold).toBe(true);
          expect(first.font.color).toBe('#143B52');
          expect(other.font.bold).toBeNull();
          expect(other.font.color).toBeNull();
          expect(context.document.body.font.bold).toBeNull();
          expect(context.document.body.font.color).toBeNull();
        });
      }
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('cell font aggregation includes nested paragraphs and preserves mixed values', async () => {
  const runtime = await serverRuntime(
    docx(p('before') + table(row(cell(p('outer'), table(row(cell(p('nested')))), p('last')))))
  );
  try {
    await runtime.run(async (context) => {
      const body = context.document.body.tables.getFirst().getCell(0, 0).body;
      body.font.bold = true;
      await context.sync();
      body.paragraphs.load('items');
      await context.sync();
      for (const paragraph of body.paragraphs.items) paragraph.load('text');
      await context.sync();
      const nested = body.paragraphs.items.find((paragraph) => paragraph.text === 'nested')!;
      nested.font.bold = false;
      await context.sync();
      body.font.load('bold');
      nested.font.load('bold');
      await context.sync();
      expect(body.font.bold).toBeNull();
      expect(nested.font.bold).toBe(false);
    });
  } finally {
    runtime.dispose();
  }
});

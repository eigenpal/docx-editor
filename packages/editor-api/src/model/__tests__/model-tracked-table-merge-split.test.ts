/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Merge and split inside a table that is the author's own pending insertion. The new shape
// stays part of that insertion: accept keeps it, and reject removes the whole table.
import { describe, expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import { docx, mainXmlOf, p, reopen } from './support/documents.ts';

const TEXTS = ['Heading text', 'Body one.'];
const SOURCE = TEXTS.map(p).join('');

/** Proposes a table, merges its header row, and splits one cell into two rows. */
async function proposeShapedTable(): Promise<DocxEditorServerRuntime> {
  const runtime = await createServer(docx(SOURCE), { author: 'Writer' });
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const table = context.document.body.paragraphs
      .getFirst()
      .getRange('End')
      .insertTable(3, 3, 'After', [
        ['Results', '', ''],
        ['Region', 'Q1', 'Q2'],
        ['North', '10', '12'],
      ]);
    await context.sync();
    const header = table.mergeCells(0, 0, 0, 2);
    header.load('value');
    table.getCell(2, 0).split(2, 1);
    await context.sync();
    expect(header.value).toBe('Results');
  });
  return runtime;
}

async function tableValues(runtime: DocxEditorServerRuntime): Promise<string[][] | null> {
  return runtime.run(async (context) => {
    const table = context.document.body.tables.getFirstOrNullObject();
    table.load('values');
    await context.sync();
    return table.isNullObject ? null : table.values;
  });
}

async function decideAll(runtime: DocxEditorServerRuntime, action: 'acceptAll' | 'rejectAll') {
  await runtime.run(async (context) => {
    context.document.body.revisions[action]();
    await context.sync();
  });
}

async function paragraphTexts(runtime: DocxEditorServerRuntime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

const SHAPED = [['Results'], ['Region', 'Q1', 'Q2'], ['North', '10', '12'], ['', '', '']];

describe('merge and split in a pending tracked table', () => {
  test('the new rows, cells, and paragraph marks join the pending insertion', async () => {
    const runtime = await proposeShapedTable();
    try {
      // The split cell's other row is new; the cells beside it merge down into it.
      expect(await tableValues(runtime)).toEqual(SHAPED);
      const xml = await mainXmlOf(runtime);
      expect(xml).toContain('<w:gridSpan w:val="3"/>');
      const rows = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? [];
      expect(rows).toHaveLength(4);
      // Every row, and every paragraph mark in it, is part of the one table insertion.
      for (const row of rows) {
        expect(row).toMatch(/^<w:tr><w:trPr><w:ins w:author="Writer" [^>]*w:id="0"\/><\/w:trPr>/);
        const marks = row.match(/<w:p [^>]*>/g) ?? [];
        const insertedMarks = row.match(/<w:pPr><w:rPr><w:ins [^>]*w:id="0"\/>/g) ?? [];
        expect(insertedMarks.length).toBe(marks.length);
      }
    } finally {
      runtime.dispose();
    }
  });

  test('reject removes the whole table, also after save and reopen', async () => {
    const runtime = await proposeShapedTable();
    const reopened = await reopen(runtime);
    try {
      await decideAll(reopened, 'rejectAll');
      expect(await paragraphTexts(reopened)).toEqual(TEXTS);
      expect(await mainXmlOf(reopened)).not.toContain('<w:tbl>');
    } finally {
      reopened.dispose();
      runtime.dispose();
    }
  });

  test('accept keeps the merged and split shape, also after save and reopen', async () => {
    const runtime = await proposeShapedTable();
    try {
      await decideAll(runtime, 'acceptAll');
      const reopened = await reopen(runtime);
      try {
        expect(await tableValues(reopened)).toEqual(SHAPED);
        const xml = await mainXmlOf(reopened);
        expect(xml).toContain('<w:gridSpan w:val="3"/>');
        expect(xml).not.toContain('<w:ins ');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('another author pending table refuses merge and split with NotSupported', async () => {
    const runtime = await createServer(docx(SOURCE), { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.paragraphs
          .getFirst()
          .getRange('End')
          .insertTable(2, 2, 'After', [
            ['a', 'b'],
            ['c', 'd'],
          ]);
        await context.sync();
      });
      const proposed = await mainXmlOf(runtime);
      const reviewer = await createServer(await runtime.save(), { author: 'Reviewer' });
      try {
        for (const action of ['merge', 'split'] as const) {
          await expect(
            reviewer.run(async (context) => {
              context.document.changeTrackingMode = 'TrackMineOnly';
              const table = context.document.body.tables.getFirst();
              if (action === 'merge') table.mergeCells(0, 0, 0, 1);
              else table.getCell(0, 0).split(1, 2);
              await context.sync();
            })
          ).rejects.toMatchObject({ code: 'NotSupported' });
        }
        expect(await mainXmlOf(reviewer)).toBe(proposed);
      } finally {
        reviewer.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
  test('the tracking mode, a merge, and a load of the merged cell can share one sync', async () => {
    const runtime = await createServer(docx(SOURCE), { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.paragraphs.getFirst().insertTable(2, 2, 'After', [
          ['a', 'b'],
          ['c', 'd'],
        ]);
        await context.sync();
      });
      const proposed = await runtime.save();
      // A new run starts with tracking off, so a script sets the mode again in its first sync.
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const merged = context.document.body.tables.getFirst().mergeCells(0, 0, 1, 0);
        merged.load('value');
        await context.sync();
        // Reads in a sync that writes answer the document before its writes.
        expect(merged.value).toBe('a');
        merged.load('value');
        await context.sync();
        expect(merged.value).toBe('a\rc');
      });
      const reviewer = await createServer(proposed, { author: 'Reviewer' });
      try {
        await expect(
          reviewer.run(async (context) => {
            context.document.changeTrackingMode = 'TrackMineOnly';
            const merged = context.document.body.tables.getFirst().mergeCells(0, 0, 0, 1);
            merged.load('value');
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'NotSupported' });
      } finally {
        reviewer.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
});

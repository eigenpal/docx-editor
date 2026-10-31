/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Body.insertTable and Paragraph.insertTable: the same insertion as Range.insertTable, at the
// body's edges and beside one paragraph.
import { describe, expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import type { RequestContext } from '../../index.ts';
import { docx, mainXmlOf, p } from './support/documents.ts';

const TEXTS = ['First.', 'Second.', 'Third.'];
const SOURCE = TEXTS.map(p).join('');

/** The body's blocks in order: a paragraph's text, or `[table]`. */
async function blocks(runtime: DocxEditorServerRuntime): Promise<string[]> {
  const xml = await mainXmlOf(runtime);
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('</w:body>'));
  const pattern = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?: [^>]*)?\/>|<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
  return (body.match(pattern) ?? []).map((block) =>
    block.startsWith('<w:tbl>')
      ? '[table]'
      : [...block.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('')
  );
}

async function inserted(write: (context: RequestContext) => unknown): Promise<string[]> {
  const runtime = await createServer(docx(SOURCE), { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const table = write(context) as { load(names: string): void; values: string[][] };
      await context.sync();
      table.load('values');
      await context.sync();
      expect(table.values).toEqual([['a', 'b']]);
    });
    return await blocks(runtime);
  } finally {
    runtime.dispose();
  }
}

const VALUES = [['a', 'b']];

describe('Body.insertTable and Paragraph.insertTable', () => {
  test('Body Start and End put the table at the edges of the body', async () => {
    expect(
      await inserted((context) => context.document.body.insertTable(1, 2, 'Start', VALUES))
    ).toEqual(['[table]', ...TEXTS]);
    const atEnd = await inserted((context) =>
      context.document.body.insertTable(1, 2, 'End', VALUES)
    );
    // A body ends with a paragraph, so an empty one follows a table at the end.
    expect(atEnd).toEqual([...TEXTS, '[table]', '']);
  });

  test('Paragraph Before and After put the table beside that paragraph', async () => {
    const second = (context: RequestContext) => context.document.body.paragraphs.items[1]!;
    expect(
      await inserted((context) => second(context).insertTable(1, 2, 'Before', VALUES))
    ).toEqual(['First.', '[table]', 'Second.', 'Third.']);
    expect(await inserted((context) => second(context).insertTable(1, 2, 'After', VALUES))).toEqual(
      ['First.', 'Second.', '[table]', 'Third.']
    );
  });

  test('invalid arguments refuse with InvalidArgument, not a TypeError', async () => {
    const runtime = await createServer(docx(SOURCE));
    try {
      const before = await mainXmlOf(runtime);
      const calls: ((context: RequestContext) => unknown)[] = [
        (context) => context.document.body.insertTable(1, 2, 'Before' as 'Start'),
        (context) => context.document.body.insertTable(0, 2, 'End'),
        (context) =>
          context.document.body.paragraphs.getFirst().insertTable(1, 2, 'End' as 'After'),
        (context) =>
          context.document.body.paragraphs
            .getFirst()
            .insertTable(1, 1, 'After', [[1 as unknown as string]]),
      ];
      for (const call of calls) {
        await expect(
          runtime.run(async (context) => {
            call(context);
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'InvalidArgument' });
      }
      expect(await mainXmlOf(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });

  test('a tracked body table is one insertion that reject removes', async () => {
    const runtime = await createServer(docx(SOURCE), { author: 'Writer' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.insertTable(2, 2, 'Start', [
          ['a', 'b'],
          ['c', 'd'],
        ]);
        await context.sync();
      });
      expect(await mainXmlOf(runtime)).toContain('<w:trPr><w:ins w:author="Writer"');
      await runtime.run(async (context) => {
        context.document.body.revisions.rejectAll();
        await context.sync();
      });
      expect(await blocks(runtime)).toEqual(TEXTS);
    } finally {
      runtime.dispose();
    }
  });

  test('a table inside a table cell refuses with InvalidArgument', async () => {
    const runtime = await createServer(docx(SOURCE));
    try {
      await runtime.run(async (context) => {
        context.document.body.insertTable(1, 1, 'Start', [['cell']]);
        await context.sync();
      });
      const before = await mainXmlOf(runtime);
      for (const where of ['body', 'paragraph'] as const) {
        await expect(
          runtime.run(async (context) => {
            const cell = context.document.body.tables.getFirst().getCell(0, 0);
            if (where === 'body') cell.body.insertTable(1, 1, 'End');
            else cell.body.paragraphs.getFirst().insertTable(1, 1, 'After');
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'InvalidArgument' });
      }
      expect(await mainXmlOf(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
  test('Body Start refuses with InvalidArgument when the body starts with a table', async () => {
    const runtime = await createServer(docx(SOURCE));
    try {
      await runtime.run(async (context) => {
        context.document.body.insertTable(1, 1, 'Start', [['first']]);
        await context.sync();
      });
      const before = await mainXmlOf(runtime);
      await expect(
        runtime.run(async (context) => {
          context.document.body.insertTable(1, 1, 'Start', [['second']]);
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await mainXmlOf(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
});

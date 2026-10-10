/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

for (const location of ['Start', 'End'] as const) {
  for (const decision of ['acceptAll', 'rejectAll'] as const) {
    test(`row suggestions at ${location} survive save and ${decision}`, async () => {
      const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
      try {
        await runtime.run(async (c) => {
          const table = c.document.body.getRange('Start').insertTable(3, 2, 'Before', [
            ['Name', 'Date'],
            ['Original', '2026-09-01'],
            ['Keep', '2026-10-01'],
          ]);
          await c.sync();
          c.document.changeTrackingMode = 'TrackMineOnly';
          const addedRows = table.addRows(location, 2, [
            ['Added one', '2026-11-01'],
            ['Added two', '2026-12-01'],
          ]);
          await c.sync();
          expect(addedRows.items).toHaveLength(2);
          table.deleteRows(location === 'Start' ? 3 : 1, 1);
          await c.sync();
        });
        const bytes = await runtime.save();
        const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
        expect(xml).toMatch(/<w:trPr[^>]*>.*?<w:ins/s);
        expect(xml).toMatch(/<w:trPr[^>]*>.*?<w:del/s);
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            const table = c.document.body.tables.getFirst();
            table.load('values');
            await c.sync();
            const original = [
              ['Name', 'Date'],
              ['Original', '2026-09-01'],
              ['Keep', '2026-10-01'],
            ];
            const added = [
              ['Added one', '2026-11-01'],
              ['Added two', '2026-12-01'],
            ];
            expect(table.values).toEqual(
              decision === 'rejectAll'
                ? original
                : location === 'Start'
                  ? [...added, original[0]!, original[2]!]
                  : [original[0]!, original[2]!, ...added]
            );
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });
  }
}

test('unsupported tracked table mutations refuse without changing saved content', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
  try {
    await runtime.run(async (c) => {
      c.document.body.getRange('Start').insertTable(2, 1, 'Before', [['One'], ['Two']]);
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
    });
    const before = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    for (const action of ['columns', 'allRows', 'delete', 'style'] as const) {
      await expect(
        runtime.run(async (c) => {
          const table = c.document.body.tables.getFirst();
          if (action === 'columns') table.addColumns('End', 1);
          else if (action === 'allRows') table.deleteRows(0, 2);
          else if (action === 'delete') table.delete();
          else table.headerRowCount = 1;
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(strFromU8(unzipSync(await runtime.save())['word/document.xml']!)).toBe(before);
    }
  } finally {
    runtime.dispose();
  }
});

test('successive row deletions cannot propose deleting the last surviving row', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
  try {
    await runtime.run(async (c) => {
      const table = c.document.body
        .getRange('Start')
        .insertTable(2, 1, 'Before', [['One'], ['Two']]);
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      table.deleteRows(0, 1);
      await c.sync();
    });
    const before = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
    await expect(
      runtime.run(async (c) => {
        c.document.body.tables.getFirst().deleteRows(1, 1);
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(strFromU8(unzipSync(await runtime.save())['word/document.xml']!)).toBe(before);
  } finally {
    runtime.dispose();
  }
});

for (const pending of ['insertion', 'deletion'] as const) {
  test(`row deletion preserves another author's pending ${pending}`, async () => {
    const first = await DocxEditor.createServer(docx(p('Anchor')), { author: 'First writer' });
    try {
      await first.run(async (c) => {
        const table = c.document.body
          .getRange('Start')
          .insertTable(3, 1, 'Before', [['Header'], ['Original'], ['Keep']]);
        await c.sync();
        c.document.changeTrackingMode = 'TrackMineOnly';
        if (pending === 'insertion') table.addRows('End', 1, [['Proposed']]);
        else table.deleteRows(1, 1);
        await c.sync();
      });
      const second = await DocxEditor.createServer(await first.save(), { author: 'Second writer' });
      try {
        const before = strFromU8(unzipSync(await second.save())['word/document.xml']!);
        await expect(
          second.run(async (c) => {
            c.document.changeTrackingMode = 'TrackMineOnly';
            c.document.body.tables.getFirst().deleteRows(pending === 'insertion' ? 3 : 1, 1);
            await c.sync();
          })
        ).rejects.toMatchObject({ code: 'NotImplemented' });
        expect(strFromU8(unzipSync(await second.save())['word/document.xml']!)).toBe(before);
      } finally {
        second.dispose();
      }
    } finally {
      first.dispose();
    }
  });
}

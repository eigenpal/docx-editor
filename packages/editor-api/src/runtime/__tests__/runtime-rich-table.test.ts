/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

for (const location of ['Before', 'After', 'middle'] as const) {
  for (const decision of ['acceptAll', 'rejectAll'] as const) {
    test(`new table suggestion ${location} survives ${decision} and reopen`, async () => {
      const runtime = await DocxEditor.createServer(docx(p('Intro clause end')), {
        author: 'Writer',
      });
      try {
        await runtime.run(async (c) => {
          const range =
            location === 'middle'
              ? c.document.body.search('clause').getFirst()
              : c.document.body.paragraphs.getFirst().getRange('Content');
          await c.sync();
          c.document.changeTrackingMode = 'TrackMineOnly';
          range.insertTable(2, 2, location === 'After' ? 'After' : 'Before', [
            ['Name', 'Date'],
            ['Example', '2026-10-01'],
          ]);
          await c.sync();
        });
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            c.document.body.tables.load('items');
            c.document.body.load('text');
            c.document.revisions.load('items');
            await c.sync();
            expect(c.document.revisions.items).toHaveLength(0);
            expect(c.document.body.tables.items).toHaveLength(decision === 'acceptAll' ? 1 : 0);
            if (decision === 'rejectAll') expect(c.document.body.text).toBe('Intro clause end');
            else {
              const table = c.document.body.tables.getFirst();
              table.load('values');
              await c.sync();
              expect(table.values).toEqual([
                ['Name', 'Date'],
                ['Example', '2026-10-01'],
              ]);
            }
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

for (const decision of ['acceptAll', 'rejectAll'] as const) {
  test(`proposed table configuration survives ${decision}`, async () => {
    const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const table = c.document.body
          .getRange('Start')
          .insertTable(2, 1, 'Before', [['Name'], ['Example']]);
        await c.sync();
        table.headerRowCount = 1;
        await c.sync();
        table.addColumns('End', 1, [['Date'], ['2026-10-01']]);
        await c.sync();
        table.getCell(0, 1).shadingColor = '#EEEEEE';
        await c.sync();
      });
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        await reopened.run(async (c) => {
          c.document.body.revisions[decision]();
          await c.sync();
          c.document.body.tables.load('items');
          c.document.revisions.load('items');
          await c.sync();
          expect(c.document.revisions.items).toHaveLength(0);
          expect(c.document.body.tables.items).toHaveLength(decision === 'acceptAll' ? 1 : 0);
          if (decision === 'acceptAll') {
            const table = c.document.body.tables.getFirst();
            table.load(['values', 'headerRowCount']);
            const cell = table.getCell(0, 1);
            cell.load('shadingColor');
            await c.sync();
            expect(table.values).toEqual([
              ['Name', 'Date'],
              ['Example', '2026-10-01'],
            ]);
            expect(table.headerRowCount).toBe(1);
            expect(cell.shadingColor).toBe('#EEEEEE');
          }
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
  for (const matrix of [false, true]) {
    test(`cell replacement suggestions, matrix ${matrix}, survive ${decision}`, async () => {
      const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
      try {
        await runtime.run(async (c) => {
          const table = c.document.body
            .getRange('Start')
            .insertTable(2, 1, 'Before', [['Before'], ['Keep']]);
          await c.sync();
          c.document.changeTrackingMode = 'TrackMineOnly';
          if (matrix) table.values = [['After'], ['Updated']];
          else table.getCell(0, 0).value = 'After';
          await c.sync();
        });
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            const table = c.document.body.tables.getFirst();
            table.load('values');
            c.document.revisions.load('items');
            await c.sync();
            expect(table.values).toEqual(
              decision === 'rejectAll'
                ? [['Before'], ['Keep']]
                : [['After'], [matrix ? 'Updated' : 'Keep']]
            );
            expect(c.document.revisions.items).toHaveLength(0);
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

test('rejecting a table beside an existing table removes its separator', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
  try {
    await runtime.run(async (c) => {
      c.document.body.getRange('Start').insertTable(1, 1, 'Before', [['Existing']]);
      await c.sync();
    });
    let original = '';
    await runtime.run(async (c) => {
      c.document.body.load('text');
      await c.sync();
      original = c.document.body.text;
    });
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.body.paragraphs
        .getLast()
        .getRange('Content')
        .insertTable(1, 1, 'Before', [['Proposed']]);
      await c.sync();
      c.document.revisions.rejectAll();
      await c.sync();
      c.document.body.load('text');
      c.document.revisions.load('items');
      await c.sync();
      expect(c.document.body.text).toBe(original);
      expect(c.document.revisions.items).toHaveLength(0);
    });
  } finally {
    runtime.dispose();
  }
});

test('a proposed table with another author’s cell revision refuses structural configuration', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Anchor')), { author: 'Writer' });
  try {
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.body.getRange('Start').insertTable(1, 1, 'Before', [['Existing']]);
      await c.sync();
    });
    const { strFromU8, strToU8, unzipSync, zipSync } = await import('fflate');
    const files = unzipSync(await runtime.save());
    const xml = strFromU8(files['word/document.xml']!).replace(
      '</w:p></w:tc>',
      '<w:ins w:id="900" w:author="Other"><w:r><w:t>Other text</w:t></w:r></w:ins></w:p></w:tc>'
    );
    files['word/document.xml'] = strToU8(xml);
    const reopened = await DocxEditor.createServer(zipSync(files), { author: 'Writer' });
    try {
      const before = await reopened.save();
      await expect(
        reopened.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.tables.getFirst().addColumns('End', 1);
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await reopened.save()).toEqual(before);
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

for (const text of ['', 'Updated clause']) {
  for (const decision of ['acceptAll', 'rejectAll'] as const) {
    test(`tracked paragraph range replacement ${JSON.stringify(text)} survives ${decision}`, async () => {
      const runtime = await DocxEditor.createServer(
        docx(p('First clause') + p('Second clause') + p('Last clause')),
        { author: 'Writer' }
      );
      try {
        await runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const range = c.document.body.getRange('Content');
          await c.sync();
          range.insertText(text, 'Replace');
          await c.sync();
        });
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (c) => {
            c.document.revisions[decision]();
            await c.sync();
            c.document.body.load('text');
            c.document.body.paragraphs.load('items');
            c.document.revisions.load('items');
            await c.sync();
            expect(c.document.body.text).toBe(
              decision === 'rejectAll' ? 'First clause\rSecond clause\rLast clause' : text
            );
            expect(c.document.body.paragraphs.items).toHaveLength(decision === 'rejectAll' ? 3 : 1);
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

for (const body of [
  p('First') +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    p('Last'),
  p('First') +
    '<w:p><w:ins w:id="9" w:author="Other"><w:r><w:t>Pending text</w:t></w:r></w:ins></w:p>' +
    p('Last'),
]) {
  test('tracked whole range refuses table boundaries or existing proposals atomically', async () => {
    const runtime = await DocxEditor.createServer(docx(body), { author: 'Writer' });
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const range = c.document.body.getRange('Content');
          await c.sync();
          range.delete();
          await c.sync();
        })
      ).rejects.toThrow();
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('continuation never extends another author’s pending text', async () => {
  const runtime = await DocxEditor.createServer(
    docx('<w:p><w:ins w:id="9" w:author="Other"><w:r><w:t>Pending text</w:t></w:r></w:ins></w:p>'),
    { author: 'Writer' }
  );
  try {
    const before = await runtime.save();
    await expect(
      runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.insertParagraph('New clause', 'End');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotImplemented' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

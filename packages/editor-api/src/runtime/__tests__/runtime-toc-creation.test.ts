/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

test('TOC field creation preserves switches through save and refuses unsupported evaluation', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Contents')));
  try {
    await runtime.run(async (c) => {
      const field = c.document.body
        .getRange('End')
        .insertField('After', 'TOC', '\\o "1-3" \\h \\z \\u');
      await c.sync();
      field.load('code');
      await c.sync();
      expect(field.code).toBe('TOC \\o "1-3" \\h \\z \\u');
      field.updateResult();
      await expect(c.sync()).rejects.toMatchObject({ code: 'NotSupported' });
    });
    const bytes = await runtime.save();
    expect(strFromU8(unzipSync(bytes)['word/document.xml']!)).toContain('&quot;1-3&quot;');
    const reopened = await DocxEditor.createServer(bytes);
    try {
      await reopened.run(async (c) => {
        c.document.body.fields.load('items');
        c.document.body.load('text');
        await c.sync();
        expect(c.document.body.text).toBe('Contents');
        expect(c.document.body.fields.items).toHaveLength(1);
        c.document.body.fields.items[0]!.load('code');
        await c.sync();
        expect(c.document.body.fields.items[0]!.code).toBe('TOC \\o "1-3" \\h \\z \\u');
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

for (const switches of [
  '\\o "3-1"',
  '\\o "1-30"',
  '\\h \\h',
  '\\x',
  '\\h "1-3"',
  'INCLUDETEXT "https://example.com"',
  '<w:r/>',
  'x'.repeat(129),
]) {
  test(`TOC refuses invalid switches ${switches.slice(0, 30)}`, async () => {
    const runtime = await DocxEditor.createServer(docx(p('Keep')));
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (c) => {
          c.document.body.getRange('End').insertField('After', 'TOC', switches);
          await c.sync();
        })
      ).rejects.toBeDefined();
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('tracked TOC creation refuses without changing the document', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Keep')), { author: 'Writer' });
  try {
    const before = await runtime.save();
    await expect(
      runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.getRange('End').insertField('After', 'TOC');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

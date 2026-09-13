/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, p, serverRuntime } from '../../model/__tests__/support/documents.ts';

test('optional lookups can load scalar properties before sync when no item exists', async () => {
  const runtime = await serverRuntime(docx(p('No optional objects')));
  await runtime.run(async (context) => {
    const table = context.document.body.tables.getFirstOrNullObject();
    const control = context.document.contentControls.getByTag('missing').getFirstOrNullObject();
    const field = context.document.body.fields.getFirstOrNullObject();
    const picture = context.document.body.inlinePictures.getFirstOrNullObject();
    const range = context.document.body.search('missing').getFirstOrNullObject();
    table.load('values');
    control.load('text');
    field.load('code');
    picture.load('width');
    range.load('text');
    await context.sync();
    for (const object of [table, control, field, picture, range])
      expect(object.isNullObject).toBe(true);
    expect(() => table.values).toThrow(expect.objectContaining({ code: 'PropertyNotLoaded' }));
    expect(() => table.delete()).toThrow(expect.objectContaining({ code: 'InvalidObjectPath' }));
    table.load('values');
    await context.sync();
    expect(table.isNullObject).toBe(true);
    context.document.body.insertParagraph('Still usable', 'End');
    await context.sync();
  });
  runtime.dispose();
});

test('a write through a missing optional object still refuses the entire write batch', async () => {
  const runtime = await serverRuntime(docx(p('Untouched')));
  const before = await runtime.save();
  await expect(
    runtime.run(async (context) => {
      const table = context.document.body.tables.getFirstOrNullObject();
      table.load('values');
      table.headerRowCount = 1;
      context.document.body.insertParagraph('Must roll back', 'End');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidObjectPath' });
  expect(await runtime.save()).toEqual(before);
  runtime.dispose();
});

test('optional scalar loads still hydrate real objects', async () => {
  const runtime = await serverRuntime(docx(p('Present')));
  await runtime.run(async (context) => {
    const range = context.document.body.search('Present').getFirstOrNullObject();
    range.load('text');
    await context.sync();
    expect(range.isNullObject).toBe(false);
    expect(range.text).toBe('Present');
  });
  runtime.dispose();
});

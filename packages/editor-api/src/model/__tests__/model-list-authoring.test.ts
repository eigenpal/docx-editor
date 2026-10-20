/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { docx, p, mainXmlOf, reopen, serverRuntime } from './support/documents.ts';

const fixture = docx(p('first') + p('nested') + p('last') + p('untouched'));

test('an agent creates, formats, nests, restarts and detaches list items through the public model', async () => {
  const runtime = await serverRuntime(fixture);
  let id = 0;
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const list = paragraphs.items[0]!.startNewList();
    await context.sync();
    list.setLevelNumbering(0, 'Arabic');
    list.setLevelStartingNumber(0, 4);
    list.setLevelIndents(0, 36, -18);
    await context.sync();
    list.load('id');
    await context.sync();
    id = list.id;
    paragraphs.items[1]!.attachToList(id, 1);
    paragraphs.items[2]!.attachToList(id, 0);
    await context.sync();
    list.setLevelBullet(1, 'Square');
    await context.sync();
    paragraphs.items[2]!.listItem.level = 2;
    await context.sync();
    paragraphs.items[2]!.detachFromList();
    await context.sync();
  });
  const reopened = await reopen(runtime);
  await reopened.run(async (context) => {
    const list = context.document.body.lists.getById(id);
    await context.sync();
    list.paragraphs.load('items');
    await context.sync();
    expect(list.paragraphs.items).toHaveLength(2);
    for (const paragraph of list.paragraphs.items) {
      paragraph.load('text');
      paragraph.listItem.load('level');
    }
    await context.sync();
    expect(list.paragraphs.items.map((p) => [p.text, p.listItem.level])).toEqual([
      ['first', 0],
      ['nested', 1],
    ]);
  });
  const parts = unzipSync(await reopened.save());
  const numbering = strFromU8(parts['word/numbering.xml']!);
  expect(numbering).toContain('<w:start w:val="4"');
  expect(numbering).toContain('<w:numFmt w:val="decimal"');
  expect(numbering).toContain('w:ascii="Wingdings"');
  const xml = await mainXmlOf(reopened);
  expect(xml).toContain('untouched');
  expect(xml).toContain('last');
});

test('locked paragraphs refuse list creation without leaking numbering resources', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:sdt><w:sdtPr><w:id w:val="7"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        p('locked') +
        '</w:sdtContent></w:sdt>' +
        p('outside')
    )
  );
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[0]!.startNewList();
      await context.sync();
    })
  ).rejects.toBeDefined();
  expect(await mainXmlOf(runtime)).toBe(before);
  expect(unzipSync(await runtime.save())['word/numbering.xml']).toBeUndefined();
});

test('list level validation rejects prose, unknown IDs and out-of-range levels without edits', async () => {
  const runtime = await serverRuntime(fixture);
  const before = await mainXmlOf(runtime);
  for (const action of ['prose', 'unknown', 'invalid'] as const) {
    await expect(
      runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        await context.sync();
        if (action === 'prose') paragraph.listItem.level = 1;
        if (action === 'unknown') paragraph.attachToList(999, 0);
        if (action === 'invalid') paragraph.attachToList(1, 9);
        await context.sync();
      })
    ).rejects.toBeDefined();
  }
  expect(await mainXmlOf(runtime)).toBe(before);
});

test('independent list-level formats batch with item membership and preserve atomic refusal', async () => {
  const runtime = await serverRuntime(fixture);
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const list = paragraphs.items[0]!.startNewList();
    await context.sync();
    list.load('id');
    await context.sync();
    list.setLevelNumbering(0, 'Arabic');
    list.setLevelStartingNumber(0, 4);
    list.setLevelBullet(1, 'Square');
    list.setLevelIndents(1, 72, -18);
    paragraphs.items[1]!.attachToList(list.id, 1);
    paragraphs.items[0]!.listItem.level = 1;
    await context.sync();
    for (const paragraph of paragraphs.items.slice(0, 2)) paragraph.listItem.load('level');
    await context.sync();
    expect(paragraphs.items.slice(0, 2).map((paragraph) => paragraph.listItem.level)).toEqual([
      1, 1,
    ]);
    const before = await runtime.save();
    list.setLevelStartingNumber(0, 99);
    paragraphs.items[2]!.attachToList(999999, 0);
    await expect(context.sync()).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await runtime.save()).toEqual(before);
    list.setLevelStartingNumber(0, 5);
    await context.sync();
  });
  const saved = await runtime.save();
  const numbering = strFromU8(unzipSync(saved)['word/numbering.xml']!);
  expect(numbering).toContain('<w:start w:val="5"');
  expect(numbering).toContain('<w:numFmt w:val="decimal"');
  expect(numbering).toContain('w:ascii="Wingdings"');
  expect(numbering).toContain('w:left="1440"');
  const reopened = await reopen(runtime);
  await reopened.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    for (const paragraph of paragraphs.items.slice(0, 2)) paragraph.listItem.load('level');
    await context.sync();
    expect(paragraphs.items.slice(0, 2).map((paragraph) => paragraph.listItem.level)).toEqual([
      1, 1,
    ]);
  });
  reopened.dispose();
  runtime.dispose();
});

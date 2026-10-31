/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Setting `listItem.level` on an item with its own left or first-line indent moves the item to
// the new level's indent. The paragraph's right indent stays.
import { expect, test } from 'bun:test';
import { docx, p, mainXmlOf, reopen, serverRuntime } from './support/documents.ts';

const fixture = docx(p('first') + p('moved') + p('peer'));

test('a new list level replaces the item’s own left and first-line indent', async () => {
  const runtime = await serverRuntime(fixture);
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const list = paragraphs.items[0]!.startNewList();
    list.load('id');
    await context.sync();
    paragraphs.items[1]!.attachToList(list.id, 1);
    paragraphs.items[2]!.attachToList(list.id, 2);
    await context.sync();
    const moved = paragraphs.items[1]!;
    moved.leftIndent = 54;
    moved.firstLineIndent = -18;
    moved.rightIndent = 20;
    await context.sync();
    moved.listItem.level = 2;
    await context.sync();
  });
  const reopened = await reopen(runtime);
  await reopened.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/leftIndent,items/firstLineIndent,items/rightIndent');
    await context.sync();
    const [, moved, peer] = paragraphs.items;
    expect(moved!.leftIndent).toBe(peer!.leftIndent);
    expect(moved!.firstLineIndent).toBe(peer!.firstLineIndent);
    expect(moved!.leftIndent).not.toBe(54);
    expect(moved!.rightIndent).toBe(20);
  });
  const xml = await mainXmlOf(reopened);
  const movedXml = /<w:p\b(?:(?!<\/w:p>).)*>moved<\/w:t>/.exec(xml)?.[0] ?? '';
  expect(movedXml).toContain('<w:ilvl w:val="2"/>');
  expect(movedXml).toMatch(/<w:ind w:right="400"\/>/);
});

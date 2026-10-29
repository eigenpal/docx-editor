/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Lists that `startNewList()` creates share one list template, and every list over one template
// counts on one shared counter. Each new list must still number on its own, and a starting
// number must apply to its own list only. The saved document is laid out to read the numbers.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { docx, p, serverRuntime } from './support/documents.ts';

/** The list number of every numbered paragraph in the saved document, in reading order. */
function savedNumbers(bytes: Uint8Array): string[] {
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  try {
    return editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .flatMap((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
      );
  } finally {
    editor.destroy();
  }
}

async function twoNumberedLists(secondStart?: number): Promise<string[]> {
  const runtime = await serverRuntime(docx(p('a1') + p('a2') + p('b1') + p('b2')));
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    for (const [index, start] of [
      [0, undefined],
      [2, secondStart],
    ] as const) {
      // Creation is the only mutation in its sync; the returned list is addressable after it.
      const list = paragraphs.items[index]!.startNewList();
      await context.sync();
      list.load('id');
      await context.sync();
      list.setLevelNumbering(0, 'Arabic');
      if (start !== undefined) list.setLevelStartingNumber(0, start);
      paragraphs.items[index + 1]!.attachToList(list.id, 0);
      await context.sync();
    }
  });
  const numbers = savedNumbers(await runtime.save());
  runtime.dispose();
  return numbers;
}

test('two new numbered lists each start at one', async () => {
  expect(await twoNumberedLists()).toEqual(['1.', '2.', '1.', '2.']);
});

test('a starting number applies to its own list only', async () => {
  expect(await twoNumberedLists(5)).toEqual(['1.', '2.', '5.', '6.']);
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Bookmark writes through a browser runtime: they land in the open editor, one undo step each,
// and the editor's own bookmark list answers them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { docx, p } from './support/docx.ts';

test('insertBookmark and deleteBookmark edit the open document as undoable steps', async () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(p('Hello world')) });
  const runtime = DocxEditorBrowser.createBrowser(editor);
  await runtime.run(async (context) => {
    const found = context.document.body.search('world');
    found.load('items');
    await context.sync();
    found.items[0]!.insertBookmark('Greeting');
    await context.sync();
  });
  expect(editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name)).toEqual([
    'Greeting',
  ]);
  const text = await runtime.run(async (context) => {
    const range = context.document.getBookmarkRange('GREETING');
    range.load('text');
    await context.sync();
    return range.text;
  });
  expect(text).toBe('world');
  await runtime.run(async (context) => {
    context.document.deleteBookmark('greeting');
    await context.sync();
  });
  expect(editor.query({ type: 'bookmarks' })).toEqual([]);
  editor.exec({ type: 'undo' });
  expect(editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name)).toEqual([
    'Greeting',
  ]);
  runtime.dispose();
  editor.destroy();
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Going to a bookmark the Office.js way, in a browser editor:
// `getBookmarkRangeOrNullObject(name)` then `range.select()`, for a bookmark in the main
// text, a header, a footer and a footnote.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { DocxEditor } from '../../index.ts';
import { isDocxEditorError } from '../errors.ts';
import { WITH_STORY_BOOKMARKS } from '../../model/__tests__/support/documents.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(mode?: 'view'): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: WITH_STORY_BOOKMARKS,
    ...(mode ? { mode } : {}),
  });
  editors.push(editor);
  return editor;
}

/** Go to a bookmark as a script does; answers whether the name was found. */
async function goTo(editor: DocxEditorInstance, name: string): Promise<boolean> {
  const runtime = DocxEditorBrowser.createBrowser(editor);
  try {
    return await runtime.run(async (context) => {
      const range = context.document.getBookmarkRangeOrNullObject(name);
      range.load('text');
      await context.sync();
      if (range.isNullObject) return false;
      range.select();
      await context.sync();
      return true;
    });
  } finally {
    runtime.dispose();
  }
}

/** The selected text's story and offsets. */
function selected(editor: DocxEditorInstance) {
  const selection = editor.surface!.state().selection;
  const scope = editor.snapshot().scope;
  return { scope: scope.kind, from: selection.anchor.offset, to: selection.head.offset };
}

describe('Range.select on a bookmark range', () => {
  test('selects a bookmark in the main text', async () => {
    const editor = mount();
    expect(await goTo(editor, 'inbody')).toBe(true);
    expect(selected(editor)).toEqual({ scope: 'body', from: 0, to: 'in the body'.length });
  });

  test('selects a bookmark in a header, a footer and a footnote, in that story', async () => {
    for (const [name, scope, text] of [
      ['InHeader', 'headerFooter', 'in the header'],
      ['InFooter', 'headerFooter', 'in the footer'],
      ['InNote', 'note', 'in the footnote'],
    ] as const) {
      const editor = mount();
      expect(await goTo(editor, name)).toBe(true);
      expect(selected(editor)).toEqual({ scope, from: 0, to: text.length });
    }
  });

  test('a missing name answers a null object, and nothing moves', async () => {
    const editor = mount();
    const before = editor.surface!.state().selection;
    expect(await goTo(editor, 'Missing')).toBe(false);
    expect(editor.surface!.state().selection).toEqual(before);
  });

  test('a read-only editor selects in the main text and refuses a header with NotSupported', async () => {
    const editor = mount('view');
    expect(await goTo(editor, 'InBody')).toBe(true);
    expect(selected(editor)).toEqual({ scope: 'body', from: 0, to: 'in the body'.length });
    let code: string | null = null;
    try {
      await goTo(editor, 'InHeader');
    } catch (error) {
      if (isDocxEditorError(error)) code = error.code;
      else throw error;
    }
    expect(code).toBe('NotSupported');
    expect(selected(editor).scope).toBe('body');
  });

  test('a server runtime refuses select with NotSupported', async () => {
    const runtime = await DocxEditor.createServer(WITH_STORY_BOOKMARKS);
    let code: string | null = null;
    try {
      await runtime.run(async (context) => {
        const range = context.document.getBookmarkRange('InBody');
        range.load('text');
        await context.sync();
        range.select();
        await context.sync();
      });
    } catch (error) {
      if (isDocxEditorError(error)) code = error.code;
      else throw error;
    }
    expect(code).toBe('NotSupported');
  });
});

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
import { docx, p } from './support/docx.ts';

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

  test('a select cannot share a sync with a write that creates a header', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(p('Hello world')) });
    editors.push(editor);
    const runtime = DocxEditorBrowser.createBrowser(editor);
    let code: string | null = null;
    try {
      await runtime.run(async (context) => {
        const found = context.document.body.search('world');
        found.load('items');
        const section = context.document.sections.getFirst();
        await context.sync();
        const header = section.getHeader('Primary');
        await context.sync();
        // Creating a header commits alone, so a selection in the same sync is refused, and
        // the whole batch with it: nothing is written and the caret stays.
        header.insertText('Created', 'Replace');
        found.items[0]!.select();
        await context.sync();
      });
    } catch (error) {
      if (isDocxEditorError(error)) code = error.code;
      else throw error;
    } finally {
      runtime.dispose();
    }
    expect(code).toBe('ConflictingChanges');
    const parts = [...editor.surface!.session.currentPackage()!.parts.keys()];
    expect(parts.some((name) => /header/.test(name))).toBe(false);
  });

  test('a select the editor cannot place rejects the sync, also after a write', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(p('Hello world') + p('Other')) });
    editors.push(editor);
    // The editor refuses to place any selection: the last gate, after planning passed.
    const exec = editor.exec.bind(editor);
    editor.exec = ((command: Parameters<typeof exec>[0]) =>
      command.type === 'setSelection'
        ? { ok: false, code: 'unsupported', reason: 'refused for the test' }
        : exec(command)) as typeof exec;
    const runtime = DocxEditorBrowser.createBrowser(editor);
    const attempt = async (write: boolean) => {
      let code: string | null = null;
      try {
        await runtime.run(async (context) => {
          const found = context.document.body.search('world');
          found.load('items');
          await context.sync();
          // A write to another paragraph, so the batch itself plans cleanly.
          if (write) context.document.body.paragraphs.getLast().insertText('!', 'End');
          found.items[0]!.select();
          await context.sync();
        });
      } catch (error) {
        if (isDocxEditorError(error)) code = error.code;
        else throw error;
      }
      return code;
    };
    try {
      expect(await attempt(false)).toBe('NotSupported');
      // With a write in the same sync: the write has committed, and the sync still rejects.
      expect(await attempt(true)).toBe('NotSupported');
      const text = await runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        await context.sync();
        return body.text;
      });
      expect(text).toContain('Other!');
    } finally {
      runtime.dispose();
    }
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

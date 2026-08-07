/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The two ways a consumer gets a runtime, over the real core hosts.
//
// Everything else in this directory drives `createRuntime` directly, which is right for pinning
// lifecycle behaviour but proves nothing about the two functions consumers actually call. So this
// file uses only the public entry: bytes in one case, a mounted editor in the other, and the same
// object model over both — which is the claim the whole architecture is for.
//
// The browser half needs a DOM before the editor module is evaluated, hence the registration
// above the imports.
//
// Two namespaces, from the two entries a consumer imports: the package root and its browser
// subpath.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { DocxEditor } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { DocxEditorRuntime } from '../runtime.ts';
import { docx, p, TWO_PARAGRAPHS } from './support/docx.ts';

/**
 * The story's text, over either runtime.
 *
 * Typed as the base `DocxEditorRuntime` on purpose: the server runtime is that plus `save()`, so
 * one function taking the base is the claim these tests exist to make — the same script drives
 * bytes and an open editor, and nothing in it knows which.
 */
function bodyText(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

describe('DocxEditor.createServer', () => {
  test('opens bytes into a runtime that reads, writes and saves', async () => {
    const runtime = await DocxEditor.createServer(docx(p('server')));
    expect(await bodyText(runtime)).toBe('server');

    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.insertText('the ', 'Start');
      await context.sync();
    });

    const saved = await runtime.save();
    const reopened = await DocxEditor.createServer(saved);
    expect(await bodyText(reopened)).toBe('the server');
    runtime.dispose();
    reopened.dispose();
  });

  test('reports the capabilities a headless host has, and only those', async () => {
    const runtime = await DocxEditor.createServer(TWO_PARAGRAPHS);
    expect(runtime.capabilities).toMatchObject({
      document: true,
      save: true,
      selection: false,
      scrolling: false,
      layout: false,
    });
    expect(typeof runtime.save).toBe('function');
    runtime.dispose();
  });

  test('enumerates body bookmarks headlessly and releases the collection with its run', async () => {
    const runtime = await DocxEditor.createServer(
      docx(
        '<w:p><w:bookmarkStart w:id="1" w:name="Headless"/>' +
          '<w:r><w:t>server bookmark</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
      )
    );
    const escaped = await runtime.run(async (context) => {
      const bookmarks = context.document.body.bookmarks;
      bookmarks.load('items');
      await context.sync();
      const bookmark = bookmarks.items[0]!;
      bookmark.load('name');
      await context.sync();
      expect(bookmark.name).toBe('Headless');
      return bookmarks;
    });
    expect(() => escaped.load()).toThrowError(
      expect.objectContaining({ code: 'InvalidObjectPath' })
    );
    runtime.dispose();
  });

  test('refuses bytes that are not a document, without throwing anything untyped', async () => {
    await expect(DocxEditor.createServer(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: 'InvalidArgument',
      target: 'createServer',
    });
  });

  test('dispose is idempotent and everything after it is refused', async () => {
    const runtime = await DocxEditor.createServer(TWO_PARAGRAPHS);
    runtime.dispose();
    runtime.dispose();
    await expect(runtime.save()).rejects.toMatchObject({ code: 'RuntimeDisposed' });
  });
});

describe('DocxEditor.createBrowser', () => {
  function mount(): { editor: ReturnType<typeof createDocxEditor>; container: HTMLElement } {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: TWO_PARAGRAPHS });
    if (!editor.surface) throw new Error('surface failed to mount');
    return { editor, container };
  }

  function mountScrollable(bookmarked = false): {
    editor: ReturnType<typeof createDocxEditor>;
    scroller: HTMLElement;
  } {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const container = document.createElement('div');
    scroller.append(container);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = next;
      },
      configurable: true,
    });
    scroller.scrollTo = ((options: ScrollToOptions) => {
      scrollTop = options.top ?? 0;
    }) as HTMLElement['scrollTo'];
    const body = Array.from({ length: 120 }, (_, index) => {
      if (index !== 119) return p(`paragraph ${index}`);
      if (!bookmarked) return p('automation target');
      return (
        '<w:p><w:bookmarkStart w:id="1" w:name="AutomationTarget"/>' +
        '<w:r><w:t>automation target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
      );
    }).join('');
    const editor = createDocxEditor({ container, document: docx(body) });
    if (!editor.surface) throw new Error('surface failed to mount');
    return { editor, scroller };
  }

  test('reads the document that is already open', async () => {
    const { editor } = mount();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    expect(await bodyText(runtime)).toBe('alpha\rbeta');
    runtime.dispose();
  });

  test('a batch through the runtime lands in the editor and repaints it', async () => {
    const { editor, container } = mount();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    const before = editor.snapshot();

    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.insertText('ZZ', 'Start');
      await context.sync();
    });

    expect(await bodyText(runtime)).toBe('ZZalpha\rbeta');
    expect(container.textContent).toContain('ZZalpha');
    expect(editor.snapshot()).not.toBe(before);
    runtime.dispose();
  });

  test('claims the browser capabilities and offers no save of its own', async () => {
    // The editor it borrowed owns saving; a second way to do it would be a second answer to
    // "what is the current document".
    const { editor } = mount();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    expect(runtime.capabilities).toMatchObject({
      document: true,
      save: false,
      selection: true,
      scrolling: true,
      layout: true,
    });
    expect('save' in runtime).toBe(false);
    runtime.dispose();
  });

  test('Range.select reveals an offscreen result and preserves its logical range', async () => {
    const { editor, scroller } = mountScrollable();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    expect(scroller.scrollTop).toBe(0);

    await runtime.run(async (context) => {
      const matches = context.document.body.search('automation target', { matchCase: true });
      matches.load();
      await context.sync();
      matches.items[0]!.select();
      await context.sync();
    });

    const selection = editor.surface!.state().selection;
    expect(selection.anchor.paragraphId).toBe(selection.head.paragraphId);
    expect(selection.anchor.offset).toBe(0);
    expect(selection.head.offset).toBe('automation target'.length);
    expect(scroller.scrollTop).toBeGreaterThan(0);

    const caret = caretAt(editor.surface!.layout(), selection.head);
    expect(caret).not.toBeNull();
    const page = editor.surface!.layout().pages.find((entry) => entry.index === caret!.pageIndex);
    expect(page).toBeDefined();
    const targetTop = (page!.contentBox.y + caret!.y) * (96 / 72);
    expect(targetTop).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(targetTop).toBeLessThanOrEqual(scroller.scrollTop + scroller.clientHeight);

    runtime.dispose();
    editor.destroy();
    scroller.remove();
  });

  test('Bookmark.select resolves and reveals an offscreen bookmark in one selection sync', async () => {
    const { editor, scroller } = mountScrollable(true);
    const runtime = DocxEditorBrowser.createBrowser(editor);
    expect(scroller.scrollTop).toBe(0);

    await runtime.run(async (context) => {
      const matches = context.document.body.search('automation target', { matchCase: true });
      matches.load();
      await context.sync();
      const bookmarks = matches.items[0]!.bookmarks;
      bookmarks.load();
      await context.sync();
      // No `bookmark.range` read or intermediate sync: selection resolves the current marker pair
      // inside this batch.
      bookmarks.items[0]!.select();
      await context.sync();
    });

    const selection = editor.surface!.state().selection;
    expect(selection.anchor.paragraphId).toBe(selection.head.paragraphId);
    expect(selection.anchor.offset).toBe(0);
    expect(selection.head.offset).toBe('automation target'.length);
    expect(scroller.scrollTop).toBeGreaterThan(0);

    const caret = caretAt(editor.surface!.layout(), selection.head);
    expect(caret).not.toBeNull();
    const page = editor.surface!.layout().pages.find((entry) => entry.index === caret!.pageIndex);
    expect(page).toBeDefined();
    const targetTop = (page!.contentBox.y + caret!.y) * (96 / 72);
    expect(targetTop).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(targetTop).toBeLessThanOrEqual(scroller.scrollTop + scroller.clientHeight);

    runtime.dispose();
    editor.destroy();
    scroller.remove();
  });

  test('disposing the runtime leaves the editor mounted and editable', async () => {
    const { editor, container } = mount();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    await bodyText(runtime);
    runtime.dispose();

    editor.surface!.selectAll();
    editor.exec({ type: 'insertText', text: 'typed' });
    expect(container.textContent).toContain('typed');
    await expect(runtime.run(async () => 1)).rejects.toMatchObject({ code: 'RuntimeDisposed' });
  });

  test('a refused batch leaves the open document exactly as it was', async () => {
    const { editor, container } = mount();
    const runtime = DocxEditorBrowser.createBrowser(editor);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      // Two changes that both claim the second paragraph: refused as a batch, so the first
      // paragraph's insertion never reaches the open document either.
      paragraphs.items[0]!.insertText('good ', 'Start');
      paragraphs.items[1]!.insertParagraph('beside', 'After');
      paragraphs.items[1]!.insertText('bad ', 'Start');
      await expect(context.sync()).rejects.toMatchObject({ code: 'ConflictingChanges' });
    });
    expect(await bodyText(runtime)).toBe('alpha\rbeta');
    expect(container.textContent).not.toContain('good');
    runtime.dispose();
  });
});

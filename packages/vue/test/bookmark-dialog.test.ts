// The Vue twin of `packages/react/test/bookmark-dialog.test.tsx`: the Insert menu opens the
// dialog, the list sorts by name or location and shows hidden bookmarks on request, Add
// bookmarks the selection and closes, Delete and Go To act on the picked bookmark, and invalid
// names explain why.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorBookmarkDialog } from '../src/editor/DocxEditorBookmark';
import { mountEditorTree } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r><w:bookmarkStart w:id="1" w:name="Zeta"/>' +
      '<w:r><w:t>beta</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
      '<w:p><w:bookmarkStart w:id="2" w:name="_Toc1"/><w:r><w:t>Delta</w:t></w:r>' +
      '<w:bookmarkEnd w:id="2"/><w:bookmarkStart w:id="3" w:name="alpha"/><w:bookmarkEnd w:id="3"/></w:p>' +
      '</w:body></w:document>'
  ),
});

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

const dialog = () => document.querySelector('[data-docx-dialog="bookmark"]');
const nameInput = () =>
  document.querySelector<HTMLInputElement>('[data-docx-dialog="bookmark"] input[type="text"]')!;
const list = () =>
  document.querySelector<HTMLSelectElement>('[data-docx-dialog="bookmark"] select')!;
const options = () => [...list().options].map((option) => option.value);
const message = () =>
  document.querySelector('[data-docx-dialog="bookmark"] [data-docx-part="error"]')!.textContent;

function control(label: string): HTMLInputElement {
  const owner = [...document.querySelectorAll('[data-docx-dialog="bookmark"] label')].find(
    (node) => node.textContent?.trim() === label
  );
  if (!owner) throw new Error(`no label ${label}`);
  return owner.querySelector('input')!;
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('[data-docx-dialog="bookmark"] button')].find(
    (node) => node.textContent?.trim() === text
  );
  if (!found) throw new Error(`no button ${text}`);
  return found as HTMLButtonElement;
}

async function type(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input'));
  await flush();
}

const names = (editor: DocxEditorInstance) =>
  editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name);

async function openDialog(onClose: () => void = () => {}) {
  const view = mountEditorTree(() => h(DocxEditorBookmarkDialog, { open: true, onClose }), SOURCE);
  await flush();
  return view;
}

describe('DocxEditor.BookmarkDialog (Vue)', () => {
  test('the Insert menu opens the dialog, and Add bookmarks the selection and closes', async () => {
    const view = mountEditorTree(() => h(DocxEditorMenu), SOURCE);
    await flush();
    const surface = view.editor().surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
    const trigger = view.container.querySelector(
      '[data-menu="insert"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const row = view.container.querySelector('[data-slot="insert.bookmark"]') as HTMLElement;
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    row.click();
    await flush();
    expect(dialog()).not.toBeNull();
    await type(nameInput(), 'Intro');
    button('Add').click();
    await flush();
    expect(dialog()).toBeNull();
    expect(names(view.editor())).toEqual(['Intro', 'Zeta', '_Toc1', 'alpha']);
    view.unmount();
  });

  test('the list sorts by name or location and shows hidden bookmarks on request', async () => {
    const view = await openDialog();
    expect(options()).toEqual(['alpha', 'Zeta']);
    control('Location').click();
    await flush();
    expect(options()).toEqual(['Zeta', 'alpha']);
    control('Hidden bookmarks').click();
    await flush();
    expect(options()).toEqual(['Zeta', '_Toc1', 'alpha']);
    view.unmount();
  });

  test('invalid names disable Add and say why; an existing name explains the move', async () => {
    const view = await openDialog();
    await type(nameInput(), '1st');
    expect(button('Add').disabled).toBe(true);
    expect(message()).toBe('A bookmark name starts with a letter.');
    await type(nameInput(), 'two words');
    expect(message()).toBe('Use only letters, digits, and underscores.');
    await type(nameInput(), '_hidden');
    expect(button('Add').disabled).toBe(true);
    await type(nameInput(), 'ZETA');
    expect(button('Add').disabled).toBe(false);
    expect(message()).toBe('A bookmark with this name exists. Add moves it to the selection.');
    expect(nameInput().maxLength).toBe(40);
    view.unmount();
  });

  test('Delete removes the picked bookmark, and Go To selects one and keeps the dialog', async () => {
    let closed = 0;
    const view = await openDialog(() => (closed += 1));
    await type(list(), 'Zeta');
    expect(nameInput().value).toBe('Zeta');
    button('Go To').click();
    await flush();
    const selection = view.editor().surface!.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 10]);
    expect(closed).toBe(0);
    expect(button('Close')).toBeTruthy();
    button('Delete').click();
    await flush();
    expect(names(view.editor())).toEqual(['_Toc1', 'alpha']);
    expect(options()).toEqual(['alpha']);
    view.unmount();
  });

  test('Ctrl+Shift+F5 opens the dialog where the editor hosts its dialogs', async () => {
    const view = mountEditorTree(() => h(DocxEditorMenu), SOURCE);
    await flush();
    const pages = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const surface = view.editor().surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 7 }, head: { paragraphId, offset: 7 } });
    await flush();
    pages.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F5',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await flush();
    expect(dialog()).not.toBeNull();
    // Opened inside a bookmark, the dialog names it.
    expect(nameInput().value).toBe('Zeta');
    view.unmount();
  });
  test('the bookmark popup is replaceable, can be turned off, and opens by command', async () => {
    const mine = mountEditorTree(
      () => h(DocxEditorMenu),
      SOURCE,
      () => [],
      undefined,
      {
        popups: { bookmark: () => h('div', { role: 'dialog', 'aria-label': 'Mine' }) },
      }
    );
    await flush();
    expect(mine.editor().exec({ type: 'openBookmarkDialog' }).ok).toBe(true);
    await flush();
    expect(document.querySelector('[aria-label="Mine"]')).not.toBeNull();
    expect(dialog()).toBeNull();
    mine.unmount();

    const off = mountEditorTree(
      () => h(DocxEditorMenu),
      SOURCE,
      () => [],
      undefined,
      {
        popups: { bookmark: false },
      }
    );
    await flush();
    expect(off.editor().can({ type: 'openBookmarkDialog' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    const trigger = off.container.querySelector(
      '[data-menu="insert"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const row = off.container.querySelector('[data-slot="insert.bookmark"]') as HTMLElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    off.unmount();
  });

  test('a name with copies says so, and Keep first removes them', async () => {
    const copies = zipSync({
      ...Object.fromEntries(
        Object.entries(unzipSync(SOURCE)).filter(([path]) => path !== 'word/document.xml')
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:bookmarkStart w:id="1" w:name="Same"/><w:r><w:t>one</w:t></w:r>' +
          '<w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve"> </w:t></w:r>' +
          '<w:bookmarkStart w:id="2" w:name="SAME"/><w:r><w:t>two</w:t></w:r>' +
          '<w:bookmarkEnd w:id="2"/></w:p></w:body></w:document>'
      ),
    });
    const view = mountEditorTree(
      () => h(DocxEditorBookmarkDialog, { open: true, onClose: () => {} }),
      copies
    );
    await flush();
    await type(list(), 'Same');
    expect(message()).toBe('1 other place uses this name. Links and Go To use the first.');
    button('Keep first').click();
    await flush();
    expect(view.editor().query({ type: 'bookmarks' })).toMatchObject([
      { name: 'Same', duplicates: 0 },
    ]);
    expect(
      [...document.querySelectorAll('[data-docx-dialog="bookmark"] button')].some(
        (node) => node.textContent?.trim() === 'Keep first'
      )
    ).toBe(false);
    view.unmount();
  });
});

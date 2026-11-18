// The Vue twin of `packages/react/test/notes-context-menu.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { flush } from './helpers/fixtures';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const note = (id: number, text: string) =>
  `<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`;

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Body</w:t></w:r>` +
      `<w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>` +
      `<w:sectPr/></w:body></w:document>`
  ),
  'word/footnotes.xml': strToU8(
    `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `${note(1, 'First note.')}${note(2, 'Second note.')}</w:footnotes>`
  ),
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  let instance: DocxEditorInstance | null = null;
  const app = createApp({
    render: () =>
      h(DocxEditor, {
        document: SOURCE,
        onReady: (editor: unknown) => {
          instance = editor as DocxEditorInstance;
        },
      }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  return { container, editor: () => instance! };
}

const noteArea = (container: HTMLElement, scopeId: string) =>
  container.querySelector<HTMLElement>(`[data-docx-note][data-docx-note-scope="${scopeId}"]`)!;
const noteMenu = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="docx-notes-menu"]');
const documentMenu = (container: HTMLElement) =>
  container.ownerDocument.querySelector('.docx-contextmenu');

async function rightClick(target: Element): Promise<void> {
  target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
  );
  await flush();
}

test('a right-click in the note being edited opens the document menu only', async () => {
  const { container, editor } = await mount();
  editor().setActiveScope({ kind: 'note', id: 'footnote:1' });
  await flush();
  await rightClick(noteArea(container, 'footnote:1'));
  expect(noteMenu(container)).toBeNull();
  expect(documentMenu(container)).not.toBeNull();
});

test('a right-click on a note that is not being edited opens the note menu only', async () => {
  const { container, editor } = await mount();
  editor().setActiveScope({ kind: 'note', id: 'footnote:1' });
  await flush();
  await rightClick(noteArea(container, 'footnote:2'));
  expect(noteMenu(container)).not.toBeNull();
  expect(documentMenu(container)).toBeNull();
});

test('a right-click on a reference mark opens the note menu, visible to assistive technology', async () => {
  const { container } = await mount();
  await rightClick(container.querySelector('[data-docx-note-ref]')!);
  expect(noteMenu(container)).not.toBeNull();
  expect(documentMenu(container)).toBeNull();
  expect(noteMenu(container)!.closest('[aria-hidden="true"]')).toBeNull();
});

test('the note menu closes on a press outside, on Escape, and on a scroll', async () => {
  const { container } = await mount();
  const area = noteArea(container, 'footnote:1');

  await rightClick(area);
  expect(noteMenu(container)).not.toBeNull();
  container
    .querySelector('.docx-pages')!
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  await flush();
  expect(noteMenu(container)).toBeNull();

  await rightClick(area);
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  await flush();
  expect(noteMenu(container)).toBeNull();

  await rightClick(area);
  container.querySelector('.docx-editor__scroll-container')!.dispatchEvent(new Event('scroll'));
  await flush();
  expect(noteMenu(container)).toBeNull();
});

test('the note menu is a styled, keyboard-operable list that closes when it opens a dialog', async () => {
  const { container } = await mount();
  await rightClick(noteArea(container, 'footnote:1'));
  const menu = noteMenu(container)!;
  expect(menu.classList.contains('docx-notes-menu')).toBe(true);
  expect(menu.getAttribute('aria-label')).toBe('Note actions');
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(items.every((item) => item.classList.contains('docx-hf-chrome__menu-item'))).toBe(true);

  const enabled = items.filter((item) => !item.disabled);
  expect(document.activeElement).toBe(enabled[0]!);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  await flush();
  expect(document.activeElement).toBe(enabled.at(-1)!);

  container.querySelector<HTMLElement>('[data-testid="docx-notes-menu-properties"]')!.click();
  await flush();
  expect(noteMenu(container)).toBeNull();
});

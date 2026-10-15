// The Vue twin of `packages/react/test/navigation-goto.test.tsx`: Ctrl+G and the `openGoTo`
// command open the Go to tab, the name box filters and moves through the bookmarks, Enter
// jumps and hands focus to the document, an unknown name says so in the pane, the list follows
// the document, and read-only documents jump too.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const mark = (id: number, name: string, text: string) =>
  `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="${id}"/>`;

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
      `<w:p>${mark(1, 'Intro', 'Opening')}</w:p>` +
      `<w:p>${mark(2, 'Section10', 'Tenth')}</w:p>` +
      `<w:p>${mark(3, 'Section2', 'Second')}</w:p>` +
      `<w:p>${mark(4, '_Toc1', 'Contents')}</w:p>` +
      '</w:body></w:document>'
  ),
});

const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

function mountPane(props: Record<string, unknown> = {}, rootProps: Record<string, unknown> = {}) {
  const view = mountEditorTree(
    () => [],
    SOURCE,
    () => [h(DocxEditorNavigation, props)],
    undefined,
    rootProps
  );
  mounted.push(view);
  return view;
}

const q = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;
const nameBox = (root: ParentNode) =>
  q(root, '#docx-nav-panel-goto input[role="combobox"]') as HTMLInputElement;
const rowNames = (root: ParentNode) =>
  [...root.querySelectorAll('#docx-nav-panel-goto [role="option"] .docx-nav__result-text')].map(
    (node) => node.textContent
  );
const message = (root: ParentNode) => q(root, '#docx-nav-panel-goto [role="status"]').textContent;

async function ctrlG(target: Element) {
  const event = new KeyboardEvent('keydown', {
    key: 'g',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  await flush();
  return event;
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

async function key(input: HTMLInputElement, name: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  await nextTick();
}

const selectedText = (editor: DocxEditorInstance) => {
  const { anchor, head } = editor.surface!.state().selection;
  const paragraphs = editor.surface!.session.paragraphIds();
  return `${paragraphs.indexOf(anchor.paragraphId)}:${anchor.offset}-${head.offset}`;
};

describe('Go to bookmark in the navigation pane (Vue)', () => {
  test('Ctrl+G opens the pane on Go to with the name box focused', async () => {
    const view = mountPane();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.focus();
    expect((await ctrlG(scroller)).defaultPrevented).toBe(true);
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(q(view.container, '#docx-nav-tab-goto').getAttribute('aria-selected')).toBe('true');
    expect(q(view.container, '#docx-nav-tab-goto').getAttribute('title')).toBe('Go to (Ctrl+G)');
    expect(document.activeElement).toBe(nameBox(view.container));
  });

  test('the openGoTo command opens the tab, and a pane without the shortcut leaves Ctrl+G', async () => {
    const view = mountPane({ goToShortcut: false });
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    expect((await ctrlG(scroller)).defaultPrevented).toBe(false);
    expect(view.editor().exec({ type: 'openGoTo' })).toEqual({ ok: true, changed: false });
    await flush();
    expect(q(view.container, '#docx-nav-tab-goto').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(nameBox(view.container));
  });

  test('lists visible bookmarks by name, numbers in order; hidden ones on request', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    expect(rowNames(view.container)).toEqual(['Intro', 'Section2', 'Section10']);
    q(view.container, '#docx-nav-panel-goto input[type="checkbox"]').click();
    await nextTick();
    expect(rowNames(view.container)).toEqual(['_Toc1', 'Intro', 'Section2', 'Section10']);
  });

  test('typing filters, the arrow keys move, and Enter jumps and hands focus back', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    const input = nameBox(view.container);
    input.focus();
    await type(input, 'sec');
    expect(rowNames(view.container)).toEqual(['Section2', 'Section10']);
    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    const active = input.getAttribute('aria-activedescendant')!;
    expect(view.container.querySelector(`[id="${active}"]`)?.textContent).toBe('Section10');
    await key(input, 'Enter');
    await flush();
    expect(selectedText(view.editor())).toBe('1:0-5');
    expect(document.activeElement?.closest('.docx-pages')).not.toBeNull();
  });

  test('an unknown name says so in the pane and moves nothing', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    const before = selectedText(view.editor());
    const input = nameBox(view.container);
    await type(input, 'Nowhere');
    expect(message(view.container)).toBe('No bookmarks match.');
    await key(input, 'Enter');
    expect(message(view.container)).toBe('No bookmark is named “Nowhere”.');
    expect(selectedText(view.editor())).toBe(before);
  });

  test('follows the document: a new bookmark appears, a deleted one goes', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    const editor = view.editor();
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'insertBookmark', name: 'Added' });
    editor.exec({ type: 'deleteBookmark', name: 'Intro' });
    await flush();
    expect(rowNames(view.container)).toEqual(['Added', 'Section2', 'Section10']);
  });

  test('jumps in a read-only document', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' }, { mode: 'view' });
    await flush();
    const input = nameBox(view.container);
    await type(input, 'section2');
    await key(input, 'Enter');
    expect(selectedText(view.editor())).toBe('2:0-6');
  });

  test('the highlight follows its bookmark when the rows move, and Home and End jump', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    const input = nameBox(view.container);
    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    const highlighted = () =>
      view.container.querySelector(`[id="${input.getAttribute('aria-activedescendant')}"]`)
        ?.textContent;
    expect(highlighted()).toBe('Section2');
    const editor = view.editor();
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 2 },
    });
    editor.exec({ type: 'insertBookmark', name: 'Above' });
    await flush();
    expect(rowNames(view.container)).toEqual(['Above', 'Intro', 'Section2', 'Section10']);
    expect(highlighted()).toBe('Section2');
    await key(input, 'End');
    expect(highlighted()).toBe('Section10');
    await key(input, 'Home');
    expect(highlighted()).toBe('Above');
  });

  test('Enter with nothing typed asks for a name', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'goto' });
    await flush();
    const input = nameBox(view.container);
    await key(input, 'Enter');
    expect(message(view.container)).toBe('Type a bookmark name, or pick one from the list.');
    await type(input, 'zzz');
    expect(input.getAttribute('aria-controls')).toBeNull();
  });
});

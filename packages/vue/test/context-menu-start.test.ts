// `ContextMenu.Start` in Vue: the same placement rules as the React adapter.

import './dom-setup.ts';

import { expect, test } from 'bun:test';
import { Fragment, defineComponent, h, type VNode } from 'vue';
import { ContextMenu } from '../src/editor/contextmenu';
import { flush, mountEditorTree } from './helpers/mount';

function openContextMenu(container: HTMLElement): void {
  const target =
    container.querySelector('.docx-paginated-surface') ??
    container.querySelector('.docx-editor__scroll-container')!;
  target.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      button: 2,
    })
  );
}

async function rowsOf(menu: () => VNode): Promise<string[]> {
  const view = mountEditorTree(() => [], undefined, menu);
  await flush();
  openContextMenu(view.container);
  await flush();
  const rows = [
    ...view.container.querySelectorAll(
      '.docx-contextmenu [role="menuitem"], .docx-contextmenu [role="separator"]'
    ),
  ].map((row) => (row.getAttribute('role') === 'separator' ? '---' : (row.textContent ?? '')));
  view.unmount();
  return rows;
}

async function warningsDuring(run: () => Promise<unknown>): Promise<string[]> {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (message: unknown) => {
    messages.push(String(message));
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return messages;
}

const item = (label: string) => h(ContextMenu.Item, { label });
const start = (...rows: VNode[]) => h(ContextMenu.Start, null, { default: () => rows });

test('every Start in a Fragment moves up, and the Fragment rows beside it stay below', async () => {
  const rows = await rowsOf(() =>
    h(ContextMenu, null, {
      default: () => [
        h(Fragment, [start(item('first')), item('tail'), h(Fragment, [start(item('second'))])]),
      ],
    })
  );
  expect(rows.slice(0, 4)).toEqual(['first', '---', 'second', '---']);
  expect(rows.at(-1)).toBe('tail');
});

test('the Start separator is a direct child of the panel, where the edge rule hides it', async () => {
  const view = mountEditorTree(
    () => [],
    undefined,
    () => h(ContextMenu, null, { default: () => [start()] })
  );
  await flush();
  openContextMenu(view.container);
  await flush();
  const first = view.container.querySelector('.docx-contextmenu')?.firstElementChild;
  expect(first?.classList.contains('docx-toolbar__menu-separator')).toBe(true);
  view.unmount();
});

const Suggestions = defineComponent({
  name: 'Suggestions',
  setup: () => () => start(item('suggestion')),
});

test('a Start that a component returns warns, and a Start the menu hoists does not', async () => {
  const notDirect = (text: string) => text.includes('not a direct child of ContextMenu');
  const quiet = await warningsDuring(async () => {
    await rowsOf(() => h(ContextMenu, null, { default: () => [start(h(Suggestions))] }));
    await rowsOf(() => h(ContextMenu, { preset: false }, { default: () => [h(Suggestions)] }));
  });
  expect(quiet.some(notDirect)).toBe(false);
  let rows: string[] = [];
  const loud = await warningsDuring(async () => {
    rows = await rowsOf(() => h(ContextMenu, null, { default: () => [h(Suggestions)] }));
  });
  expect(loud.some(notDirect)).toBe(true);
  expect(rows.at(-2)).toBe('suggestion');
});

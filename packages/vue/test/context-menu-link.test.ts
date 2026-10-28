// The Vue twin of `packages/react/test/context-menu-link.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink';
import { docx, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';

const SOURCE = docx('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
const PID = '/word/document.xml#0.0.0';
const t = (key: string) => key;
const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

async function mount(): Promise<MountedEditor> {
  const view = mountEditorTree(
    () => [],
    SOURCE,
    () => [h(DocxEditorHyperLink), h(DocxEditorContextMenu, { t })]
  );
  mounted.push(view);
  await flush();
  return view;
}

async function selectAndRightClick(view: MountedEditor): Promise<void> {
  view.editor().surface!.setSelection({
    anchor: { paragraphId: PID, offset: 6 },
    head: { paragraphId: PID, offset: 13 },
  });
  await flush();
  const surface = view.container.querySelector('.docx-paginated-surface')!;
  surface.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
  );
  await flush();
}

const linkRow = (view: MountedEditor) =>
  view.container.querySelector<HTMLElement>('[role="menu"] [data-slot="text.link"]');
const popup = (view: MountedEditor) =>
  view.container.querySelector<HTMLElement>('[data-testid="hyperlink-popup"]');

test('the row is enabled and opens the link popover for the selection', async () => {
  const view = await mount();
  await selectAndRightClick(view);
  const row = linkRow(view)!;
  expect(row).not.toBeNull();
  expect(row.getAttribute('aria-disabled')).toBeNull();
  row.click();
  await flush();
  expect(view.container.querySelector('[role="menu"]')).toBeNull();
  expect(popup(view)?.dataset.mode).toBe('editing');
  const text = view.container.querySelector<HTMLInputElement>(
    '[data-testid="hyperlink-popup-text"]'
  )!;
  expect(text.value).toBe('example');
});

test('in viewing mode the row is disabled, with the translated engine reason', async () => {
  const view = await mount();
  view.editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  await flush();
  await selectAndRightClick(view);
  const row = linkRow(view)!;
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(row.getAttribute('title')).toBe('disabledReason.viewing');
  row.click();
  await flush();
  expect(popup(view)).toBeNull();
});

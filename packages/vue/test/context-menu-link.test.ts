// The Vue twin of `packages/react/test/context-menu-link.test.tsx`.

import './dom-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { h, type VNode } from 'vue';
import { ContextMenu, DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink';
import { docx, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';

const SOURCE = docx('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
const LINKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
    '<w:hyperlink w:anchor="target"><w:r><w:t>example</w:t></w:r></w:hyperlink>' +
    '<w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p>'
);
const PID = '/word/document.xml#0.0.0';
const t = (key: string) => key;
const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

async function mount(
  source: Uint8Array = SOURCE,
  menuChildren?: () => VNode[]
): Promise<MountedEditor> {
  const view = mountEditorTree(
    () => [],
    source,
    () => [
      h(DocxEditorHyperLink),
      h(DocxEditorContextMenu, { t }, menuChildren ? { default: menuChildren } : undefined),
    ]
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

test('ContextMenu.Slot for text.link replaces the packaged row with the same working row', async () => {
  const view = await mount(SOURCE, () => [
    h(ContextMenu.Slot, { slotId: 'text.link', className: 'host-link-row' }),
  ]);
  await selectAndRightClick(view);
  const rows = view.container.querySelectorAll<HTMLElement>(
    '[role="menu"] [data-slot="text.link"]'
  );
  expect(rows.length).toBe(1);
  const row = rows[0]!;
  expect(row.classList.contains('host-link-row')).toBe(true);
  expect(row.getAttribute('aria-disabled')).toBeNull();
  expect(row.textContent).toContain('formattingBar.insertLink');
  row.click();
  await flush();
  expect(popup(view)?.dataset.mode).toBe('editing');
});

test('on an existing link the row says Edit link and opens the edit panel', async () => {
  const view = await mount(LINKED);
  view.editor().surface!.setSelection({
    anchor: { paragraphId: PID, offset: 8 },
    head: { paragraphId: PID, offset: 8 },
  });
  await flush();
  view.container
    .querySelector('.docx-paginated-surface')!
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
    );
  await flush();
  const row = linkRow(view)!;
  expect(row.textContent).toContain('hyperlinkPopup.editLink');
  expect(row.textContent).not.toContain('formattingBar.insertLink');
  row.click();
  await flush();
  const url = view.container.querySelector<HTMLInputElement>(
    '[data-testid="hyperlink-popup-url-input"]'
  )!;
  expect(url.value).toBe('#target');
});

describe('closing the popover returns focus to the document', () => {
  async function openFromMenu() {
    const view = await mount();
    await selectAndRightClick(view);
    linkRow(view)!.click();
    await flush();
    const url = view.container.querySelector<HTMLInputElement>(
      '[data-testid="hyperlink-popup-url-input"]'
    )!;
    expect(document.activeElement).toBe(url);
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    return { view, url, pages };
  }
  const key = (target: HTMLElement, name: string) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    );

  test('Escape: focus goes back to the pages, and the selection stays', async () => {
    const { view, url, pages } = await openFromMenu();
    const before = view.editor().surface!.state().selection;
    key(url, 'Escape');
    await flush();
    expect(popup(view)).toBeNull();
    expect(document.activeElement).toBe(pages);
    expect(view.editor().surface!.state().selection).toEqual(before);
  });

  test('Enter applies the link and focus goes back to the pages', async () => {
    const { view, url, pages } = await openFromMenu();
    url.value = 'https://example.com/a';
    url.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    key(url, 'Enter');
    await flush();
    expect(popup(view)).toBeNull();
    expect(document.activeElement).toBe(pages);
    expect(view.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.com/a');
  });

  test('Cancel: focus goes back to the pages', async () => {
    const { view, pages } = await openFromMenu();
    view.container.querySelector<HTMLElement>('[data-testid="hyperlink-popup-cancel"]')!.click();
    await flush();
    expect(popup(view)).toBeNull();
    expect(document.activeElement).toBe(pages);
  });
});

// The Vue twin of `packages/react/test/chrome-popup-dismissal.test.tsx`: every toolbar and
// menu popup follows one dismissal rule.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, type VNode } from 'vue';
import { strToU8, zipSync } from 'fflate';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { POPUP_ESCAPE_SOURCE } from './helpers/popup-escape-document';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** One paragraph with a tracked insertion, so the reviewers menu has an author to list. */
const TRACKED_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Body </w:t></w:r>` +
      '<w:ins w:id="1" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:r><w:t>text</w:t></w:r></w:ins>' +
      '</w:p></w:body></w:document>'
  ),
});

const REVIEW_MODULE: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};

const mounted: MountedEditor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  for (const host of hosts.splice(0)) host.remove();
});

async function mount(chrome: () => VNode, source: Uint8Array = POPUP_ESCAPE_SOURCE) {
  const view = mountEditorTree(chrome, source, () => [], [REVIEW_MODULE]);
  mounted.push(view);
  await flush();
  const host = document.createElement('input');
  document.body.append(host);
  hosts.push(host);
  return {
    container: view.container,
    host,
    pages: () => view.container.querySelector<HTMLElement>('.docx-pages')!,
  };
}

async function escape(target: Element): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  await flush();
  return event;
}

async function press(trigger: HTMLElement) {
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  trigger.click();
  await flush();
}

const toolbarWith = (part: unknown) => () =>
  h(
    DocxEditorToolbar,
    { preset: false, overflow: false },
    { default: () => [h(part as Parameters<typeof h>[0])] }
  );

describe('the menu bar (Vue)', () => {
  const menuOpen = (container: HTMLElement) =>
    container.querySelector('.docx-menubar__trigger[aria-expanded="true"]') !== null;

  test('Escape from the pages closes it and stops there', async () => {
    const view = await mount(() => h(DocxEditorMenu));
    await press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    expect(menuOpen(view.container)).toBe(true);
    expect((await escape(view.pages())).defaultPrevented).toBe(true);
    expect(menuOpen(view.container)).toBe(false);
  });

  test('Escape from a host input closes it and keeps its default', async () => {
    const view = await mount(() => h(DocxEditorMenu));
    await press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    expect((await escape(view.host)).defaultPrevented).toBe(false);
    expect(menuOpen(view.container)).toBe(false);
  });

  test('focus that moves to another control closes it', async () => {
    const view = await mount(() => h(DocxEditorMenu));
    await press(view.container.querySelector<HTMLElement>('.docx-menubar__trigger')!);
    view.host.focus();
    await flush();
    expect(menuOpen(view.container)).toBe(false);
  });
});

describe('the reviewers menu (Vue)', () => {
  const trigger = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="review.authors"] [aria-haspopup]')!;

  test('Escape from the pages closes it and stops there', async () => {
    const view = await mount(toolbarWith(DocxEditorToolbar.Reviewers), TRACKED_SOURCE);
    await press(trigger(view.container));
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('true');
    expect((await escape(view.pages())).defaultPrevented).toBe(true);
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('false');
  });

  test('Escape from a host input closes it and keeps its default', async () => {
    const view = await mount(toolbarWith(DocxEditorToolbar.Reviewers), TRACKED_SOURCE);
    await press(trigger(view.container));
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('true');
    expect((await escape(view.host)).defaultPrevented).toBe(false);
    expect(trigger(view.container).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a picker (Vue)', () => {
  test('focus that moves to another control closes it, then Escape reaches that control', async () => {
    const view = await mount(toolbarWith(DocxEditorToolbar.FontFamily));
    const trigger = view.container.querySelector<HTMLElement>(
      '[data-slot="font.family"] [aria-haspopup]'
    )!;
    await press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    view.host.focus();
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect((await escape(view.host)).defaultPrevented).toBe(false);
  });
});

describe('a picker behind a host modal (Vue)', () => {
  test("focus that moves into a host's modal dialog closes the picker", async () => {
    const view = await mount(toolbarWith(DocxEditorToolbar.FontFamily));
    const trigger = view.container.querySelector<HTMLElement>(
      '[data-slot="font.family"] [aria-haspopup]'
    )!;
    await press(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    hosts.push(dialog);
    field.focus();
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});


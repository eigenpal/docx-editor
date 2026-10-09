// Chrome renders correctly under Vue's hydration renderer.
//
// A server-rendered host (a Nuxt app, or any `createSSRApp`) switches the page's Vue runtime
// to its hydration renderer. That renderer HYDRATES a component vnode that still carries the
// element of an earlier mount. A component that receives a non-function default slot keeps
// one normalized vnode array, and its next mount reuses those mounted vnodes: under the
// hydration renderer they hydrate against the wrong DOM. The table toolbar did this, so its
// menu lost its trigger after the selection left a table and came back.
//
// THE RULE: chrome passes children to its own components as function slots
// (`h(Component, props, { default: () => children })`), never as a vnode array. Vue warns
// "Non-function value encountered for default slot" for the other shape; this test fails on
// that warning for the packaged editor and the contextual table chrome.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createSSRApp, h, warn } from 'vue';
import { strToU8, zipSync } from 'fflate';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { DocxEditorMenu } from '../src/editor/menu';
import { flush, mountEditorTree, mountSugarAsync, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TABLE_SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>after</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

class MockResizeObserver {
  static readonly instances: MockResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    const index = MockResizeObserver.instances.indexOf(this);
    if (index >= 0) MockResizeObserver.instances.splice(index, 1);
  }

  flush(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Collect Vue's non-function slot warnings while `run` executes. */
async function slotWarnings(run: () => Promise<void>): Promise<string[]> {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes('Non-function value encountered for default slot')) messages.push(text);
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return messages;
}

test('Vue runs its development build here, so the guard below cannot pass silently', () => {
  // The production build strips every warning, and the slot warning with it.
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(' '));
  };
  try {
    warn('hydration-renderer-slots probe');
  } finally {
    console.warn = original;
  }
  expect(messages.some((text) => text.includes('hydration-renderer-slots probe'))).toBe(true);
});

test('the table toolbar keeps its menus after the selection leaves a table and returns', async () => {
  // Any createSSRApp call switches this runtime to the hydration renderer.
  createSSRApp({ render: () => null });
  const warnings = await slotWarnings(async () => {
    const view = mountEditorTree(
      () =>
        h(
          DocxEditorToolbar,
          { preset: false, overflow: false },
          {
            default: () => [
              h(DocxEditorToolbar.TableBorderTarget),
              h(DocxEditorToolbar.TableBorderStyle),
              h(DocxEditorToolbar.TableBorderWidth),
              h(DocxEditorToolbar.TableBorderColor),
              h(DocxEditorToolbar.TableCellFill),
            ],
          }
        ),
      TABLE_SOURCE
    );
    mounted.push(view);
    await flush();
    const ids = [...view.container.querySelectorAll('[data-paragraph-id]')].map(
      (node) => node.getAttribute('data-paragraph-id')!
    );
    const at = (paragraphId: string) => ({ paragraphId, offset: 0 });
    const select = async (paragraphId: string) => {
      view.editor().exec({
        type: 'setSelection',
        range: { anchor: at(paragraphId), head: at(paragraphId) },
      });
      await flush();
    };
    await select(ids[0]!);
    await select(ids.at(-1)!);
    await select(ids[0]!);
    for (const slot of ['table.borderTarget', 'table.borderStyle', 'table.borderWidth']) {
      const trigger = view.container.querySelector(`[data-slot="${slot}"] [aria-haspopup]`);
      expect(trigger).not.toBeNull();
    }
  });
  expect(warnings).toEqual([]);
});

test('the packaged editor passes function slots to its own components', async () => {
  createSSRApp({ render: () => null });
  const warnings = await slotWarnings(async () => {
    const view = await mountSugarAsync({ document: TABLE_SOURCE });
    mounted.push(view);
    await view.flush();
  });
  expect(warnings).toEqual([]);
});

test('menus, the More panel, and asChild parts pass function slots', async () => {
  createSSRApp({ render: () => null });
  const RealResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  try {
    const warnings = await slotWarnings(async () => {
      const view = mountEditorTree(
        () => [
          h(DocxEditorMenu),
          h(DocxEditorToolbar, null, {
            default: () => [
              h(
                DocxEditorToolbar.Button,
                { slotId: 'text.bold', asChild: true },
                { default: () => h('button', { type: 'button' }, 'B') }
              ),
            ],
          }),
        ],
        TABLE_SOURCE
      );
      mounted.push(view);
      await flush();
      // Every menu of the bar, opened and closed.
      for (const trigger of view.container.querySelectorAll<HTMLElement>(
        '.docx-menubar__trigger'
      )) {
        trigger.click();
        await flush();
        trigger.click();
        await flush();
      }
      // The toolbar collapsed into More, with the panel opened.
      const toolbar = view.container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!;
      Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 280 });
      for (const group of toolbar.querySelectorAll<HTMLElement>('[data-toolbar-group]')) {
        Object.defineProperty(group, 'offsetWidth', { configurable: true, get: () => 90 });
      }
      for (const observer of [...MockResizeObserver.instances]) observer.flush();
      await flush();
      const more = toolbar.querySelector<HTMLButtonElement>('[data-slot="toolbar.more"]');
      expect(more).not.toBeNull();
      more!.click();
      await flush();
      expect(view.container.querySelector('[data-testid="toolbar-overflow-panel"]')).not.toBeNull();
    });
    expect(warnings).toEqual([]);
  } finally {
    globalThis.ResizeObserver = RealResizeObserver;
  }
});

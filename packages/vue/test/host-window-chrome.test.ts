// The editor mounted in another window's document, the way a pop-out panel or a same-origin
// iframe hosts it: the script's globals still belong to the opener, so chrome that listened on
// the global `document` never heard a press in the window the editor actually renders in.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { DocxEditorWindow } from '../src/editor/DocxEditorWindow';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { SOURCE, flush } from './helpers/fixtures';

const opened: { app: App; frame: HTMLIFrameElement }[] = [];
afterEach(() => {
  for (const { app, frame } of opened.splice(0)) {
    app.unmount();
    frame.remove();
  }
});

async function mountInOtherWindow() {
  // A same-origin frame: its own document and window, with this script's globals outside it.
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const other = frame.contentWindow!;
  expect(other).not.toBe(window);
  const container = other.document.createElement('div');
  other.document.body.append(container);
  const app = createApp({
    setup: () => () =>
      h(
        DocxEditorRoot,
        { document: SOURCE },
        {
          default: () => [
            h(
              DocxEditorToolbar,
              { preset: false, overflow: false },
              { default: () => [h(DocxEditorToolbar.FontFamily)] }
            ),
            h(DocxEditorViewport, null, { default: () => [h(DocxEditorContent)] }),
          ],
        }
      ),
  });
  app.mount(container);
  opened.push({ app, frame });
  await flush();
  return { other, container };
}

async function pressOn(target: EventTarget) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  await flush();
}

describe('chrome in another window (Vue)', () => {
  test('a picker closes on a press in the window it renders in, not in the opener', async () => {
    const { other, container } = await mountInOtherWindow();
    const trigger = container.querySelector<HTMLElement>(
      '[data-slot="font.family"] [aria-haspopup]'
    )!;
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.click();
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // A press in the opener's document is outside the editor's window: it says nothing.
    await pressOn(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const outside = other.document.createElement('button');
    other.document.body.append(outside);
    await pressOn(outside);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('DocxEditorWindow', () => {
  test('renders in the pop-out while open, and back in place when it closes', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow as Window & typeof globalThis;
    view.close = () => {};
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    const host = document.createElement('div');
    document.body.append(host);
    const open = ref(true);
    let closed = 0;
    const app = createApp({
      setup: () => () =>
        h(
          DocxEditorWindow,
          {
            open: open.value,
            'onUpdate:open': (value: boolean) => (open.value = value),
            onClose: () => (closed += 1),
          },
          { default: () => h('p', { 'data-testid': 'panel' }, 'panel') }
        ),
    });
    try {
      app.mount(host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
      expect(view.document.querySelector('[data-testid="panel"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="panel"]')).toBeNull();

      view.dispatchEvent(new view.Event('pagehide'));
      await nextTick();
      expect(closed).toBe(1);
      expect(open.value).toBe(false);
      expect(host.querySelector('[data-testid="panel"]')).not.toBeNull();
    } finally {
      app.unmount();
      host.remove();
      frame.remove();
      window.open = original;
    }
  });

  test('turning open off moves the panel back before the window closes', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow as Window & typeof globalThis;
    const host = document.createElement('div');
    document.body.append(host);
    let backWhenClosed = null as boolean | null;
    view.close = () => {
      backWhenClosed = host.querySelector('[data-testid="panel"]') !== null;
    };
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    const open = ref(true);
    const app = createApp({
      setup: () => () =>
        h(
          DocxEditorWindow,
          { open: open.value },
          { default: () => h('p', { 'data-testid': 'panel' }, 'panel') }
        ),
    });
    try {
      app.mount(host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
      expect(view.document.querySelector('[data-testid="panel"]')).not.toBeNull();
      open.value = false;
      await nextTick();
      await nextTick();
      expect(backWhenClosed).toBe(true);
    } finally {
      app.unmount();
      host.remove();
      frame.remove();
      window.open = original;
    }
  });
});

// The Vue context menu stays inside the window and above the host's chrome.
//
// The twin of the React adapter's placement tests. The panel gets a size through a stubbed
// `getBoundingClientRect` and a small window through `innerWidth`/`innerHeight`.

import './dom-setup.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { flush, SOURCE } from './helpers/fixtures.ts';

const t = (key: string): string => key;

const VIEW = { width: 1000, height: 600 };
let panelSize = { width: 240, height: 300 };

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  panelSize = { width: 240, height: 300 };
  Object.defineProperty(window, 'innerWidth', { value: VIEW.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VIEW.height, configurable: true });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('docx-contextmenu')) {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      const cap = Number.parseFloat(this.style.maxHeight) || Infinity;
      return rectOf(left, top, panelSize.width, Math.min(panelSize.height, cap));
    }
    return originalRect.call(this);
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  Object.defineProperty(window, 'innerWidth', { value: originalSize.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalSize.height, configurable: true });
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: SOURCE },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent), h(DocxEditorContextMenu, { t })],
            }),
        }
      ),
  }).mount(container);
  await flush();
  return container;
}

async function rightClick(container: HTMLElement, x: number, y: number): Promise<HTMLElement> {
  const scroller = container.querySelector('.docx-editor__scroll-container');
  if (!scroller) throw new Error('no scroll container');
  const target = scroller.querySelector('.docx-paginated-surface') ?? scroller;
  target.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 2,
    })
  );
  await flush();
  const panel = container.querySelector<HTMLElement>('.docx-contextmenu');
  if (!panel) throw new Error('the menu did not open');
  return panel;
}

function placed(panel: HTMLElement): { top: number; bottom: number; maxHeight: number } {
  const top = Number.parseFloat(panel.style.top);
  const maxHeight = Number.parseFloat(panel.style.maxHeight);
  return { top, bottom: top + Math.min(panelSize.height, maxHeight), maxHeight };
}

describe('the menu stays inside the window', () => {
  test('a press near the bottom keeps a tall menu on screen, capped and scrolling', async () => {
    panelSize = { width: 240, height: 900 };
    const box = placed(await rightClick(await mount(), 120, 560));
    expect(box.maxHeight).toBe(VIEW.height - 16);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(VIEW.height - 8);
  });

  test('a press near the top keeps a tall menu on screen, capped and scrolling', async () => {
    panelSize = { width: 240, height: 900 };
    const box = placed(await rightClick(await mount(), 120, 40));
    expect(box.maxHeight).toBe(VIEW.height - 16);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(VIEW.height - 8);
  });

  test('a menu that fits on neither side of the press moves up only as far as it must', async () => {
    panelSize = { width: 240, height: 400 };
    const box = placed(await rightClick(await mount(), 120, 300));
    expect(box.top).toBe(VIEW.height - 8 - 400);
    expect(box.bottom).toBe(VIEW.height - 8);
  });
});

describe('a menu taller than the window scrolls', () => {
  test('the panel takes focus once visible, so the arrow keys work', async () => {
    const panel = await rightClick(await mount(), 120, 100);
    expect(document.activeElement).toBe(panel);
  });

  test('the panel scrolling inside itself does not close it', async () => {
    panelSize = { width: 240, height: 900 };
    const container = await mount();
    const panel = await rightClick(container, 120, 300);
    panel.dispatchEvent(new Event('scroll'));
    await flush();
    expect(container.querySelector('.docx-contextmenu')).not.toBeNull();
  });

  test('the arrow keys scroll the focused row into view', async () => {
    panelSize = { width: 240, height: 900 };
    const panel = await rightClick(await mount(), 120, 300);
    Object.defineProperty(panel, 'clientTop', { value: 0, configurable: true });
    Object.defineProperty(panel, 'clientHeight', { value: VIEW.height - 16, configurable: true });
    const items = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (item) => item.closest('[role="menu"]') === panel
    );
    items.forEach((item, index) => {
      item.getBoundingClientRect = () => rectOf(0, 8 + index * 100 - panel.scrollTop, 240, 100);
    });
    const last = items.at(-1)!;
    expect(last.getBoundingClientRect().bottom).toBeGreaterThan(VIEW.height);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await flush();
    expect(document.activeElement).toBe(last);
    const lastBox = last.getBoundingClientRect();
    expect(lastBox.bottom).toBeLessThanOrEqual(VIEW.height - 8);
    expect(lastBox.top).toBeGreaterThanOrEqual(8);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    expect(document.activeElement).toBe(items[0]!);
    expect(panel.scrollTop).toBe(0);
  });
});

describe('stacking', () => {
  test('the panel opens in the top layer, above any host stacking context', async () => {
    const shown: HTMLElement[] = [];
    (HTMLElement.prototype as { showPopover?: () => void }).showPopover = function (
      this: HTMLElement
    ) {
      shown.push(this);
    };
    const panel = await rightClick(await mount(), 120, 100);
    expect(panel.getAttribute('popover')).toBe('manual');
    expect(shown).toEqual([panel]);
  });
});

// `useScopedChromeAnchor` writes its placement only when it moves: scrolls, resizes and
// repaints call it on every frame, and an unchanged write re-renders the chrome it places.
// The React twin is in packages/react/test/header-footer-chrome.test.tsx.

import './dom-setup.ts';

import { expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, watch } from 'vue';
import { useScopedChromeAnchor } from '../src/editor/useScopedChromeAnchor';

function rect(left: number, top: number, width: number, height: number): DOMRect {
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

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test('a frame that does not move the chrome writes no new placement', async () => {
  let writes = 0;
  const Probe = defineComponent({
    setup() {
      const anchor = useScopedChromeAnchor(
        (viewport) => viewport.querySelector<HTMLElement>('[data-docx-hf-active]'),
        'story-label'
      );
      watch(anchor.style, () => {
        writes += 1;
      });
      return () =>
        h(
          'div',
          {
            class: 'docx-editor__scroll-container',
            ref: (node: unknown) => {
              if (!(node instanceof HTMLElement)) return;
              node.getBoundingClientRect = () => rect(0, 0, 800, 600);
              Object.defineProperty(node, 'clientWidth', { value: 800, configurable: true });
            },
          },
          [
            h('div', { class: 'docx-paginated-surface' }, [
              h('div', {
                'data-docx-hf-active': '',
                ref: (node: unknown) => {
                  if (node instanceof HTMLElement) {
                    node.getBoundingClientRect = () => rect(120, 80, 500, 30);
                  }
                },
              }),
            ]),
            h('div', {
              ref: (el: unknown) => anchor.ref(el instanceof HTMLDivElement ? el : null),
              style: anchor.style.value,
              'data-testid': 'probe',
            }),
          ]
        );
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(Probe);
  app.mount(container);
  try {
    await nextTick();
    await frame();
    const viewport = container.querySelector<HTMLElement>('.docx-editor__scroll-container')!;
    expect(container.querySelector<HTMLElement>('[data-testid="probe"]')!.style.left).toBe('120px');
    const settled = writes;
    for (let i = 0; i < 3; i += 1) {
      viewport.dispatchEvent(new Event('scroll'));
      await frame();
      await nextTick();
    }
    expect(writes).toBe(settled);
  } finally {
    app.unmount();
    container.remove();
  }
});

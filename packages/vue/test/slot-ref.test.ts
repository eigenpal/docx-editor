import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { Slot } from '../src/editor/toolbar/Slot';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Slot refs', () => {
  test('forwards the component ref to the single child element', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const childRef = ref<HTMLElement | null>(null);
    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              Slot,
              { ref: childRef },
              { default: () => h('button', { type: 'button' }, 'Custom trigger') }
            );
        },
      })
    );

    try {
      app.mount(container);
      await nextTick();
      expect(childRef.value).toBeInstanceOf(HTMLButtonElement);
      childRef.value?.focus();
      expect(document.activeElement).toBe(childRef.value);
    } finally {
      app.unmount();
      container.remove();
    }
  });
});

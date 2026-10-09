// Hydration-safe stable ids, in a file of its own.
//
// Server rendering loads a second copy of the Vue runtime in this process. Kept beside the
// editor component tests, it changed how later files in the same process rendered the
// table toolbar, so it runs with nothing else imported.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createSSRApp, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { useStableDocxId } from '../src/lib/stable-id';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hydration-safe stable ids', () => {
  test('useStableDocxId remains stable during hydration', async () => {
    const Probe = {
      setup() {
        const id = useStableDocxId('probe');
        return () => h('div', { id, 'data-probe': '' });
      },
    };
    const ssrHtml = await renderToString(createSSRApp(Probe));
    const container = document.createElement('div');
    container.innerHTML = ssrHtml;
    document.body.appendChild(container);
    const ssrId = container.querySelector('[data-probe]')?.id;
    const app = createSSRApp(Probe);
    app.mount(container);
    await nextTick();
    const clientId = container.querySelector('[data-probe]')?.id;
    expect(clientId).toBe(ssrId);
    app.unmount();
    container.remove();
  });
});

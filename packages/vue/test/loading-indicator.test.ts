// `DocxEditor.Loading`'s `indicator` slot and the packaged `loadingIndicator` slot: the host's
// indicator replaces only the spinner, and with `overlay` it moves onto the document's first
// page while a large document lays out its remaining pages.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { mountSugarAsync } from './helpers/mount';
import { slicedSource } from './helpers/fixtures';

afterEach(() => {
  document.body.innerHTML = '';
});

async function until(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Records where each mount of the indicator landed: the first screen or the first page. */
function trackedIndicator(places: string[]) {
  return () =>
    h(
      'span',
      {
        class: 'mine',
        ref: (element: unknown) => {
          if (!(element instanceof HTMLElement)) return;
          places.push(element.closest('.docx-opening-indicator') ? 'first page' : 'screen');
        },
      },
      'Opening document'
    );
}

describe('the loading indicator slot', () => {
  test('indicator replaces only the spinner and keeps the packaged page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(DocxEditorLoading, { when: true }, { indicator: () => h('span', { class: 'mine' }) }),
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.docx-editor__loading-page-status .mine')).not.toBeNull();
    expect(container.querySelector('.docx-editor__loading-spinner')).toBeNull();
    app.unmount();
  });

  test('loadingIndicator shows on the loading page, then on the first page', async () => {
    const places: string[] = [];
    const view = await mountSugarAsync(
      { document: slicedSource() },
      { loadingIndicator: trackedIndicator(places) }
    );
    await nextTick();
    expect(view.container.querySelector('.docx-editor__loading-page .mine')).not.toBeNull();
    expect(view.container.querySelector('.docx-editor__loading-spinner')).toBeNull();
    await until(() => places.includes('first page'));
    expect(places[0]).toBe('screen');
    await until(() => view.container.querySelector('.mine') === null);
    expect(view.container.querySelector('.docx-opening-indicator')).toBeNull();
    view.unmount();
  });

  test('loadingIndicator without chrome warns once in development', async () => {
    const warn = console.warn;
    const messages: string[] = [];
    console.warn = (message: string) => messages.push(message);
    try {
      const first = await mountSugarAsync({ chrome: false }, { loadingIndicator: () => h('span') });
      const second = await mountSugarAsync(
        { chrome: false },
        { loadingIndicator: () => h('span') }
      );
      await nextTick();
      first.unmount();
      second.unmount();
    } finally {
      console.warn = warn;
    }
    expect(messages.filter((message) => message.includes('loadingIndicator'))).toHaveLength(1);
  });
});

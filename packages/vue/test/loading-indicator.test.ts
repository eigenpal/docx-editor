// `DocxEditor.Loading`'s `indicator` slot and the packaged `loadingIndicator` slot: the host's
// indicator replaces only the spinner, and with `overlay` it moves onto the document's first
// page while a large document lays out its remaining pages.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { mountSugarAsync } from './helpers/mount';
import { slicedSource } from './helpers/fixtures';

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * Resolves when the editor reports that the opening document laid out its last page
 * (`document.open`, outcome `opened`): the engine's own completion signal, so the test takes as
 * long as the open does and never depends on a wall-clock limit.
 */
function openSettled(): { module: EditorModule; settled: Promise<void> } {
  let resolve!: () => void;
  const settled = new Promise<void>((done) => (resolve = done));
  return {
    module: {
      id: 'test-open-settled',
      onDiagnostic: (event) => {
        if (event.kind === 'document.open' && event.outcome === 'opened') resolve();
      },
    },
    settled,
  };
}

/** Records where each mount of the indicator landed: the first screen or below the laid-out pages. */
function trackedIndicator(places: string[]) {
  return () =>
    h(
      'span',
      {
        class: 'mine',
        ref: (element: unknown) => {
          if (!(element instanceof HTMLElement)) return;
          places.push(element.closest('.docx-opening-indicator') ? 'below the pages' : 'screen');
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

  test('loadingIndicator shows on the loading page, then below the laid-out pages', async () => {
    const places: string[] = [];
    const open = openSettled();
    const view = await mountSugarAsync(
      { document: slicedSource(), modules: [open.module] },
      { loadingIndicator: trackedIndicator(places) }
    );
    await nextTick();
    expect(view.container.querySelector('.docx-editor__loading-page .mine')).not.toBeNull();
    expect(view.container.querySelector('.docx-editor__loading-spinner')).toBeNull();
    await open.settled;
    await nextTick();
    expect(places[0]).toBe('screen');
    expect(places).toContain('below the pages');
    expect(view.container.querySelector('.mine') === null).toBe(true);
    expect(view.container.querySelector('.docx-opening-indicator') === null).toBe(true);
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

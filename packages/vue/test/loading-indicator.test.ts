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

/** Bounds an open that never ends, as the React twin does. */
const SLICED_OPEN_TEST_TIMEOUT_MS = 45_000;

/**
 * Resolves when the editor reports that the opening document laid out its last page
 * (`document.open`, outcome `opened`), and rejects with the open's code on any other outcome: the
 * engine's own completion signal, so the test takes as long as the open does and never depends on
 * a wall-clock limit.
 */
function openSettled(): { module: EditorModule; settled: Promise<void> } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const settled = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {
    module: {
      id: 'test-open-settled',
      onDiagnostic: (event) => {
        if (event.kind !== 'document.open') return;
        if (event.outcome === 'opened') resolve();
        // A refused or crashed open ends at once, with its code, instead of at the test budget.
        else reject(new Error(`the open was rejected: ${event.code}`));
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

  test(
    'loadingIndicator shows on the loading page, then below the laid-out pages',
    async () => {
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
    },
    // Bounds only an open that never ends; the test itself takes as long as the open does.
    SLICED_OPEN_TEST_TIMEOUT_MS
  );

  test('a file that cannot be opened ends the wait at once, with the open code', async () => {
    const open = openSettled();
    const started = performance.now();
    const view = await mountSugarAsync({
      document: new TextEncoder().encode('not a docx package'),
      modules: [open.module],
    });
    await expect(open.settled).rejects.toThrow(/the open was rejected: open\./);
    expect(performance.now() - started).toBeLessThan(5_000);
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

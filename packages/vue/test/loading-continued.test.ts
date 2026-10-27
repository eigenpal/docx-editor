import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick, shallowRef, type VNode } from 'vue';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { LARGE_SOURCE, SOURCE, flush } from './helpers/fixtures';

const LOADING = '.docx-editor__loading';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(withContent: boolean, overlay = true) {
  const source = shallowRef<Uint8Array | undefined>(undefined);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(DocxEditorRoot, source.value ? { document: source.value } : {}, {
        default: () => {
          const children: VNode[] = [h(DocxEditorLoading, { overlay })];
          if (withContent) {
            children.push(h(DocxEditorViewport, null, { default: () => [h(DocxEditorContent)] }));
          }
          return children;
        },
      }),
  });
  app.mount(container);
  return {
    source,
    container,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

// The root builds a new instance for the bytes and attaches it one update later. A new
// overlay element would replay its appearance delay, and the workspace would show through.
test('the overlay stays the same element when a LARGE document arrives', async () => {
  const view = mount(true);
  await flush();
  const overlay = view.container.querySelector(LOADING);
  expect(overlay).not.toBeNull();
  const removed: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) removed.push(...record.removedNodes);
  });
  observer.observe(view.container, { childList: true, subtree: true });

  view.source.value = LARGE_SOURCE;
  await nextTick();
  await nextTick();
  expect(view.container.querySelector(LOADING)).toBe(overlay);
  for (let i = 0; i < 50 && view.container.querySelector(LOADING); i += 1) await flush();
  observer.disconnect();
  expect(view.container.querySelector(LOADING)).toBeNull();
  // Removed once, when the pages arrive, and never replaced on the way.
  expect(removed.filter((node) => node === overlay)).toHaveLength(1);
  view.unmount();
});

test('the in-flow screen also stays the same element, so its spinner keeps turning', async () => {
  const view = mount(true, false);
  await flush();
  const screen = view.container.querySelector(LOADING);
  expect(screen).not.toBeNull();
  view.source.value = LARGE_SOURCE;
  await nextTick();
  await nextTick();
  expect(view.container.querySelector(LOADING)).toBe(screen);
  for (let i = 0; i < 50 && view.container.querySelector(LOADING); i += 1) await flush();
  view.unmount();
});

test('a SMALL document arriving under the overlay still removes it', async () => {
  const view = mount(true);
  await flush();
  expect(view.container.querySelector(LOADING)).not.toBeNull();
  view.source.value = SOURCE;
  await flush();
  expect(view.container.querySelector(LOADING)).toBeNull();
  view.unmount();
});

test('an editor that is never attached does not keep the overlay up', async () => {
  const view = mount(false);
  await flush();
  expect(view.container.querySelector(LOADING)).not.toBeNull();
  view.source.value = LARGE_SOURCE;
  await flush();
  expect(view.container.querySelector(LOADING)).toBeNull();
  view.unmount();
});

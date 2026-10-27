import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { defineComponent, h, nextTick } from 'vue';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber';
import { useEditorState } from '../src/editor/useEditorState';
import { docx, LARGE_SOURCE, slicedSource } from './helpers/fixtures';
import { flush, mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const THREE_PAGES = docx(
  paragraph('one') + pageBreak + paragraph('two') + pageBreak + paragraph('three')
);

// A partial layout's total would be wrong, so no count shows while a document opens.
test('the page counter shows no count while a document opens', async () => {
  const view = mountEditorTree(() => [h(DocxEditorPageNumber)], THREE_PAGES);
  await flush();
  expect(view.container.querySelector('.docx-editor__page-number')).not.toBeNull();

  view.editor().load(LARGE_SOURCE);
  expect(view.editor().snapshot().isOpening).toBe(true);
  await nextTick();
  await nextTick();
  expect(view.container.querySelector('.docx-editor__page-number')).toBeNull();
  view.unmount();
});

/** Every total a page counter renders, from the published page total. */
const rendered: number[] = [];
const PageTotal = defineComponent({
  setup() {
    const total = useEditorState((snapshot) => snapshot.page.total);
    return () => {
      rendered.push(total.value);
      return h('span', { 'data-testid': 'page-total' }, String(total.value));
    };
  },
});

// The open ends at the mount with a partial layout. The pages laid out after it move no
// revision and no caret; the counter must still hear the final total.
test('a counter shows the final page total once the last page is laid out', async () => {
  rendered.length = 0;
  const view = mountEditorTree(() => [h(PageTotal)], slicedSource());
  const deadline = Date.now() + 20_000;
  let final = 0;
  while (Date.now() < deadline) {
    await flush();
    const opening = view.container.querySelector('[data-docx-opening-preview]') !== null;
    // `snapshot()` reads the live total without forcing the remaining pages.
    final = view.editor()?.snapshot().page.total ?? 0;
    if (view.editor()?.surface && !opening && rendered.at(-1) === final) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // The first total rendered with a document mounted is the partial one.
  expect(rendered.find((total) => total > 0)).toBeLessThan(final);
  expect(rendered.at(-1)).toBe(final);
  view.unmount();
}, 60_000);

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber';
import { docx, LARGE_SOURCE } from './helpers/fixtures';
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

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { DocxEditorMenu } from '../src/editor/menu';
import { LARGE_SOURCE } from './helpers/fixtures';
import { flush, mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

// The previous document stays mounted while the next one opens, so a menu command in that
// window would act on the document about to be replaced. The toolbar already refuses.
test('the menu bar is disabled and closed while the next document opens', async () => {
  const view = mountEditorTree(() => [h(DocxEditorMenu)]);
  await flush();
  const triggers = () => [
    ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
  ];
  expect(triggers().length).toBeGreaterThan(0);
  triggers()[0]!.click();
  await nextTick();
  expect(view.container.querySelector('[role="menu"]')).not.toBeNull();

  view.editor().load(LARGE_SOURCE);
  expect(view.editor().snapshot().isOpening).toBe(true);
  await nextTick();
  await nextTick();
  expect(triggers().every((trigger) => trigger.disabled)).toBe(true);
  expect(view.container.querySelector('[role="menu"]')).toBeNull();

  await flush();
  expect(view.editor().snapshot().isOpening).toBe(false);
  expect(triggers().every((trigger) => !trigger.disabled)).toBe(true);
  view.unmount();
});

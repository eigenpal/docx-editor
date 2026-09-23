import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, ref } from 'vue';
import { DocxEditor } from '../src/components/DocxEditor';
import { VerticalRuler } from '../src/components/ui/VerticalRuler';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { Translations } from '@docx-editor.dev/i18n';
import { flush } from './helpers/fixtures';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});
function mount(render: () => ReturnType<typeof h>) {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render });
  app.mount(container);
  cleanup.push(() => {
    app.unmount();
    container.remove();
  });
  return container;
}
function press(target: Element, key: string, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  );
}

test('packaged controls and document navigation expose native keyboard semantics', async () => {
  let editor: DocxEditorInstance | undefined;
  const translations = ref<Translations>({});
  const container = mount(() =>
    h(DocxEditor, {
      document: 'blank',
      i18n: translations.value,
      onReady: (value: DocxEditorInstance) => {
        editor = value as DocxEditorInstance;
      },
    })
  );
  await flush();
  const viewport = container.querySelector<HTMLElement>('[data-testid="docx-editor-scroll"]')!;
  expect(viewport.getAttribute('role')).toBe('region');
  expect(viewport.getAttribute('aria-label')).toBe('Document pages');
  viewport.focus();
  expect(document.activeElement).toBe(viewport);
  expect(viewport.tabIndex).toBe(0);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  expect(pages.getAttribute('aria-label')).toBe('Document content');
  const controls = container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!;
  expect(controls.tagName).toBe('FIELDSET');
  expect(controls.getAttribute('role')).toBeNull();
  expect(controls.getAttribute('aria-label')).toBe('Formatting controls');
  const top = container.querySelector<HTMLElement>('.docx-ruler-marker-topMargin')!;
  expect(top.closest('[aria-hidden="true"]')).toBeNull();
  top.focus();
  expect(document.activeElement).toBe(top);
  const before = Number(top.getAttribute('aria-valuenow'));
  press(top, 'ArrowUp');
  await flush();
  expect(Number(top.getAttribute('aria-valuenow'))).toBe(before + 180);
  editor!.exec({ type: 'undo' });
  await flush();
  expect(Number(top.getAttribute('aria-valuenow'))).toBe(before);
  translations.value = {
    editor: { documentContent: 'Treść dokumentu', documentViewport: 'Strony dokumentu' },
    formattingBar: { label: 'Formatowanie' },
    ruler: { topMargin: 'Górny margines' },
  };
  await flush();
  expect(pages.getAttribute('aria-label')).toBe('Treść dokumentu');
  expect(viewport.getAttribute('aria-label')).toBe('Strony dokumentu');
  expect(controls.getAttribute('aria-label')).toBe('Formatowanie');
  expect(top.getAttribute('aria-label')).toBe('Górny margines');
});

test('vertical margin keys commit bounded values and respect disabled controls', async () => {
  const changes: number[] = [];
  let commits = 0;
  const editable = ref(true);
  const container = mount(() =>
    h(VerticalRuler, {
      editable: editable.value,
      onTopMarginChange: (value: number) => changes.push(value),
      onMarginDragEnd: () => {
        commits++;
      },
    })
  );
  const top = container.querySelector<HTMLElement>('.docx-ruler-marker-topMargin')!;
  press(top, 'Home');
  press(top, 'End');
  press(top, 'ArrowDown', true);
  expect(changes).toEqual([0, 13680, 1439]);
  expect(commits).toBe(3);
  expect(top.getAttribute('aria-valuemin')).toBe('0');
  expect(top.getAttribute('aria-valuemax')).toBe('13680');
  editable.value = false;
  await flush();
  press(top, 'ArrowUp');
  expect(changes).toHaveLength(3);
  expect(top.tabIndex).toBe(-1);
  expect(top.getAttribute('aria-disabled')).toBe('true');
});

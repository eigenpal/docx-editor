import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, reactive, ref, type Component } from 'vue';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import { flush, SOURCE } from './helpers/mount';

function mountWithProps(component: Component, initialProps: Record<string, unknown>) {
  const props = reactive({ ...initialProps });
  const container = document.createElement('div');
  document.body.append(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        component,
        {
          document: SOURCE,
          ...props,
          onReady: (editor: unknown) => ready.push(editor as DocxEditorInstance),
        },
        component === DocxEditorRoot
          ? {
              default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            }
          : undefined
      ),
  });
  app.mount(container);
  return {
    container,
    editor: () => ready.at(-1)!,
    async setProps(nextProps: Record<string, unknown>) {
      Object.assign(props, nextProps);
      await flush();
    },
    unmount() {
      app.unmount();
      container.remove();
    },
  };
}

function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('live Vue props', () => {
  test('DocxEditorRoot applies a changed author without replacing the editor', async () => {
    const wrapper = mountWithProps(DocxEditorRoot, { author: 'Initial Author' });
    try {
      await flush();
      const editor = wrapper.editor();
      select(editor, 0, 1);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'X' })).toMatchObject({
        ok: true,
        changed: true,
      });

      await wrapper.setProps({ author: 'Updated Author' });
      expect(wrapper.editor()).toBe(editor);
      expect(editor.getConfiguredAuthor()).toBe('Updated Author');
      select(editor, 1, 2);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'Y' })).toMatchObject({
        ok: true,
        changed: true,
      });

      const xml = serializeOoxmlPart(editor.surface!.session.part());
      expect(xml.match(/w:author="Initial Author"/g)).toHaveLength(2);
      expect(xml.match(/w:author="Updated Author"/g)).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });

  test('DocxEditorRoot applies mode, translate, and locale changes in place', async () => {
    const initialTranslate = (key: string) => `initial:${key}`;
    const updatedTranslate = (key: string) => `updated:${key}`;
    const wrapper = mountWithProps(DocxEditorRoot, {
      mode: 'edit',
      translate: initialTranslate,
      locale: 'en',
    });
    try {
      await flush();
      const editor = wrapper.editor();
      let receivedTranslate: typeof updatedTranslate | undefined;
      let receivedLocale: string | undefined;
      const setTranslate = editor.setTranslate.bind(editor);
      const setLocale = editor.setLocale.bind(editor);
      editor.setTranslate = (value) => {
        receivedTranslate = value as typeof updatedTranslate;
        setTranslate(value);
      };
      editor.setLocale = (value) => {
        receivedLocale = value;
        setLocale(value);
      };

      await wrapper.setProps({ mode: 'view', translate: updatedTranslate, locale: 'de' });
      expect(wrapper.editor()).toBe(editor);
      expect(editor.getEditingMode()).toBe('viewing');
      expect(receivedTranslate?.('probe')).toBe('updated:probe');
      expect(receivedLocale).toBe('de');
    } finally {
      wrapper.unmount();
    }
  });

  test('an unrelated prop change does not restore a host mode after a reader change', async () => {
    const wrapper = mountWithProps(DocxEditorRoot, { mode: 'edit', author: 'First Author' });
    try {
      await flush();
      const editor = wrapper.editor();
      expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' })).toMatchObject({ ok: true });
      await wrapper.setProps({ author: 'Second Author' });
      expect(wrapper.editor()).toBe(editor);
      expect(editor.getEditingMode()).toBe('viewing');
    } finally {
      wrapper.unmount();
    }
  });

  test('a locale catalog change updates translation without replacing the editor', async () => {
    const catalog = (label: string) => ({ image: { pendingResource: label } });
    const wrapper = mountWithProps(DocxEditor, { i18n: catalog('First loading label') });
    try {
      await flush();
      const editor = wrapper.editor();
      let resolver: ((key: string) => string) | undefined;
      const setTranslate = editor.setTranslate.bind(editor);
      editor.setTranslate = (value) => {
        resolver = value;
        setTranslate(value);
      };

      await wrapper.setProps({ i18n: catalog('Second loading label') });
      expect(wrapper.editor()).toBe(editor);
      expect(resolver?.('image.pendingResource')).toBe('Second loading label');

      const catalogResolver = resolver;
      await wrapper.setProps({ t: (key: string) => `custom:${key}` });
      expect(wrapper.editor()).toBe(editor);
      expect(resolver).not.toBe(catalogResolver);
      expect(resolver?.('image.pendingResource')).toBe('custom:image.pendingResource');
    } finally {
      wrapper.unmount();
    }
  });

  test('a bare root reads a changed locale catalog without replacing the editor', async () => {
    const catalog = (label: string) => ({ image: { pendingResource: label } });
    const i18n = ref(catalog('First loading label'));
    const container = document.createElement('div');
    document.body.append(container);
    const ready: DocxEditorInstance[] = [];
    const app = createApp({
      render: () =>
        h(
          LocaleProvider,
          { i18n: i18n.value },
          {
            default: () =>
              h(
                DocxEditorRoot,
                {
                  document: SOURCE,
                  onReady: (editor: unknown) => ready.push(editor as DocxEditorInstance),
                },
                {
                  default: () =>
                    h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
                }
              ),
          }
        ),
    });
    app.mount(container);
    try {
      await flush();
      const editor = ready.at(-1)!;
      let resolver: ((key: string) => string) | undefined;
      const setTranslate = editor.setTranslate.bind(editor);
      editor.setTranslate = (value) => {
        resolver = value;
        setTranslate(value);
      };

      i18n.value = catalog('Second loading label');
      await flush();
      expect(ready.at(-1)).toBe(editor);
      expect(resolver?.('image.pendingResource')).toBe('Second loading label');
    } finally {
      app.unmount();
      container.remove();
    }
  });

  test('a fresh equivalent inline translation does not publish a selection change', async () => {
    const wrapper = mountWithProps(DocxEditor, { t: (key: string) => `same:${key}` });
    try {
      await flush();
      const editor = wrapper.editor();
      let changes = 0;
      editor.on('selectionChange', () => changes++);

      await wrapper.setProps({ t: (key: string) => `same:${key}` });
      expect(wrapper.editor()).toBe(editor);
      expect(changes).toBe(0);
    } finally {
      wrapper.unmount();
    }
  });

  test('DocxEditor sugar applies frame prop changes', async () => {
    const wrapper = mountWithProps(DocxEditor, {
      rulers: true,
      navigation: true,
      colorMode: 'light',
      title: 'First title',
    });
    try {
      await flush();
      expect(
        wrapper.container.querySelector('[data-testid="docx-editor-ruler-row"]')
      ).not.toBeNull();
      expect(wrapper.container.querySelector('.docx-nav')).not.toBeNull();
      expect(wrapper.container.querySelector('.docx-editor.dark')).toBeNull();
      expect(wrapper.container.textContent).toContain('First title');

      await wrapper.setProps({ rulers: false });
      expect(wrapper.container.querySelector('[data-testid="docx-editor-ruler-row"]')).toBeNull();
      await wrapper.setProps({ navigation: false });
      expect(wrapper.container.querySelector('.docx-nav')).toBeNull();
      await wrapper.setProps({ colorMode: 'dark' });
      expect(wrapper.container.querySelector('.docx-editor.dark')).not.toBeNull();
      await wrapper.setProps({ title: 'Second title' });
      expect(wrapper.container.textContent).toContain('Second title');
      expect(wrapper.container.textContent).not.toContain('First title');
    } finally {
      wrapper.unmount();
    }
  });
});

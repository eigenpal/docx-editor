import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, reactive, type Component } from 'vue';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
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

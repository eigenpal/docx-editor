import './dom-setup.ts';
import { expect, test } from 'bun:test';
import { createApp, h, shallowRef } from 'vue';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { LocaleProvider } from '../src/i18n/LocaleContext';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { flush } from './helpers/mount';
import {
  formFieldDocx,
  firstFormCatalogue,
  nextFormCatalogue,
} from '../../core/src/editor/__tests__/form-field-docx.fixture';

for (const composed of [false, true]) {
  test(`${composed ? 'Root provider' : 'packaged editor'} keeps form labels live without replacing controls`, async () => {
    const bytes = formFieldDocx();
    const catalogue = shallowRef(firstFormCatalogue);
    let editor: DocxEditorInstance | undefined;
    const props = {
      document: bytes,
      locale: 'pl-PL',
      onReady: (value: unknown) => {
        editor = value as DocxEditorInstance;
      },
    };
    const app = createApp({
      render: () =>
        composed
          ? h(
              LocaleProvider,
              { i18n: catalogue.value },
              {
                default: () =>
                  h(DocxEditorRoot, props, {
                    default: () =>
                      h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
                  }),
              }
            )
          : h(DocxEditor, { ...props, i18n: catalogue.value }),
    });
    const container = document.createElement('div');
    document.body.append(container);
    app.mount(container);
    try {
      await flush();
      const instance = editor!;
      const paragraphId = instance.surface!.session.paragraphIds()[0]!;
      instance.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 10 },
      });
      expect(instance.surface!.editTextFormField()).toBe(true);
      const panel = container.querySelector('dialog')!;
      expect(panel.getAttribute('aria-label')).toBe('Pole daty');
      expect(panel.textContent).toContain('Wartość');
      expect(panel.textContent).toContain('Maximum length');
      const input = panel.querySelector('input')!;
      input.value = 'unfinished';
      input.focus();
      catalogue.value = nextFormCatalogue;
      await flush();
      expect(editor).toBe(instance);
      expect(container.querySelector('dialog')).toBe(panel);
      expect(panel.getAttribute('aria-label')).toBe('Date field');
      expect(input.value).toBe('unfinished');
      expect(document.activeElement).toBe(input);
      expect(container.querySelector('.docx-text-form-status')?.textContent).toBe('Field selected');
    } finally {
      app.unmount();
      container.remove();
    }
  });
}

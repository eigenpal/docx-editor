// The Vue twin of the React refusal tests in `image-authoring.test.tsx`: a file that is not a
// supported picture shows an editor dialog, never a page-blocking browser alert, and
// `popups.imageInsertError` replaces or hides it.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { mountEditorTree } from './helpers/mount';

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 50));
}

afterEach(() => {
  document.body.innerHTML = '';
});

async function chooseNonImage(container: HTMLElement): Promise<void> {
  const input = container.querySelector('.docx-image-insert__input') as HTMLInputElement;
  const file = new File([new TextEncoder().encode('PK not a picture')], 'report.docx');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
}

const refusalDialog = () => document.querySelector('[data-docx-dialog="imageInsertError"]');

describe('picture refusal (Vue)', () => {
  test('a refused file shows an editor dialog, never a browser alert', async () => {
    const original = window.alert;
    let alerted = false;
    window.alert = () => {
      alerted = true;
    };
    try {
      const view = mountEditorTree(() => h(DocxEditorToolbar));
      await flush();
      await chooseNonImage(view.container);
      expect(alerted).toBe(false);
      const dialog = refusalDialog()!;
      expect(dialog.getAttribute('role')).toBe('alertdialog');
      expect(dialog.textContent).toContain('The file is not a supported PNG, JPEG, or GIF image.');
      const close = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Close'
      )!;
      close.click();
      await flush();
      expect(refusalDialog()).toBeNull();
    } finally {
      window.alert = original;
    }
  });

  test('popups.imageInsertError replaces the refusal dialog, and false shows nothing', async () => {
    const custom = mountEditorTree(() => h(DocxEditorToolbar), undefined, undefined, undefined, {
      popups: {
        imageInsertError: ({ message }: { message: string }) =>
          h('p', { 'data-testid': 'own-refusal' }, message),
      },
    });
    await flush();
    await chooseNonImage(custom.container);
    expect(document.querySelector('[data-testid="own-refusal"]')?.textContent).toContain(
      'PNG, JPEG, or GIF'
    );
    expect(refusalDialog()).toBeNull();
    document.body.innerHTML = '';
    const silent = mountEditorTree(() => h(DocxEditorToolbar), undefined, undefined, undefined, {
      popups: { imageInsertError: false },
    });
    await flush();
    await chooseNonImage(silent.container);
    expect(refusalDialog()).toBeNull();
  });
});

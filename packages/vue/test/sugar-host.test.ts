import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { createT, en, type TranslationKey, type Translations } from '@docx-editor.dev/i18n';
import { CHROME_MENUS, defaultChromeGroups, chromeSlotId } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { LocaleProvider } from '../src/i18n';
import { flush, mountComponent, mountEditorTree, mountSugarAsync, SOURCE } from './helpers/mount';
import { docx } from './helpers/fixtures';

afterEach(() => {
  document.body.innerHTML = '';
});

const label = createT(en);

describe('DocxEditor sugar host', () => {
  test('document-only mount renders full packaged chrome', async () => {
    const view = await mountSugarAsync({});
    await view.flush();
    expect(view.container.querySelector('[data-testid="docx-toolbar"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="docx-menubar"]')).not.toBeNull();
    expect(view.container.querySelector('.docx-nav')).not.toBeNull();
    view.unmount();
  });

  test('chrome={false} renders surface only with self-scoping parts', async () => {
    const view = await mountSugarAsync({ chrome: false });
    await view.flush();
    expect(view.container.querySelector('[data-testid="docx-toolbar"]')).toBeNull();
    expect(view.container.querySelector('.docx-paginated-surface')).not.toBeNull();
    expect(view.container.querySelector('.docx-editor')).not.toBeNull();
    view.unmount();
  });

  test('menu={false} removes the bar but keeps the toolbar', async () => {
    const view = await mountSugarAsync({ menu: false });
    await view.flush();
    expect(view.container.querySelector('[data-testid="docx-menubar"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="docx-toolbar"]')).not.toBeNull();
    view.unmount();
  });

  test('emits ready and exposes the seven-member handle', async () => {
    const ready: unknown[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createApp } = await import('vue');
    let handle: Record<string, unknown> | null = null;
    const app = createApp({
      render: () =>
        h(DocxEditor, {
          document: SOURCE,
          ref: (el: unknown) => {
            handle = el as Record<string, unknown>;
          },
          onReady: (editor: unknown) => ready.push(editor),
        }),
    });
    app.mount(container);
    await flush();
    expect(ready.length).toBe(1);
    for (const member of [
      'load',
      'save',
      'getDocumentHandle',
      'getEditor',
      'focus',
      'exec',
      'snapshot',
    ]) {
      expect(typeof handle?.[member]).toBe('function');
    }
    app.unmount();
    container.remove();
  });

  test('document identity rebuilds the editor', async () => {
    const firstView = await mountSugarAsync({ document: SOURCE });
    await firstView.flush();
    const first = firstView.editor();
    firstView.unmount();
    const secondView = await mountSugarAsync({
      document: docx('<w:p><w:r><w:t>rebuilt</w:t></w:r></w:p>'),
    });
    await secondView.flush();
    expect(secondView.editor()).not.toBe(first);
    secondView.unmount();
  });
});

describe('DocxEditorMenu composition', () => {
  test('renders every registry menu in order', async () => {
    const view = mountComponent(DocxEditorMenu);
    await flush();
    const bar = view.container.querySelector('[data-testid="docx-menubar"]');
    expect(bar).not.toBeNull();
    const ids = CHROME_MENUS.map((menu) => menu.id);
    for (const id of ids) {
      expect(bar!.querySelector(`[data-menu="${id}"]`)).not.toBeNull();
    }
    view.unmount();
  });

  test('preset={false} renders children verbatim', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorMenu, { preset: false }, { default: () => h(DocxEditorMenu.Insert) })
    );
    await flush();
    const menus = [...view.container.querySelectorAll('[data-menu]')].map((el) =>
      el.getAttribute('data-menu')
    );
    expect(menus).toEqual(['insert']);
    view.unmount();
  });
});

describe('DocxEditorToolbar composition', () => {
  test('default bar follows registry groups', async () => {
    const view = mountComponent(DocxEditorToolbar);
    await flush();
    const bar = view.container.querySelector('[data-testid="docx-toolbar"]');
    expect(bar).not.toBeNull();
    const slots = [...bar!.querySelectorAll('[data-slot]')].map((el) =>
      el.getAttribute('data-slot')
    );
    const expected = defaultChromeGroups().flatMap((group, index) => [
      ...(index > 0 ? ['separator'] : []),
      ...(group.id === 'alignment'
        ? ['alignment']
        : group.controls.map((control) => chromeSlotId(group, control) as string)),
    ]);
    expect(slots.some((slot) => expected.includes(slot!))).toBe(true);
    view.unmount();
  });
});

describe('DocxEditorContextMenu composition', () => {
  test('contextMenu={false} opts out of the packaged menu', async () => {
    const view = await mountSugarAsync({ contextMenu: false });
    await view.flush();
    const scroller = view.container.querySelector('.docx-editor__scroll-container');
    scroller!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    );
    await flush();
    expect(view.container.querySelector('.docx-contextmenu')).toBeNull();
    view.unmount();
  });
});

describe('DocxEditorNavigation composition', () => {
  test('renders the navigation toggle by default', async () => {
    const view = mountComponent(DocxEditorNavigation, {
      t: (key: string) => label(key as TranslationKey),
    });
    await flush();
    expect(view.container.querySelector('.docx-nav')).not.toBeNull();
    view.unmount();
  });
});

describe('DocxEditorLoading composition', () => {
  test('overlay mode mounts without a document', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createApp } = await import('vue');
    const app = createApp({ render: () => h(DocxEditorLoading, { when: true, overlay: true }) });
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.docx-editor__loading')).not.toBeNull();
    app.unmount();
    container.remove();
  });
});

describe('DocxEditor i18n prop', () => {
  test('i18n languages the chrome', async () => {
    const de = {
      _lang: 'de',
      formattingBar: { boldShortcut: 'Fett (Strg+B)' },
      toolbar: { file: 'Datei' },
    } as Translations;
    const view = await mountSugarAsync({ i18n: de });
    await view.flush();
    expect(view.container.textContent).toContain('Datei');
    view.unmount();
  });

  test('LocaleProvider is inherited when i18n is absent', async () => {
    const de = { _lang: 'de', toolbar: { file: 'Datei' } } as Translations;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createApp } = await import('vue');
    const app = createApp({
      render: () =>
        h(LocaleProvider, { i18n: de }, { default: () => h(DocxEditor, { document: SOURCE }) }),
    });
    app.mount(container);
    await flush();
    expect(container.textContent).toContain('Datei');
    app.unmount();
    container.remove();
  });
});

describe('packaged chrome band', () => {
  test('title bar and toolbar share one surface', async () => {
    const view = await mountSugarAsync({});
    await view.flush();
    const toolbar = view.container.querySelector('.docx-toolbar');
    const band = toolbar?.parentElement?.parentElement ?? null;
    expect(band).not.toBeNull();
    expect(band!.querySelector('.docx-menubar')).not.toBeNull();
    view.unmount();
  });

  test('chrome={false} renders no band', async () => {
    const view = await mountSugarAsync({ chrome: false });
    await view.flush();
    expect(view.container.querySelector('.docx-toolbar')).toBeNull();
    view.unmount();
  });
});

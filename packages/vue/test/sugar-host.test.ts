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
import { docx, LARGE_SOURCE } from './helpers/fixtures';

const label = createT(en);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditor sugar host', () => {
  test('mounts the default loading page while no document is available', async () => {
    const view = await mountSugarAsync({ document: undefined });
    await nextTick();
    const loading = view.container.querySelector('.docx-editor__loading--overlay');
    expect(loading).not.toBeNull();
    expect(loading?.querySelectorAll('.docx-editor__loading-page')).toHaveLength(1);
    expect(
      (view.container.querySelector('[data-testid="docx-toolbar"]') as HTMLFieldSetElement).disabled
    ).toBe(true);
    view.unmount();
  });

  test('keeps the default loading page up while a large document opens', async () => {
    const view = await mountSugarAsync({ document: LARGE_SOURCE });
    await nextTick();
    expect(view.container.querySelector('.docx-editor__loading-page')).not.toBeNull();

    await view.flush();
    expect(view.container.querySelector('.docx-editor__loading')).toBeNull();
    expect(view.container.textContent).toContain('large body');
    expect(
      (view.container.querySelector('[data-testid="docx-toolbar"]') as HTMLFieldSetElement).disabled
    ).toBe(false);
    view.unmount();
  });

  test('clamps rulers with the page on narrow viewports', async () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    try {
      const view = await mountSugarAsync({});
      await view.flush();
      const row = view.container.querySelector<HTMLElement>(
        '[data-testid="docx-editor-ruler-row"]'
      );
      const horizontal = view.container.querySelector<HTMLElement>('.docx-horizontal-ruler');
      expect(row?.style.display).toBe('');
      expect(horizontal?.style.marginInline).toBe('auto');
      expect(view.container.querySelector('.docx-vertical-ruler')).toBeNull();
      view.unmount();
    } finally {
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });

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

describe('DocxEditor sugar emits', () => {
  function openFileMenu(container: HTMLElement): void {
    const trigger = container.querySelector(
      '[data-menu="file"] .docx-menubar__trigger'
    ) as HTMLButtonElement | null;
    if (!trigger) throw new Error('file menu trigger not found');
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  function clickMenuRow(container: HTMLElement, slot: string): void {
    const row = container.querySelector(`[data-slot="${slot}"]`) as HTMLButtonElement | null;
    if (!row) throw new Error(`menu row ${slot} not found`);
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  test('forwards save when File > Save is chosen', async () => {
    const saves: number[] = [];
    const view = await mountSugarAsync({ onSave: () => saves.push(1) });
    await view.flush();
    openFileMenu(view.container);
    await view.flush();
    clickMenuRow(view.container, 'file.save');
    await view.flush();
    expect(saves).toEqual([1]);
    view.unmount();
  });

  test('forwards open when File > Open is chosen', async () => {
    const opens: number[] = [];
    const view = await mountSugarAsync({ onOpen: () => opens.push(1) });
    await view.flush();
    openFileMenu(view.container);
    await view.flush();
    clickMenuRow(view.container, 'file.open');
    expect(opens).toEqual([1]);
    view.unmount();
  });

  test('forwards titleChange when the title input edits', async () => {
    const titles: string[] = [];
    const view = await mountSugarAsync({
      title: 'Draft',
      onTitleChange: (title: string) => titles.push(title),
    });
    await view.flush();
    const input = view.container.querySelector('input[aria-label]') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(titles).toContain('Renamed');
    view.unmount();
  });

  test('forwards change when the document mutates', async () => {
    const changes: unknown[] = [];
    const view = await mountSugarAsync({ onChange: (change: unknown) => changes.push(change) });
    await view.flush();
    view.editor().exec({ type: 'insertText', text: '!' });
    await view.flush();
    expect(changes.length).toBeGreaterThan(0);
    view.unmount();
  });

  test('forwards fontError when the font resolver throws', async () => {
    const errors: unknown[] = [];
    const view = await mountSugarAsync({
      fonts: () => {
        throw new Error('resolver exploded');
      },
      onFontError: (error: unknown) => errors.push(error),
    });
    await view.flush();
    expect(errors.length).toBe(1);
    expect(String((errors[0] as { message?: string }).message ?? errors[0])).toContain(
      'resolver exploded'
    );
    view.unmount();
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
    expect(container.querySelectorAll('.docx-editor__loading-page')).toHaveLength(1);
    expect(container.querySelector('.docx-editor__loading-lines')).toBeNull();
    expect(container.querySelector('.docx-editor__loading-spinner')).not.toBeNull();
    expect(container.querySelector('.docx-editor-sr-only')?.textContent).toBe('Loading');
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

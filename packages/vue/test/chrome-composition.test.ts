import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import { chromeSlotId, defaultChromeGroups } from '@docx-editor.dev/core/editor';
import { h } from 'vue';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { ContextMenu } from '../src/editor/contextmenu';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { DocxEditorFontNotice } from '../src/editor/DocxEditorFontNotice';
import { DocxEditorContentControl } from '../src/editor/DocxEditorContentControl';
import { ToolbarImageInsert } from '../src/editor/images';
import { DocxEditorHeaderFooterChrome } from '../src/editor/DocxEditorHeaderFooter';
import {
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
  navigationShift,
} from '../src/editor/navigation/navigation-geometry';
import { flush, mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

const label = createT(en);

const EXPECTED_TOOLBAR: readonly string[] = defaultChromeGroups().flatMap((group, index) => [
  ...(index > 0 ? ['separator'] : []),
  ...(group.id === 'alignment'
    ? ['alignment']
    : group.controls.map((control) => chromeSlotId(group, control) as string)),
]);

function toolbarArrangement(toolbar: Element): string[] {
  return [...toolbar.children].flatMap((child) => {
    if (child.getAttribute('role') === 'separator') return 'separator';
    if (child.classList.contains('docx-toolbar__group')) {
      return [...child.children].map(
        (entry) =>
          entry.getAttribute('data-slot') ?? entry.getAttribute('aria-label') ?? entry.className
      );
    }
    return child.getAttribute('data-slot') ?? child.getAttribute('aria-label') ?? child.className;
  });
}

function menuIds(bar: Element): string[] {
  return [...bar.querySelectorAll('[data-menu]')].map((el) => el.getAttribute('data-menu')!);
}

function byLabel(key: string): string {
  return `[aria-label=${JSON.stringify(label(key as TranslationKey))}]`;
}

function openContextMenu(container: HTMLElement): MouseEvent {
  const scroller = container.querySelector('.docx-editor__scroll-container')!;
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100,
    button: 2,
  });
  scroller.dispatchEvent(event);
  return event;
}

describe('DocxEditorToolbar composition', () => {
  test('hidden removes a slot from the default bar', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorToolbar, null, { default: () => h(DocxEditorToolbar.Strike, { hidden: true }) })
    );
    await flush();
    const toolbar = view.container.querySelector('[data-testid="docx-toolbar"]')!;
    expect(view.container.querySelector(byLabel('formattingBar.strikethrough'))).toBeNull();
    expect(toolbarArrangement(toolbar).length).toBe(EXPECTED_TOOLBAR.length - 1);
    view.unmount();
  });

  test('preset={false} renders only composed children', async () => {
    const view = mountEditorTree(() =>
      h(
        DocxEditorToolbar,
        { preset: false },
        {
          default: () => [
            h(DocxEditorToolbar.Bold),
            h(DocxEditorToolbar.Separator),
            h(DocxEditorToolbar.Undo),
          ],
        }
      )
    );
    await flush();
    const toolbar = view.container.querySelector('[data-testid="docx-toolbar"]')!;
    expect(toolbarArrangement(toolbar)).toEqual(['text.bold', 'separator', 'history.undo']);
    view.unmount();
  });

  test('Bold reflects live engine state after click', async () => {
    const view = mountEditorTree(() => h(DocxEditorToolbar));
    await flush();
    view.editor().surface!.selectAll();
    await flush();
    const bold = view.container.querySelector(
      byLabel('formattingBar.boldShortcut')
    ) as HTMLButtonElement;
    expect(bold.hasAttribute('data-active')).toBe(false);
    bold.click();
    await flush();
    expect(bold.hasAttribute('data-active')).toBe(true);
    expect(view.editor().snapshot().formatting?.bold).toBe(true);
    view.unmount();
  });

  test('a part override keeps registry order and accepts class', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorToolbar, null, {
        default: () => h(DocxEditorToolbar.Bold, { class: 'custom-bold' }),
      })
    );
    await flush();
    const bold = view.container.querySelector(byLabel('formattingBar.boldShortcut'))!;
    expect(bold.className).toContain('custom-bold');
    const toolbar = view.container.querySelector('[data-testid="docx-toolbar"]')!;
    expect(toolbarArrangement(toolbar).slice(0, EXPECTED_TOOLBAR.length)).toEqual([
      ...EXPECTED_TOOLBAR,
    ]);
    view.unmount();
  });
});

describe('DocxEditorMenu composition', () => {
  test('hidden removes a menu from the bar', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorMenu, null, { default: () => h(DocxEditorMenu.Help, { hidden: true }) })
    );
    await flush();
    const bar = view.container.querySelector('[data-testid="docx-menubar"]')!;
    expect(menuIds(bar)).toEqual(['file', 'format', 'insert']);
    view.unmount();
  });

  test('preset={false} renders composed menus verbatim', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorMenu, { preset: false }, { default: () => h(DocxEditorMenu.Insert) })
    );
    await flush();
    const bar = view.container.querySelector('[data-testid="docx-menubar"]')!;
    expect(menuIds(bar)).toEqual(['insert']);
    view.unmount();
  });

  test('File menu override lands in place', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorMenu, null, {
        default: () => h(DocxEditorMenu.File, { class: 'custom-file' }),
      })
    );
    await flush();
    expect(view.container.querySelector('.custom-file')).not.toBeNull();
    const bar = view.container.querySelector('[data-testid="docx-menubar"]')!;
    expect(menuIds(bar)[0]).toBe('file');
    view.unmount();
  });

  test('file menu trigger carries the registry label and popup contract', async () => {
    const view = mountEditorTree(() => h(DocxEditorMenu));
    await flush();
    const trigger = view.container.querySelector('[data-menu="file"] .docx-menubar__trigger');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.textContent).toContain(label('toolbar.file' as TranslationKey));
    view.unmount();
  });
});

describe('DocxEditorContextMenu composition', () => {
  test('right-click opens the panel on the surface', async () => {
    const view = mountEditorTree(
      () => [],
      undefined,
      () => h(ContextMenu)
    );
    await flush();
    const event = openContextMenu(view.container);
    await flush();
    const panel = view.container.querySelector('.docx-contextmenu');
    expect(panel).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(
      panel!.querySelectorAll('.docx-menubar__item, [role="menuitem"]').length
    ).toBeGreaterThan(0);
    view.unmount();
  });

  test('hidden removes a row from the default set', async () => {
    const view = mountEditorTree(
      () => [],
      undefined,
      () => h(ContextMenu, null, { default: () => h(ContextMenu.Cut, { hidden: true }) })
    );
    await flush();
    openContextMenu(view.container);
    await flush();
    const text = view.container.textContent ?? '';
    expect(text).not.toContain(label('contextMenu.cut' as TranslationKey));
    expect(text).toContain(label('contextMenu.copy' as TranslationKey));
    view.unmount();
  });

  test('preset={false} renders composed rows verbatim', async () => {
    const view = mountEditorTree(
      () => [],
      undefined,
      () => h(ContextMenu, { preset: false }, { default: () => h(ContextMenu.SelectAll) })
    );
    await flush();
    openContextMenu(view.container);
    await flush();
    expect(view.container.querySelectorAll('.docx-contextmenu .docx-menubar__item').length).toBe(1);
    expect(view.container.textContent).toContain(label('contextMenu.selectAll' as TranslationKey));
    view.unmount();
  });
});

describe('DocxEditorNavigation composition', () => {
  test('navigationShift matches the reservation geometry', () => {
    const reservation = navigationPaneReservation();
    expect(reservation).toBe(NAVIGATION_PANE_INSET + NAVIGATION_PANE_WIDTH + NAVIGATION_PANE_GAP);
    expect(navigationShift({ viewportWidth: 1728, pageWidthPx: 816, reservation })).toBe(0);
  });

  test('navigation toggle renders on the collapsed pane', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorNavigation, { t: (key: string) => label(key as TranslationKey) })
    );
    await flush();
    expect(view.container.querySelector('.docx-nav__toggle')).not.toBeNull();
    view.unmount();
  });
});

describe('DocxEditorHyperLink composition', () => {
  test('hyperlinkPopup={false} on sugar host omits the popup', async () => {
    const { mountSugarAsync } = await import('./helpers/mount');
    const view = await mountSugarAsync({ hyperlinkPopup: false });
    await flush();
    expect(view.container.querySelector('[data-docx-hyperlink-popup]')).toBeNull();
    view.unmount();
  });
});

describe('DocxEditorLoading composition', () => {
  test('host children replace the packaged spinner when provided', async () => {
    const view = mountEditorTree(() =>
      h(
        DocxEditorLoading,
        { when: true },
        {
          default: () => h('div', { 'data-testid': 'host-loading' }, 'wait'),
        }
      )
    );
    await flush();
    expect(view.container.querySelector('[data-testid="host-loading"]')).not.toBeNull();
    view.unmount();
  });
});

describe('image authoring', () => {
  test('image.insert exposes a live slot marker on the default toolbar', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorToolbar, { preset: false }, { default: () => h(ToolbarImageInsert) })
    );
    await flush();
    expect(view.container.querySelector('[data-slot="image.insert"]')).not.toBeNull();
    view.unmount();
  });
});

describe('content control authoring', () => {
  test('content control inspector mounts closed outside an SDT', async () => {
    const view = mountEditorTree(() => h(DocxEditorContentControl));
    await flush();
    expect(view.container.querySelector('.docx-content-control')).toBeNull();
    view.unmount();
  });
});

describe('secondary chrome', () => {
  test('header/footer chrome stays hidden until a region is open', async () => {
    const view = mountEditorTree(() => h(DocxEditorHeaderFooterChrome));
    await flush();
    expect(view.container.querySelector('[data-testid="docx-hf-chrome"]')).toBeNull();
    view.unmount();
  });

  test('font notice stays hidden without substitutions', async () => {
    const view = mountEditorTree(() => h(DocxEditorFontNotice));
    await flush();
    expect(view.container.querySelector('.docx-font-notice')).toBeNull();
    view.unmount();
  });
});

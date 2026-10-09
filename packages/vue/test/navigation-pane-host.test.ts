// The navigation pane in a composed host: `DocxEditorRoot` + `DocxEditorViewport` with the
// pane mounted inside the Viewport, as the composition guides show it. The React twin is
// `packages/react/test/navigation-pane-host.test.tsx`; the two hold the same claims.

import './dom-setup.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import deCatalog from '../../i18n/de.json';
import { resolve } from 'node:path';
import { h, nextTick, ref } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { inertBehindPane } from '../src/editor/navigation/navigation-keys';
import {
  NAVIGATION_PANE_MIN_PAGE_ROOM,
  navigationPaneOverlays,
  navigationPaneReservation,
} from '../src/editor/navigation/navigation-geometry';
import type { NavigationTab } from '../src/editor/navigation/useNavigationPane';
import { flush, mountEditorTree, mountSugarAsync, type MountedEditor } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const SOURCE = docx(
  heading('First') + '<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>' + heading('Second')
);
// A Letter portrait section followed by a Letter landscape one (11in = 1056px wide).
const MIXED = docx(
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>portrait</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>landscape</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>'
);

// happy-dom lays nothing out; the scroll container reports chosen sizes instead.
let scrollerWidth = 1600;
const scrollerHeight = 700;
const restore: Array<() => void> = [];

function stub(property: 'clientWidth' | 'clientHeight', value: () => number) {
  let owner: object = Element.prototype;
  let original: PropertyDescriptor | undefined;
  for (const proto of [Element.prototype, HTMLElement.prototype] as object[]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (descriptor) {
      owner = proto;
      original = descriptor;
      break;
    }
  }
  Object.defineProperty(owner, property, {
    configurable: true,
    get(this: Element) {
      if (this.classList?.contains('docx-editor__scroll-container')) return value();
      return original?.get ? (original.get.call(this) as number) : 0;
    },
  });
  restore.push(() => {
    if (original) Object.defineProperty(owner, property, original);
  });
}

beforeAll(() => {
  stub('clientWidth', () => scrollerWidth);
  stub('clientHeight', () => scrollerHeight);
});
afterAll(() => {
  for (const undo of restore) undo();
});

const mounted: MountedEditor[] = [];
beforeEach(() => {
  scrollerWidth = 1600;
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

function mountPane(
  props: Record<string, unknown> = {},
  options: { source?: Uint8Array; rootProps?: Record<string, unknown> } = {}
): MountedEditor {
  const view = mountEditorTree(
    () => [],
    options.source ?? SOURCE,
    () => [h(DocxEditorNavigation, props)],
    undefined,
    options.rootProps ?? {}
  );
  mounted.push(view);
  return view;
}

async function ctrlF(target: Element, init: KeyboardEventInit = { ctrlKey: true }) {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  await nextTick();
  await nextTick();
  return event;
}

const q = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;

/** A resolver over the German catalogue source, as a host passes it to Root. */
function germanTranslate(key: string, params: Record<string, string | number> = {}): string {
  let node: unknown = deCatalog;
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : null;
  }
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

describe('the pane in the documented composition', () => {
  test('sits in the scroll container as a sticky strip sized to the viewport', async () => {
    const view = mountPane();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    const nav = q(view.container, '.docx-nav');
    expect(nav.parentElement).toBe(scroller);
    expect(nav.style.getPropertyValue('--docx-nav-block-size')).toBe(`${scrollerHeight}px`);
    expect(nav.style.getPropertyValue('--docx-nav-inline-size')).toBe(`${scrollerWidth}px`);

    const css = readFileSync(resolve(import.meta.dir, '../../core/src/styles/editor.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      // Sticky pins it to the scrollport; absolute would carry it off with the pages.
      expect(getComputedStyle(nav).position).toBe('sticky');
      expect(getComputedStyle(nav).height).toBe('0px');
    } finally {
      style.remove();
    }
  });
});

describe('Ctrl/Cmd+F', () => {
  test('opens an uncontrolled pane on Find and focuses the query', async () => {
    const view = mountPane();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.focus();
    const event = await ctrlF(scroller);
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(q(view.container, '#docx-nav-tab-find').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(
      q(view.container, '#docx-nav-panel-find .docx-nav__search-input')
    );
  });

  test('refocuses the query of a pane already open on Find', async () => {
    const view = mountPane({ defaultOpen: true, defaultTab: 'find' });
    await flush();
    const input = q(view.container, '#docx-nav-panel-find .docx-nav__search-input');
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.focus();
    expect(document.activeElement).toBe(scroller);
    await ctrlF(scroller);
    expect(document.activeElement).toBe(input);
  });

  test('takes only the platform modifier: Cmd on macOS, Ctrl elsewhere', async () => {
    const view = mountPane();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    const nav = q(view.container, '.docx-nav');
    // Not an Apple platform (the test environment): Meta is the system key.
    expect((await ctrlF(scroller, { metaKey: true })).defaultPrevented).toBe(false);
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    try {
      // On macOS Ctrl+F moves the caret forward one character; the text keeps it.
      expect((await ctrlF(scroller, { ctrlKey: true })).defaultPrevented).toBe(false);
      expect(nav.getAttribute('data-open')).toBe('false');
      expect((await ctrlF(scroller, { metaKey: true })).defaultPrevented).toBe(true);
    } finally {
      delete (navigator as unknown as { platform?: string }).platform;
    }
    await flush();
    expect(nav.getAttribute('data-open')).toBe('true');
  });

  test('drops a request the controlled host declined, so a later open does not steal focus', async () => {
    const open = ref(false);
    const view = mountEditorTree(
      () => [],
      SOURCE,
      // The host ignores the pane's request to open.
      () => [h(DocxEditorNavigation, { open: open.value, onOpenChange: () => {} })]
    );
    mounted.push(view);
    await flush();
    q(view.container, '.docx-nav__toggle').click();
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      outside.focus();
      // The host opens the pane later, for its own reasons: focus stays where it was.
      open.value = true;
      await flush();
      expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('true');
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  test('drives a controlled pane through its callbacks and focuses once the host opens it', async () => {
    const seen: string[] = [];
    const open = ref(false);
    const tab = ref<NavigationTab>('headings');
    const view = mountEditorTree(
      () => [],
      SOURCE,
      () => [
        h(DocxEditorNavigation, {
          open: open.value,
          tab: tab.value,
          onOpenChange: (next: boolean) => {
            seen.push(`open:${next}`);
            open.value = next;
          },
          onTabChange: (next: NavigationTab) => {
            seen.push(`tab:${next}`);
            tab.value = next;
          },
        }),
      ]
    );
    mounted.push(view);
    await flush();
    await ctrlF(q(view.container, '.docx-editor__scroll-container'));
    await flush();
    expect(seen).toEqual(['tab:find', 'open:true']);
    expect(document.activeElement).toBe(
      q(view.container, '#docx-nav-panel-find .docx-nav__search-input')
    );
  });

  test('leaves the chord alone outside this editor and in another editor', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const a = mountPane();
    const b = mountPane({ toggle: false });
    await flush();
    try {
      outside.focus();
      expect((await ctrlF(outside)).defaultPrevented).toBe(false);
      const navA = q(a.container, '.docx-nav');
      const navB = q(b.container, '.docx-nav');
      expect(navA.getAttribute('data-open')).toBe('false');
      expect(navB.getAttribute('data-open')).toBe('false');

      await ctrlF(q(b.container, '.docx-editor__scroll-container'));
      await flush();
      expect(navA.getAttribute('data-open')).toBe('false');
      expect(navB.getAttribute('data-open')).toBe('true');
    } finally {
      outside.remove();
    }
  });

  test('works in the packaged editor from the pages and from the toolbar', async () => {
    const view = await mountSugarAsync({ document: SOURCE });
    mounted.push(view);
    await flush();
    const nav = q(view.container, '.docx-nav');
    await ctrlF(q(view.container, '.docx-editor__scroll-container'));
    await flush();
    expect(nav.getAttribute('data-open')).toBe('true');
    q(view.container, '#docx-nav-panel-find .docx-nav__search-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await flush();
    expect(nav.getAttribute('data-open')).toBe('false');
    const toolbarButton = q(view.container, '.docx-toolbar button');
    expect(toolbarButton).not.toBeNull();
    await ctrlF(toolbarButton);
    await flush();
    expect(nav.getAttribute('data-open')).toBe('true');
  });

  test('findShortcut: false leaves the chord to the browser and the disc does not name it', async () => {
    const view = mountPane({ findShortcut: false });
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    expect((await ctrlF(scroller)).defaultPrevented).toBe(false);
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    const disc = q(view.container, '.docx-nav__toggle');
    expect(disc.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(disc.getAttribute('title')).toBe('Navigation');
  });

  test('is named on the disc', async () => {
    const view = mountPane();
    await flush();
    const disc = q(view.container, '.docx-nav__toggle');
    expect(disc.getAttribute('title')).toBe('Navigation (Ctrl+F)');
    expect(disc.getAttribute('aria-keyshortcuts')).toBe('Control+F');
  });
});

describe('the disc', () => {
  test('on macOS in another language, names Cmd+F, never the translated Ctrl spelling', async () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    try {
      const view = mountPane({}, { rootProps: { translate: germanTranslate } });
      await flush();
      const disc = q(view.container, '.docx-nav__toggle');
      expect(disc.getAttribute('aria-label')).toBe(germanTranslate('navigation.openAriaLabel'));
      expect(disc.getAttribute('title')).toBe(`${germanTranslate('navigation.openTitle')} (⌘+F)`);
      expect(disc.getAttribute('title')).not.toContain('Strg');
      expect(disc.getAttribute('aria-keyshortcuts')).toBe('Meta+F');
    } finally {
      delete (navigator as unknown as { platform?: string }).platform;
    }
  });

  test('follows findShortcut and t when they change at runtime', async () => {
    const findShortcut = ref(true);
    const prefix = ref('');
    const view = mountEditorTree(
      () => [],
      SOURCE,
      () => [
        h(DocxEditorNavigation, {
          findShortcut: findShortcut.value,
          ...(prefix.value ? { t: (key: string) => `${prefix.value}${key}` } : {}),
        }),
      ]
    );
    mounted.push(view);
    await flush();
    const disc = () => q(view.container, '.docx-nav__toggle');
    expect(disc().getAttribute('aria-keyshortcuts')).toBe('Control+F');
    expect(disc().getAttribute('title')).toBe('Navigation (Ctrl+F)');
    findShortcut.value = false;
    await flush();
    expect(disc().hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(disc().getAttribute('title')).toBe('Navigation');
    prefix.value = 'x:';
    await flush();
    expect(disc().getAttribute('aria-label')).toBe('x:navigation.openAriaLabel');
  });
});

describe('focus', () => {
  test('the disc moves focus into Headings, and the close arrow returns it to the disc', async () => {
    const view = mountPane();
    await flush();
    q(view.container, '.docx-nav__toggle').click();
    await flush();
    const first = q(view.container, '#docx-nav-panel-headings .docx-nav__heading');
    expect(first.textContent).toBe('First');
    expect(document.activeElement).toBe(first);
    q(view.container, '.docx-nav__close').click();
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(q(view.container, '.docx-nav__toggle'));
  });

  test('Escape closes the pane and returns focus to the element that opened it', async () => {
    const view = mountPane();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.focus();
    await ctrlF(scroller);
    await flush();
    const input = q(view.container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(scroller);
  });
});

describe('focus return without scrolling', () => {
  test('a host that unmounts the pane on close still gets focus back', async () => {
    const shown = ref(true);
    const view = mountEditorTree(
      () => [],
      SOURCE,
      () =>
        shown.value
          ? [
              h(DocxEditorNavigation, {
                onOpenChange: (next: boolean) => {
                  if (!next) shown.value = false;
                },
              }),
            ]
          : []
    );
    mounted.push(view);
    await flush();
    const button = q(view.container, '.docx-nav__toggle');
    button.focus();
    button.click();
    await flush();
    q(view.container, '.docx-nav__close').click();
    await flush();
    expect(view.container.querySelector('.docx-nav')).toBeNull();
    // The disc went with the pane: focus returns to the document, not to the body.
    expect(document.activeElement).not.toBe(document.body);
    expect(view.container.contains(document.activeElement)).toBe(true);
  });

  test('Ctrl+F from the pages, then Escape, refocuses the pages without scrolling', async () => {
    const view = mountPane();
    await flush();
    const pages = q(view.container, '.docx-pages');
    expect(pages).not.toBeNull();
    pages.focus({ preventScroll: true });
    expect(document.activeElement).toBe(pages);
    await ctrlF(pages);
    await flush();
    const input = q(view.container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);

    // Every focus call from here on, with its options. The pages layer is the whole
    // document tall: a plain focus() on it scrolls the document to page 1.
    const calls: Array<{ element: Element; options?: FocusOptions }> = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      calls.push({ element: this, ...(options ? { options } : {}) });
      return original.call(this, options);
    };
    try {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await flush();
    } finally {
      HTMLElement.prototype.focus = original;
    }
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(pages);
    const onPages = calls.filter((call) => call.element === pages);
    expect(onPages.length).toBeGreaterThan(0);
    for (const call of onPages) expect(call.options?.preventScroll).toBe(true);
  });
});

describe('narrow viewports', () => {
  test('the threshold leaves a readable page column beside the pane', () => {
    const reservation = navigationPaneReservation();
    expect(navigationPaneOverlays(390, reservation)).toBe(true);
    expect(
      navigationPaneOverlays(reservation + NAVIGATION_PANE_MIN_PAGE_ROOM - 1, reservation)
    ).toBe(true);
    expect(navigationPaneOverlays(reservation + NAVIGATION_PANE_MIN_PAGE_ROOM, reservation)).toBe(
      false
    );
  });

  test('at 390px the pane overlays the page, shifts nothing, and closes on a pick', async () => {
    scrollerWidth = 390;
    const view = mountPane({ defaultOpen: true });
    await flush();
    const nav = q(view.container, '.docx-nav');
    expect(nav.classList.contains('docx-nav--overlay')).toBe(true);
    const scroller = q(view.container, '.docx-editor__scroll-container');
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe('0px');
    q(view.container, '.docx-nav__heading').click();
    await flush();
    expect(nav.getAttribute('data-open')).toBe('false');
  });

  test('the review rail counts: room the rail takes is not room beside the pane', async () => {
    scrollerWidth = 700;
    const view = mountPane({});
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    // 700 less the 328px reservation leaves 372px, enough on its own; a 300px rail does not.
    scroller.style.setProperty('padding-inline-end', '300px');
    q(view.container, '.docx-nav__toggle').click();
    await flush();
    expect(q(view.container, '.docx-nav').classList.contains('docx-nav--overlay')).toBe(true);
  });

  test('without a rail the same viewport docks the pane', async () => {
    scrollerWidth = 700;
    const view = mountPane({ defaultOpen: true });
    await flush();
    expect(q(view.container, '.docx-nav').classList.contains('docx-nav--overlay')).toBe(false);
  });

  test('an overlaying pane makes the page area inert until it closes', async () => {
    scrollerWidth = 390;
    const view = mountPane({ defaultOpen: true });
    await flush();
    const pages = q(view.container, '.docx-pages');
    expect(pages.closest('[inert]')).not.toBeNull();
    expect(q(view.container, '.docx-nav__panel-shell').closest('[inert]')).toBeNull();
    q(view.container, '.docx-nav__heading').click();
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(pages.closest('[inert]')).toBeNull();
  });

  test('a docked pane leaves the page area interactive', async () => {
    const view = mountPane({ defaultOpen: true });
    await flush();
    expect(q(view.container, '.docx-pages').closest('[inert]')).toBeNull();
  });

  test('a host that keeps the pane open after a pick keeps the page inert and focus in the pane', async () => {
    scrollerWidth = 390;
    const onOpenChange = mock(() => {});
    const view = mountPane({ open: true, onOpenChange });
    await flush();
    const pages = q(view.container, '.docx-pages');
    const heading = q(view.container, '.docx-nav__heading');
    heading.focus();
    heading.click();
    await flush();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(pages.closest('[inert]')).not.toBeNull();
    expect(pages.contains(document.activeElement)).toBe(false);
  });

  test('a press on the page it leaves visible closes the overlaying pane', async () => {
    scrollerWidth = 390;
    const view = mountPane({ defaultOpen: true });
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(q(view.container, '.docx-pages').closest('[inert]')).toBeNull();
  });

  test('a wide viewport keeps the pane open after a pick', async () => {
    const view = mountPane({ defaultOpen: true });
    await flush();
    const nav = q(view.container, '.docx-nav');
    expect(nav.classList.contains('docx-nav--overlay')).toBe(false);
    q(view.container, '.docx-nav__heading').click();
    await flush();
    expect(nav.getAttribute('data-open')).toBe('true');
  });
});

describe('language', () => {
  test('falls back to the translate given to Root', async () => {
    const translate = (key: string) =>
      key === 'navigation.openAriaLabel' ? 'Navigation öffnen' : key;
    const view = mountPane({}, { rootProps: { translate } });
    await flush();
    expect(q(view.container, '.docx-nav__toggle').getAttribute('aria-label')).toBe(
      'Navigation öffnen'
    );
    // Keys the Root resolver leaves unresolved still come from the catalogue.
    expect(q(view.container, '#docx-nav-tab-find').textContent).toBe('Find');
  });

  test('the pane’s own t still wins', async () => {
    const view = mountPane(
      { t: (key: string) => `pane:${key}` },
      { rootProps: { translate: () => 'root' } }
    );
    await flush();
    expect(q(view.container, '.docx-nav__toggle').getAttribute('aria-label')).toBe(
      'pane:navigation.openAriaLabel'
    );
  });
});

describe('page width', () => {
  test('the shift clears the widest page, not only the caret section', async () => {
    // 1300px: the portrait page alone leaves a 242px gutter (shift 172), but the landscape
    // page widens the stack to 1056px and the pane needs the full 328px reservation.
    scrollerWidth = 1300;
    const view = mountPane({ defaultOpen: true }, { source: MIXED });
    await flush();
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe(
      `${navigationPaneReservation()}px`
    );
  });
});

describe('an open toolbar popup and Ctrl/Cmd+F', () => {
  test('moving focus into the find field closes the dropdown, so Escape reaches the pane', async () => {
    const view = mountEditorTree(
      () =>
        h(
          DocxEditorToolbar,
          { preset: false, overflow: false },
          { default: () => [h(DocxEditorToolbar.Alignment)] }
        ),
      SOURCE,
      () => [h(DocxEditorNavigation)]
    );
    mounted.push(view);
    await flush();
    const scroller = q(view.container, '.docx-editor__scroll-container');
    scroller.focus();
    const trigger = q(view.container, '[data-slot="alignment"] [aria-haspopup]');
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.click();
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await ctrlF(scroller);
    await flush();
    const input = q(view.container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await flush();
    expect(q(view.container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(scroller);
  });
});

describe('focus when the pane covers the page', () => {
  test('focus in content that turns inert moves into the pane', () => {
    const viewport = document.createElement('div');
    const pane = document.createElement('nav');
    const find = document.createElement('input');
    find.className = 'docx-nav__search-input';
    pane.append(find);
    const rail = document.createElement('div');
    const draft = document.createElement('textarea');
    rail.append(draft);
    viewport.append(pane, rail);
    document.body.append(viewport);
    try {
      draft.focus();
      expect(document.activeElement).toBe(draft);
      const release = inertBehindPane(pane, viewport);
      expect(rail.hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(find);
      release();
      expect(rail.hasAttribute('inert')).toBe(false);
    } finally {
      viewport.remove();
    }
  });

  test('focus outside the covered content stays where it is', () => {
    const viewport = document.createElement('div');
    const pane = document.createElement('nav');
    pane.append(document.createElement('input'));
    viewport.append(pane, document.createElement('div'));
    const host = document.createElement('input');
    document.body.append(viewport, host);
    try {
      host.focus();
      const release = inertBehindPane(pane, viewport);
      expect(document.activeElement).toBe(host);
      release();
    } finally {
      viewport.remove();
      host.remove();
    }
  });
});

// The navigation pane in a composed host: `DocxEditorRoot` + `DocxEditorViewport` with the
// pane mounted inside the Viewport, as the composition guides show it. The React twin is
// `packages/react/test/navigation-pane-host.test.tsx`; the two hold the same claims.

import './dom-setup.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { h, nextTick, ref } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorNavigation } from '../src/editor/navigation';
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

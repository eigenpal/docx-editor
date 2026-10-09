// The review pane's `overflow` setting is scoped to the review pane. With the navigation pane
// and the review pane both open, every overflow mode keeps the navigation pane docked at its
// side: it is a sibling of the scroll container (so a sideways scroll of the document never
// moves it), and it still takes its room beside the page. Under `overflow: 'scroll'` the page
// keeps one size as the review pane opens and closes, and that size leaves the navigation
// pane its room.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

// React's `act` refuses to run outside an act-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { useContext, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type {
  DocxEditorInstance,
  EditorModule,
  ReviewPaneOverflow,
} from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
  ),
});

const REVIEW_MODULE: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};

/** Letter at 100%, in CSS px. */
const PAGE = 816;
/** The closed review pane's marker strip on both edges. */
const STRIP = 88;
const VIEWPORT = 900;
/** The width the scroll container reports; a test may narrow it. */
let scrollerWidth = VIEWPORT;

/** A rail with no UI: claims the gutter exactly the way `DocxEditor.Review` does. */
function RailStub() {
  const registry = useContext(ReviewRailContext);
  useEffect(() => registry?.register(), [registry]);
  return null;
}

// happy-dom lays nothing out, so the scroll container reports a chosen width instead.
let originalClientWidth: PropertyDescriptor | undefined;
let clientWidthOwner: object | null = null;

beforeAll(() => {
  for (const proto of [Element.prototype, HTMLElement.prototype] as object[]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    if (descriptor) {
      originalClientWidth = descriptor;
      clientWidthOwner = proto;
      break;
    }
  }
  const target = clientWidthOwner ?? Element.prototype;
  Object.defineProperty(target, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      if (this.classList?.contains('docx-editor__scroll-container')) return scrollerWidth;
      return originalClientWidth?.get ? (originalClientWidth.get.call(this) as number) : 0;
    },
  });
  if (!clientWidthOwner) clientWidthOwner = target;
});

afterAll(() => {
  if (clientWidthOwner && originalClientWidth) {
    Object.defineProperty(clientWidthOwner, 'clientWidth', originalClientWidth);
  }
});

afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Leave the fit and come back, so it measures the settled reservations. */
async function refit(editor: DocxEditorInstance) {
  for (let pass = 0; pass < 3; pass += 1) {
    act(() => {
      editor.setZoomMode({ type: 'fixed' });
    });
    act(() => {
      editor.setZoomMode('auto');
    });
    await settle();
  }
}

async function mountBothPanes(overflow: ReviewPaneOverflow) {
  let editor: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      modules={[REVIEW_MODULE]}
      onReady={(ready) => {
        editor = ready as DocxEditorInstance;
      }}
    >
      <DocxEditorNavigation defaultOpen />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <RailStub />
    </DocxEditorRoot>
  );
  await settle();
  act(() => {
    editor!.setReviewPaneOptions({ overflow });
    if (!editor!.snapshot().reviewPaneOpen) editor!.exec({ type: 'toggleReviewPane' });
  });
  await refit(editor!);
  const scroller = view.container.querySelector('.docx-editor__scroll-container') as HTMLElement;
  const nav = view.container.querySelector('.docx-nav') as HTMLElement;
  return { editor: editor!, scroller, nav };
}

/** The stylesheet's padding rule, which the pane measures; these files load no CSS. */
function withGutterPadding(): () => void {
  const style = document.createElement('style');
  style.textContent =
    '.docx-editor__scroll-container { padding-inline-end: var(--docx-review-gutter); ' +
    'padding-inline-start: var(--docx-review-gutter-start); }';
  document.head.append(style);
  return () => style.remove();
}

const px = (element: HTMLElement, name: string) =>
  Number.parseFloat(element.style.getPropertyValue(name)) || 0;

describe('overflow is scoped to the review pane', () => {
  for (const overflow of ['float', 'shrinkPage', 'scroll'] as const) {
    test(`'${overflow}': the navigation pane stays docked beside the scrolling document`, async () => {
      const { editor, scroller, nav } = await mountBothPanes(overflow);
      expect(editor.snapshot().reviewPaneOpen).toBe(true);
      expect(nav.getAttribute('data-open')).toBe('true');
      // Not inside the scroll container: a sideways scroll moves the pages, never the pane.
      expect(scroller.contains(nav)).toBe(false);
      const before = nav.parentElement;
      scroller.scrollLeft = 200;
      scroller.dispatchEvent(new Event('scroll'));
      await settle();
      expect(nav.parentElement).toBe(before);
      expect(scroller.contains(nav)).toBe(false);
      // The pane still takes its room beside the page in every mode.
      expect(px(scroller, '--docx-nav-shift')).toBeGreaterThan(0);
    });
  }

  test("'scroll': the page leaves the navigation pane its room and keeps one size", async () => {
    const { editor, scroller } = await mountBothPanes('scroll');
    // The full review column stands; the viewport scrolls sideways to it.
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    const navigationRoom =
      px(scroller, '--docx-nav-shift') + px(scroller, '--docx-review-gutter-start') - STRIP / 2;
    expect(navigationRoom).toBeGreaterThan(0);
    const open = editor.getZoom();
    expect(open * PAGE).toBeLessThanOrEqual(VIEWPORT - STRIP - navigationRoom);

    act(() => {
      editor.exec({ type: 'toggleReviewPane' });
    });
    await refit(editor);
    expect(editor.snapshot().reviewPaneOpen).toBe(false);
    expect(editor.getZoom()).toBe(open);
  });
});

describe('the navigation pane beside a scrolling review column', () => {
  test("'scroll' at 900px: only the visible marker strip counts, so the pane docks", async () => {
    const removeStyle = withGutterPadding();
    try {
      const { scroller, nav } = await mountBothPanes('scroll');
      expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
      expect(nav.getAttribute('data-open')).toBe('true');
      expect(nav.classList.contains('docx-nav--overlay')).toBe(false);
    } finally {
      removeStyle();
    }
  });

  test("'scroll' on a truly narrow viewport still overlays the page", async () => {
    const removeStyle = withGutterPadding();
    scrollerWidth = 500;
    try {
      const { nav } = await mountBothPanes('scroll');
      expect(nav.classList.contains('docx-nav--overlay')).toBe(true);
    } finally {
      scrollerWidth = VIEWPORT;
      removeStyle();
    }
  });
});

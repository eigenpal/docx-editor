// `getCurrentPage('viewport')` — which page the reader is looking at.
//
// The frame seeds `currentPage.viewport` to 0 and carries it forward, so reading it
// answered "page 1" at every scroll position. These cases pin the derivation: the page
// under the scroll container's vertical MIDPOINT, tested against the STACKED page
// geometry (not the page-local `display` boxes, which all report `y: 0` — testing
// against those returns the last page at any scroll, and the "not a constant" case
// below is what catches that).

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import type { InteractionHostMetrics } from '@docx-editor.dev/core-contract/contracts/interaction';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';
import { modelWith } from './interaction-test-helpers.ts';

// Enough paragraphs to paginate well past one page.
const MULTI_PAGE = writeDocx(modelWith(Array.from({ length: 220 }, (_, i) => `line ${i}`)));

const CONTAINER_TOP = 100;
const CONTAINER_HEIGHT = 800;

/** A scroll container whose top edge sits at a fixed client y. Only its rect is read. */
function scrollContainer(): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      x: 0,
      y: CONTAINER_TOP,
      top: CONTAINER_TOP,
      height: CONTAINER_HEIGHT,
      width: 900,
      bottom: CONTAINER_TOP + CONTAINER_HEIGHT,
      left: 0,
      right: 900,
    }),
  } as unknown as HTMLElement;
}

/**
 * Host whose pages-stack origin moves like a real one: scrolling down by N pushes the
 * stack's client top up by N. Zoom is 1, so a client offset from the stack origin and a
 * content coordinate are the same number.
 */
function hostScrolledBy(scrollTop: () => number): EditorHost {
  const metrics = (): InteractionHostMetrics => ({
    clientOrigin: { x: 0, y: CONTAINER_TOP - scrollTop() },
    scrollOffset: { x: 0, y: 0 },
    zoom: 1,
  });
  return {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => scrollContainer(),
    getInteractionHostMetrics: metrics,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

const editorScrolledBy = (scrollTop: () => number, document: Uint8Array = MULTI_PAGE): Editor =>
  createEditor({ host: hostScrolledBy(scrollTop), document });

/** Scroll offset that puts the viewport midpoint `into` px below a page's top. */
const scrollToPage = (top: number, into = 10) => top + into - CONTAINER_HEIGHT / 2;

describe("getCurrentPage('viewport')", () => {
  test('an unscrolled document reads page 0', () => {
    const editor = editorScrolledBy(() => 0);
    expect(editor.getTotalPages()).toBeGreaterThan(2); // otherwise the rest proves little
    expect(editor.getCurrentPage('viewport')).toBe(0);
    editor.destroy();
  });

  test('the page under the viewport midpoint is the one reported, and it is not a constant', () => {
    let top = 0;
    const editor = editorScrolledBy(() => top);
    const pages = editor.getPageGeometry();

    // Every page in turn, so a derivation that always returns the first or the last
    // cannot pass.
    for (let i = 0; i < pages.length; i += 1) {
      top = scrollToPage(pages[i]!.box.y);
      expect(editor.getCurrentPage('viewport')).toBe(i);
    }
    editor.destroy();
  });

  test('a midpoint in the gap between two pages reads as the page below it', () => {
    let top = 0;
    const editor = editorScrolledBy(() => top);
    const pages = editor.getPageGeometry();
    const gapY = pages[0]!.box.y + pages[0]!.box.height + 1; // just past page 0's bottom
    top = gapY - CONTAINER_HEIGHT / 2;
    expect(editor.getCurrentPage('viewport')).toBe(1);
    editor.destroy();
  });

  test('scrolled past the end it clamps to the last page', () => {
    const editor = editorScrolledBy(() => 100_000);
    expect(editor.getCurrentPage('viewport')).toBe(editor.getTotalPages() - 1);
    editor.destroy();
  });

  test('a host with no scroll container falls back to the carried frame value', () => {
    const editor = createEditor({
      host: {
        getBodyHostEl: () => null,
        getHfHostEl: () => null,
        getPagesContainer: () => null,
        getScrollContainer: () => null,
        scheduleFrame: (cb) => {
          cb();
          return () => {};
        },
      },
      document: writeDocx(createEmptyModel()),
    });
    expect(editor.getCurrentPage('viewport')).toBe(0);
    editor.destroy();
  });

  test("'caret' is a different question and keeps reading the frame", () => {
    const editor = editorScrolledBy(() => 4000);
    expect(editor.getCurrentPage('caret')).toBe(0);
    editor.destroy();
  });
});

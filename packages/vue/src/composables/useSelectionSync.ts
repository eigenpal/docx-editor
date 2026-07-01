/**
 * The caret and selection highlight for the Vue editor.
 *
 * The body's ProseMirror view is off-screen, so the browser's own caret and
 * selection are off-screen with it. Everything the user sees on the page is
 * drawn here: we read the selection out of ProseMirror, ask the painted DOM
 * where those document positions actually landed, and paint rectangles on top.
 *
 * This is the Vue half of a pair — React does the same job in
 * `useSelectionOverlay` / `SelectionOverlay.tsx`. The *geometry* is shared
 * (`readSelectionGeometry`, `getCaretPositionFromDom`, `rectsForSelection` all
 * live in core), so the two adapters can't drift on where a caret goes. What
 * differs is only how the rectangles reach the screen: React renders them as
 * components, and this builds an overlay element directly, because the Vue
 * template has no slot to render them into.
 *
 * It carries the same `data-testid` hooks (`selection-overlay`, `caret`) as
 * React, so a test that pins caret behaviour pins it for both.
 */

import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';

import {
  applyCellSelectionHighlight,
  findBodyPmAnchor,
  getCaretPosition,
  getCaretPositionFromDom,
  readSelectionGeometry,
  resetImeCaretAnchor,
  rectsForSelection,
  syncImeCaretAnchor,
  type DomCaretPosition,
  type DomSelectionBox,
} from '@eigenpal/docx-editor-core/flow-model';
import { applySdtFocus, enclosingSdtGroupIds } from '@eigenpal/docx-editor-core/painter-model';
import type {
  ContentNode,
  LayoutMetrics,
  PageLayout,
} from '@eigenpal/docx-editor-core/pagination-model';

import type { ImageSelectionInfo } from '../components/imageSelectionTypes';

export interface UseSelectionSyncOptions {
  editorView: ShallowRef<EditorView | null> | Ref<EditorView | null>;
  /** The off-screen ProseMirror host — the IME anchor is pinned to it. */
  hiddenContainer: Ref<HTMLElement | null>;
  /** The painted pages. Positions are resolved against this subtree. */
  pagesRef: Ref<HTMLElement | null>;
  zoom: Ref<number>;
  selectedImage: ShallowRef<ImageSelectionInfo | null>;
  /**
   * True while a header/footer holds editing focus. The body caret must be
   * hidden then — two visible carets is worse than none, and the body's would be
   * pointing at a document the user isn't typing into.
   */
  isHfEditing: ComputedRef<boolean>;
  /** True mid image resize/drag: the overlay would fight the gesture. */
  imageInteracting: Ref<boolean>;
  /** A read-only document has no insertion point, so it shows no caret. */
  readOnly: Ref<boolean>;
  /**
   * The composed layout, for the fallback below. Positions are resolved against
   * the painted DOM first, but a page that virtualization hasn't rendered — or
   * the frame before a repaint lands — has no DOM to resolve against, and the
   * caret would simply vanish. Layout math still knows where it goes.
   */
  pageLayout: Ref<PageLayout | null>;
  nodes: Ref<ContentNode[]>;
  metrics: Ref<LayoutMetrics[]>;
}

export interface UseSelectionSyncReturn {
  /** Repaint the caret and highlight from the current editing state. */
  updateSelectionOverlay: () => void;
  /** Take everything down — on blur, on unmount, on entering header/footer edit. */
  clearOverlay: () => void;
}

/** Blink period. Matches the platform caret closely enough not to read as a bug. */
const CARET_BLINK = '1.06s';

export function useSelectionSync(opts: UseSelectionSyncOptions): UseSelectionSyncReturn {
  const overlayRef: ShallowRef<HTMLElement | null> = shallowRef(null);

  /**
   * Whether the body editor holds focus.
   *
   * The real ProseMirror view is off-screen, so no element the user can see ever
   * shows `:focus` — the caret we paint here IS the focus indicator. Painting one
   * in a blurred editor therefore claims that typing goes somewhere it doesn't,
   * and with a header/footer editor also on the page, that claim is actively
   * misleading. This module paints the caret, so this module tracks the focus.
   */
  const isFocused = ref(false);

  onMounted(() => {
    const host = opts.hiddenContainer.value;
    if (!host) return;

    const sync = (focused: boolean) => () => {
      isFocused.value = focused;
      updateSelectionOverlay();
    };
    const onFocusIn = sync(true);
    const onFocusOut = sync(false);

    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);

    onBeforeUnmount(() => {
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
    });
  });

  /**
   * The overlay is a sibling of the painted pages, sharing their coordinate
   * origin — so a rectangle's position is just its offset from the pages box,
   * with no scroll term. It's `pointer-events: none` throughout: it draws the
   * selection, it never intercepts it. A click has to reach the page underneath.
   */
  function ensureOverlay(): HTMLElement | null {
    const pages = opts.pagesRef.value;
    if (!pages?.parentElement) return null;

    if (overlayRef.value?.isConnected) return overlayRef.value;

    const doc = pages.ownerDocument;
    const overlay = doc.createElement('div');
    overlay.dataset.testid = 'selection-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '30';

    const parent = pages.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(overlay);

    overlayRef.value = overlay;
    return overlay;
  }

  function clearOverlay(): void {
    const overlay = overlayRef.value;
    if (overlay) overlay.replaceChildren();
    resetImeCaretAnchor(opts.hiddenContainer.value ?? undefined);
  }

  function paint(boxes: DomSelectionBox[], caret: DomCaretPosition | null): void {
    const overlay = ensureOverlay();
    if (!overlay) return;

    const doc = overlay.ownerDocument;
    const zoom = opts.zoom.value;
    const children: HTMLElement[] = [];

    for (const box of boxes) {
      const rect = doc.createElement('div');
      rect.className = 'ep-selection-rect';
      rect.style.position = 'absolute';
      rect.style.left = `${box.x}px`;
      rect.style.top = `${box.y}px`;
      rect.style.width = `${box.width}px`;
      rect.style.height = `${box.height}px`;
      rect.style.backgroundColor = 'var(--doc-selection, rgba(26, 115, 232, 0.3))';
      rect.style.pointerEvents = 'none';
      children.push(rect);
    }

    if (caret) {
      const el = doc.createElement('div');
      el.dataset.testid = 'caret';
      el.style.position = 'absolute';
      el.style.left = `${caret.x}px`;
      el.style.top = `${caret.y}px`;
      // The caret's height is already in layout px; only its position scales.
      el.style.height = `${caret.height * zoom}px`;
      el.style.width = '2px';
      el.style.backgroundColor = 'var(--doc-caret, #000)';
      el.style.pointerEvents = 'none';
      el.style.animation = `ep-caret-blink ${CARET_BLINK} steps(1) infinite`;
      children.push(el);
    }

    overlay.replaceChildren(...children);
  }

  function updateSelectionOverlay(): void {
    const view = opts.editorView.value;
    const pages = opts.pagesRef.value;
    if (!view || !pages) return;

    const state = view.state;
    const { from, to, empty } = state.selection;

    // Cell shading and content-control focus chrome are painter-owned and don't
    // depend on the overlay existing — do them regardless of what happens below.
    applyCellSelectionHighlight(pages, state);
    applySdtFocus(pages, enclosingSdtGroupIds(state.doc, from, to));

    trackImageSelection(view);

    // The body caret must not paint while a header/footer owns editing, nor while
    // an image gesture is in flight — in both cases the body selection is stale
    // by definition. Nor in a read-only document, which has no insertion point.
    if (opts.isHfEditing.value || opts.imageInteracting.value || opts.readOnly.value) {
      clearOverlay();
      return;
    }

    const overlay = ensureOverlay();
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();

    if (empty) {
      // An unfocused editor still HAS a selection — it just must not advertise
      // one. Drop the caret but keep the highlight logic below reachable.
      if (!isFocused.value) {
        paint([], null);
        return;
      }

      const caret =
        getCaretPositionFromDom(pages, from, overlayRect, opts.zoom.value) ??
        caretFromLayout(from, overlayRect);
      paint([], caret);

      // Anchor the IME composition popup to the *visible* caret. Without this it
      // follows the off-screen ProseMirror view and the candidate window opens
      // 9999px to the left of the page — i.e. nowhere.
      syncImeCaretAnchor({
        hiddenHost: opts.hiddenContainer.value ?? undefined,
        editorView: view,
        visibleCaret: caret
          ? {
              left: overlayRect.left + caret.x,
              top: overlayRect.top + caret.y,
            }
          : undefined,
      });
      return;
    }

    if (!view.composing) {
      resetImeCaretAnchor(opts.hiddenContainer.value ?? undefined);
    }

    const painted = readSelectionGeometry(pages, from, to, overlayRect);
    paint(painted.length > 0 ? painted : rectsFromLayout(from, to, overlayRect), null);
  }

  /**
   * Where the painted pages can't answer, the layout model can.
   *
   * Both fallbacks return coordinates in page-stack space (origin at page 1's
   * top-left), so they are re-based onto the overlay by the offset of the first
   * painted page — the same conversion React does.
   */
  function pageStackOrigin(overlayRect: DOMRect): { x: number; y: number } | null {
    const firstPage = opts.pagesRef.value?.querySelector('.layout-page');
    if (!firstPage) return null;
    const rect = firstPage.getBoundingClientRect();
    return { x: rect.left - overlayRect.left, y: rect.top - overlayRect.top };
  }

  function caretFromLayout(pmPos: number, overlayRect: DOMRect): DomCaretPosition | null {
    const pageLayout = opts.pageLayout.value;
    const origin = pageStackOrigin(overlayRect);
    if (!pageLayout || !origin) return null;

    const caret = getCaretPosition(pageLayout, opts.nodes.value, opts.metrics.value, pmPos);
    if (!caret) return null;

    const zoom = opts.zoom.value;
    return {
      x: origin.x + caret.x * zoom,
      y: origin.y + caret.y * zoom,
      height: caret.height,
      pageIndex: caret.pageIndex,
    };
  }

  function rectsFromLayout(from: number, to: number, overlayRect: DOMRect): DomSelectionBox[] {
    const pageLayout = opts.pageLayout.value;
    const origin = pageStackOrigin(overlayRect);
    if (!pageLayout || !origin) return [];

    const zoom = opts.zoom.value;
    return rectsForSelection(pageLayout, opts.nodes.value, opts.metrics.value, from, to).map(
      (box) => ({
        x: origin.x + box.x * zoom,
        y: origin.y + box.y * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
        pageIndex: box.pageIndex,
      })
    );
  }

  /**
   * A selected image gets a resize overlay rather than a highlight, so the
   * selection sync is also where an image NodeSelection is recognised.
   */
  function trackImageSelection(view: EditorView): void {
    const selection = view.state.selection;
    const pages = opts.pagesRef.value;

    if (!pages || !(selection instanceof NodeSelection) || selection.node.type.name !== 'image') {
      if (!opts.imageInteracting.value) opts.selectedImage.value = null;
      return;
    }

    const anchor = findBodyPmAnchor(pages, selection.from);
    if (!anchor) return;

    const img = anchor.tagName === 'IMG' ? anchor : anchor.querySelector('img');
    const target = (img ?? anchor) as HTMLElement;
    const rect = target.getBoundingClientRect();
    const zoom = opts.zoom.value;

    opts.selectedImage.value = {
      element: target,
      pmPos: selection.from,
      width: Math.round(rect.width / zoom),
      height: Math.round(rect.height / zoom),
    };
  }

  // Zoom rescales every painted rect, so the overlay has to be re-derived — the
  // rects are in layout px and the pages are CSS-scaled underneath them.
  watch(
    () => opts.zoom.value,
    () => updateSelectionOverlay()
  );

  onBeforeUnmount(() => {
    overlayRef.value?.remove();
    overlayRef.value = null;
  });

  return { updateSelectionOverlay, clearOverlay };
}

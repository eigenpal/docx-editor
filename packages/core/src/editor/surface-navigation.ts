// Hyperlink navigation over the painted pages (paginated-surface seam).
//
// THE HOST PAGE NEVER NAVIGATES. Painted links carry a real `href` so they announce as links,
// copy as links and print as links — which also means a browser left to itself would follow
// one and unload the editor, taking every unsaved edit with it. Every click on an anchor
// inside the pages is prevented here, unconditionally and regardless of pointer mode, and
// what happens next is a decision this module makes.
//
// THREE OUTCOMES, and only three:
//
//   internal link  -> scroll to the bookmark and put the caret there. Never leaves the page.
//   external link  -> hand the host a popover request. Ctrl/Cmd+Click activates directly.
//   anything else  -> nothing. A drag that ENDED on a link is a selection, not a click on it;
//                     an inert link (refused scheme, dangling relationship) has no target;
//                     a furniture link in a header is read-only in this slice.
//
// `window.open` is called from ONE place in the whole engine — `openExternal` below — and
// only ever with the sanitized projection, never with an authored target.

import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { sanitizeHref } from '../store/package/sinks.ts';
import type { BookmarkIndex } from '@docx-editor.dev/core/store';
import type { SurfaceHyperlink } from './surface-hyperlinks.ts';

/** A click on a painted link, after native navigation was refused. */
export interface HyperlinkActivation {
  readonly link: SurfaceHyperlink;
  /** The clicked line fragment's viewport rect, so a popover can be placed under it. */
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
    readonly right: number;
  };
}

export interface NavigationDeps {
  readonly pagesLayer: HTMLElement;
  readonly container: HTMLElement;
  readonly scale: () => number;
  readonly layout: () => SemanticLayout;
  readonly bookmarks: () => BookmarkIndex;
  readonly linkById: (linkId: string) => SurfaceHyperlink | null;
  /** Sanitized `a:hlinkClick` on a painted drawing, keyed by drawing node id. */
  readonly drawingLinkById?: (drawingNodeId: string) => SurfaceHyperlink | null;
  readonly setSelection: (position: { paragraphId: string; offset: number }) => void;
  /**
   * Put the surface in the story a jump target is in, before the caret moves there.
   *
   * A bookmark, and now an internal link, can name a paragraph in a header, a footer or a
   * note. Moving the caret there while the scope stayed on the body left the two disagreeing:
   * `activeScope` said body, the caret sat on a paragraph the body store has never heard of,
   * and every keystroke after it was refused with nothing said. Returns false when the story
   * cannot be opened, which is a refusal the caller must honour rather than jump anyway.
   */
  readonly enterStoryFor?: (paragraphId: string) => boolean;
  readonly isCollapsedSelection: () => boolean;
  /** Reconcile virtualization immediately after a programmatic jump. */
  readonly onScrolled?: () => void;
  /**
   * Show the hyperlink popover for an external link. Absent means a plain click on an
   * external link does nothing — which is the honest behaviour for a host that has not
   * mounted a popover, rather than opening a tab the user did not ask for.
   */
  readonly onPopover?: (activation: HyperlinkActivation) => void;
}

/**
 * Moving the caret and the viewport: to a position, to a bookmark, or out to an external target.
 *
 * {@link SurfaceNavigation.openExternal} is THE external-activation call site, and it refuses
 * anything but an already-sanitized href. Routing an authored target through some other path is
 * how a document gets to choose where a click goes.
 */
export interface SurfaceNavigation {
  /** Snap to a semantic position using layout geometry, then place the caret there. */
  goToPosition(position: { paragraphId: string; offset: number }): boolean;
  /**
   * Scroll a bookmark into view and place the caret at it. Answers false for a name no
   * bookmark declares — an inert click, which is what Word does with a dangling anchor.
   */
  goToBookmark(name: string): boolean;
  /**
   * THE external-activation call site. Refuses anything but a sanitized projection, so a
   * caller cannot route an authored target through it by mistake.
   */
  openExternal(href: string | null): boolean;
  destroy(): void;
}

/** How much room to leave above a jump target, so it does not land flush against the edge. */
const JUMP_MARGIN_PX = 24;

export function createSurfaceNavigation(deps: NavigationDeps): SurfaceNavigation {
  const { pagesLayer } = deps;
  const view = pagesLayer.ownerDocument.defaultView;

  /** The scroll container this surface sits in, looked up live (chrome can mount later). */
  function scroller(): HTMLElement | null {
    return deps.container.closest('.docx-editor__scroll-container');
  }

  const openExternal = (href: string | null): boolean => {
    if (!href || href.length === 0 || href.startsWith('#')) return false;
    const projection = sanitizeHref(href);
    if (!projection.ok || !projection.href) return false;
    if (!view) return false;
    // `noopener` is what stops the opened page reaching back through `window.opener` into
    // the editor; `noreferrer` keeps the document's own URL out of the request.
    view.open(projection.href, '_blank', 'noopener,noreferrer');
    return true;
  };

  const goToPosition = (position: { paragraphId: string; offset: number }): boolean => {
    // Geometry from the LAYOUT, not the DOM. The target of a cross-document jump is normally
    // on a virtualized page with no DOM at all, so `scrollIntoView` would resolve exactly the
    // jumps that did not need it and fail every one that did.
    // BEFORE the geometry is read: entering re-scopes the layout this resolves against, so
    // doing it afterwards would measure the target against the story the reader was leaving.
    if (deps.enterStoryFor && !deps.enterStoryFor(position.paragraphId)) return false;
    const layout = deps.layout();
    const caret = caretAt(layout, position);
    if (!caret) return false;
    const page = layout.pages[caret.pageIndex];
    if (!page) return false;

    // The caret is published in PAGE-CONTENT coordinates; the scroll container measures the
    // whole sheet stack, so the page's own origin has to be added back.
    const sheetY = page.box.y + (page.contentBox.y - page.box.y) + caret.y;
    const element = scroller();
    if (element) {
      element.scrollTop = Math.max(0, sheetY * deps.scale() - JUMP_MARGIN_PX);
      deps.onScrolled?.();
    }
    // The caret moves whether or not there was anywhere to scroll: the jump's POINT is that
    // the user is now editing at the target, and a document short enough to need no scroll
    // must still move the caret.
    deps.setSelection(position);
    return true;
  };

  const goToBookmark = (name: string): boolean => {
    const anchor = deps.bookmarks().get(name);
    return anchor ? goToPosition(anchor) : false;
  };

  /**
   * The link under the pointer at PRESS time, and where it was.
   *
   * A press on the surface commits a selection, and a commit can repaint the pages — which
   * detaches the very span the press landed on. The browser then has no live target to
   * compute the `click` event from and reports the nearest surviving ancestor, the pages
   * layer: the click arrived with every trace of the link gone from it. Remembering what was
   * under the pointer before any of that happens is the only reading that survives a
   * repaint, and it is the reading the user meant.
   */
  let pressed: {
    readonly linkId: string;
    readonly rect: HyperlinkActivation['rect'];
    readonly drawing: boolean;
  } | null = null;

  function linkTargetFrom(element: HTMLElement | null): {
    readonly linkId: string;
    readonly drawing: boolean;
  } | null {
    if (!element || element.closest('[data-docx-hf]')) return null;
    const anchor = element.closest('a.docx-hyperlink') as HTMLElement | null;
    if (anchor) {
      const linkId = anchor.dataset.docxLink;
      return linkId ? { linkId, drawing: false } : null;
    }
    const drawingEl = element.closest('[data-docx-drawing-link]') as HTMLElement | null;
    if (drawingEl) {
      const linkId = drawingEl.dataset.docxDrawingLink;
      return linkId ? { linkId, drawing: true } : null;
    }
    return null;
  }

  const onPointerDown = (event: PointerEvent): void => {
    pressed = null;
    const target = event.target as Element | null;
    const resolved = linkTargetFrom(target as HTMLElement | null);
    if (!resolved) return;
    const rectHost = (target as Element).closest(
      '[data-docx-drawing-link], a.docx-hyperlink'
    ) as HTMLElement;
    const rect = rectHost.getBoundingClientRect();
    pressed = {
      linkId: resolved.linkId,
      drawing: resolved.drawing,
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
    };
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const live = linkTargetFrom(target as HTMLElement | null);
    if (!live) {
      const remembered = pressed;
      pressed = null;
      if (!remembered) return;
      event.preventDefault();
      classify(remembered.linkId, remembered.rect, event, remembered.drawing);
      return;
    }
    pressed = null;
    event.preventDefault();
    const rectHost = (target as Element).closest(
      '[data-docx-drawing-link], a.docx-hyperlink'
    ) as HTMLElement;
    const rect = rectHost.getBoundingClientRect();
    classify(
      live.linkId,
      { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
      event,
      live.drawing
    );
  };

  /** What a click on `linkId` means, once the link and its position are known. */
  function classify(
    linkId: string,
    rect: HyperlinkActivation['rect'],
    event: MouseEvent,
    drawing: boolean
  ): void {
    const link = drawing ? (deps.drawingLinkById?.(linkId) ?? null) : deps.linkById(linkId);
    if (!link) return;

    const accel = event.metaKey || event.ctrlKey;
    // Ctrl/Cmd+Click follows Word: open now, no popover. Through the same single gate.
    if (accel) {
      if (link.kind === 'external') openExternal(link.href);
      else if (link.anchor) goToBookmark(link.anchor);
      return;
    }
    // A click that ended a DRAG is a selection, not an activation. Popping a panel over the
    // text someone just selected is the most annoying possible response to that gesture.
    if (!deps.isCollapsedSelection()) return;

    if (link.kind === 'internal') {
      if (link.anchor) goToBookmark(link.anchor);
      return;
    }
    // External and unresolved both go to the popover: an inert link is still a link the user
    // may want to see, fix or remove, and the popover is where those live. What it must not
    // do is open — which `openExternal` refuses for a null href regardless.
    deps.onPopover?.({ link, rect });
  }

  // Capture phase on the press: the surface's own pointerdown handler prevents the
  // default and commits a selection, and this must read the DOM before any of that.
  pagesLayer.addEventListener('pointerdown', onPointerDown, true);
  pagesLayer.addEventListener('click', onClick);

  return {
    goToPosition,
    goToBookmark,
    openExternal,
    destroy() {
      pagesLayer.removeEventListener('pointerdown', onPointerDown, true);
      pagesLayer.removeEventListener('click', onClick);
    },
  };
}

/**
 * Scroll-API hook for PagedEditor.
 *
 * Provides the three scroll-to-target implementations exposed on
 * `PagedEditorRef`: by PM position, by paraId, by page number.
 *
 * The `scrollAbortRef` AbortController is shared across all in-flight
 * scroll chains. Aborted on unmount or whenever a fresh scroll
 * supersedes the previous one — prevents a stale paint-settle from
 * stomping the latest target a few frames later, and avoids writing
 * scrollTop on a detached scroller.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  findBodyPmAnchor,
  collectBodySpans,
  getCaretPosition,
} from '@eigenpal/docx-editor-core/layout-bridge';
import { findPageIndexContainingPmPos } from '@eigenpal/docx-editor-core/layout-engine';
import type { FlowBlock, Layout, Measure } from '@eigenpal/docx-editor-core/layout-engine';
import { findStartPosForParaId } from '@eigenpal/docx-editor-core/prosemirror';
import { findVerticalScrollParentOrRoot } from '@eigenpal/docx-editor-core/utils/findVerticalScrollParent';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import { runAfterPaint, scrollElementCenterIntoContainer } from '../internals/scrollUtils';

export interface UsePagedScrollApiOptions {
  layout: Layout | null;
  blocks: FlowBlock[];
  measures: Measure[];
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  getScrollContainer: () => HTMLDivElement | null;
}

export interface UsePagedScrollApiReturn {
  scrollToPositionImpl: (pmPos: number, forParaIdScroll?: boolean) => void;
  scrollToPageImpl: (pageNumber: number) => void;
  scrollToParaIdImpl: (paraId: string) => boolean;
}

export function usePagedScrollApi(opts: UsePagedScrollApiOptions): UsePagedScrollApiReturn {
  const { layout, blocks, measures, pagesContainerRef, hiddenPMRef, getScrollContainer } = opts;

  const scrollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      scrollAbortRef.current?.abort();
      scrollAbortRef.current = null;
    };
  }, []);

  /**
   * Scroll pages to a ProseMirror position (handles virtualization via page shells).
   * @param forParaIdScroll — when true, use manual container scroll (reliable
   *   under CSS transform / zoom). Otherwise use `scrollIntoView` (legacy
   *   behavior for outline, bookmarks, etc.).
   */
  const scrollToPositionImpl = useCallback(
    (pmPos: number, forParaIdScroll = false) => {
      // Reject malformed input — pmPos must be a non-negative integer.
      // Without this, a string or float would be interpolated into the
      // [data-doc-from="..."] selector and either crash with SyntaxError
      // or escape the attribute (selector injection).
      if (!Number.isInteger(pmPos) || pmPos < 0) return;

      const pages = pagesContainerRef.current;
      if (!pages) return;

      // Abort any in-flight scroll's rAF chain — its paint-settle would
      // otherwise stomp on this fresh scroll target a few frames later.
      scrollAbortRef.current?.abort();
      const ac = new AbortController();
      scrollAbortRef.current = ac;
      const { signal } = ac;

      const queryPaintedPositionEl = (): HTMLElement | null => {
        const exact = findBodyPmAnchor(pages, pmPos);
        if (exact) return exact;

        for (const span of collectBodySpans(pages)) {
          const start = Number(span.dataset.docFrom);
          const end = Number(span.dataset.docTo);
          if (Number.isFinite(start) && Number.isFinite(end) && pmPos >= start && pmPos <= end) {
            return span;
          }
        }

        return null;
      };

      if (!forParaIdScroll) {
        // Smooth scroll preserves the legacy UX for outline / bookmark /
        // hyperlink / find-replace navigation. The paraId path uses an
        // instant manual scroll instead because smooth fights the layout
        // restore that runs during virtualized paint.
        const smoothScroll: ScrollIntoViewOptions = {
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        };
        const targetEl = queryPaintedPositionEl();
        if (targetEl) {
          targetEl.scrollIntoView(smoothScroll);
          return;
        }
        const lay = layout;
        const blk = blocks;
        const meas = measures;
        if (!lay || blk.length === 0 || meas.length !== blk.length) return;

        let pageIndex: number | null = null;
        const caret = getCaretPosition(lay, blk, meas, pmPos);
        if (caret) {
          pageIndex = caret.pageIndex;
        } else {
          pageIndex = findPageIndexContainingPmPos(lay, pmPos);
        }
        if (pageIndex == null) return;

        const pageShells = pages.querySelectorAll<HTMLElement>('.layout-page');
        const shell = pageShells[pageIndex];
        if (!shell) return;

        shell.scrollIntoView(smoothScroll);
        runAfterPaint(() => {
          if (!pages.isConnected) return;
          const painted = queryPaintedPositionEl();
          if (painted) painted.scrollIntoView(smoothScroll);
        }, signal);
        return;
      }

      const scroller = getScrollContainer() ?? findVerticalScrollParentOrRoot(pages);

      const scrollPaintedTargetInstant = (): boolean => {
        const targetEl = queryPaintedPositionEl();
        if (!targetEl) return false;
        scrollElementCenterIntoContainer(targetEl, scroller, 'instant');
        return true;
      };

      if (scrollPaintedTargetInstant()) return;

      const lay = layout;
      const blk = blocks;
      const meas = measures;
      if (!lay || blk.length === 0 || meas.length !== blk.length) return;

      let pageIndex: number | null = null;
      const caret = getCaretPosition(lay, blk, meas, pmPos);
      if (caret) {
        pageIndex = caret.pageIndex;
      } else {
        pageIndex = findPageIndexContainingPmPos(lay, pmPos);
      }
      if (pageIndex == null) return;

      const pageShells = pages.querySelectorAll<HTMLElement>('.layout-page');
      const shell = pageShells[pageIndex];
      if (!shell) return;

      // Long jump / virtualization: instant only — smooth fights layout/scroll restore.
      scrollElementCenterIntoContainer(shell, scroller, 'instant');

      runAfterPaint(() => {
        if (!pages.isConnected) return;
        const painted = queryPaintedPositionEl();
        if (painted) {
          scrollElementCenterIntoContainer(painted, scroller, 'instant');
        } else {
          scrollPaintedTargetInstant();
        }
      }, signal);
    },
    [layout, blocks, measures, getScrollContainer, pagesContainerRef]
  );

  // 1-indexed pageNumber. Prefers scrolling to the page's first PM-anchored
  // fragment so virtualization is handled by scrollToPositionImpl. Falls back
  // to the page shell directly when no fragment carries docFrom (e.g. a page
  // containing only a continuation of a long paragraph or a floating image
  // without a PM anchor).
  const scrollToPageImpl = useCallback(
    (pageNumber: number): void => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
      if (!layout || pageNumber > layout.pages.length) return;
      const page = layout.pages[pageNumber - 1];
      for (const frag of page.fragments) {
        if (typeof frag.docFrom === 'number') {
          scrollToPositionImpl(frag.docFrom, true);
          return;
        }
      }
      const shell =
        pagesContainerRef.current?.querySelectorAll<HTMLElement>('.layout-page')[pageNumber - 1];
      shell?.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    [layout, scrollToPositionImpl, pagesContainerRef]
  );

  const scrollToParaIdImpl = useCallback(
    (paraId: string): boolean => {
      const state = hiddenPMRef.current?.getState();
      if (!state) return false;
      const startPos = findStartPosForParaId(state.doc, paraId);
      if (startPos == null || startPos < 0) return false;
      scrollToPositionImpl(startPos, true);
      // Defer selection/focus until after the scroll's paint-settle rAF
      // chain runs. Setting selection synchronously on a virtualized
      // (unpainted) target triggers a layout/scroll-restore cycle that
      // fights the in-flight scroll. Reuses the same AbortController so a
      // superseding scroll cancels this too.
      const signal = scrollAbortRef.current?.signal;
      if (!signal) return true;
      const targetNode = state.doc.nodeAt(startPos);
      const inner =
        targetNode?.isTextblock === true
          ? Math.min(startPos + 1 + targetNode.content.size, state.doc.content.size)
          : Math.min(startPos + 1, state.doc.content.size);
      runAfterPaint(() => {
        if (!hiddenPMRef.current) return;
        hiddenPMRef.current.setSelection(inner);
        hiddenPMRef.current.focus();
      }, signal);
      return true;
    },
    [scrollToPositionImpl, hiddenPMRef]
  );

  return {
    scrollToPositionImpl,
    scrollToPageImpl,
    scrollToParaIdImpl,
  };
}

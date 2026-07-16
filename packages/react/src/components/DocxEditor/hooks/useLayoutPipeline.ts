/**
 * Layout pipeline hook for PagedEditor.
 *
 * Owns the 4-step layout pass (PM doc → content nodes → metrics → page layout →
 * paint), its rAF-coalesced scheduler, and the scroll-restore state that
 * keeps the user's scroll position locked across re-paints.
 *
 * Extraction note: every line of `runLayoutPipeline` moves in here
 * verbatim. The ContentNode invariant (`assertExhaustiveContentNode` in the
 * `buildBoxTree` chain via `measureBlock.ts`) depends on this site staying
 * stable — if a new ContentNode variant is added, the three measureBlock
 * switches still need updates per the CLAUDE.md invariant.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from 'prosemirror-state';

import type {
  ContentNode,
  LayoutMetrics,
  PageLayout,
} from '@docx-editor.dev/core/pagination-model';
import {
  getColumns,
  getMargins,
  getPageSize,
  getVisualScrollHeight,
} from '@docx-editor.dev/core/flow-model';
import type { Node as PMNode } from 'prosemirror-model';
import {
  LayoutPainter,
  paintPages,
  indexNodesById,
  type NodeLookup,
  type FootnoteRenderItem,
  type RenderPageOptions,
} from '@docx-editor.dev/core/painter-model';
import {
  computeLayout,
  createLayoutScheduler,
  type LayoutScheduler,
} from '@docx-editor.dev/core/editor';
import { findVerticalScrollParentOrRoot } from '@docx-editor.dev/core/utils/findVerticalScrollParent';
import type {
  Document,
  HeaderFooter,
  SectionProperties,
  StyleDefinitions,
  Theme,
} from '@docx-editor.dev/core/types/document';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import { computeAnchorPositions } from '../internals/sidebarAnchorPositions';
import { measureBlocks } from '../internals/measureBlock';
import { createRenderedDomContext } from '../../../plugin-api/RenderedDomContext';
import type { RenderedDomContext } from '../../../plugin-api/types';
import { viewportMinHeightPx } from '../internals/scrollUtils';
import {
  applyScrollRestore,
  buildPendingScrollRestore,
  captureScrollAnchor,
  reclampIncrementalSnapshot,
  type PendingScrollRestore,
} from '../internals/scrollRestore';
import {
  createPaintedPagesGuard,
  type PaintedPagesGuard,
} from '@docx-editor.dev/core/internal/paintedPagesGuard';
import { usePaintedPagesGuardLifecycle } from './usePaintedPagesGuardLifecycle';

export interface UseLayoutPipelineOptions {
  document: Document | null;
  styles?: StyleDefinitions | null;
  theme?: Theme | null;
  sectionProperties?: SectionProperties | null;
  finalSectionProperties?: SectionProperties | null;
  headerContent?: HeaderFooter | null;
  footerContent?: HeaderFooter | null;
  firstPageHeaderContent?: HeaderFooter | null;
  firstPageFooterContent?: HeaderFooter | null;
  /**
   * Resolve the current PM document for an HF instance, when a persistent
   * hidden PM EditorView exists for it. Phase 1 of the HF unification
   * (openspec/changes/unify-hf-editing/) — the painter prefers the PM
   * doc over re-parsing `HeaderFooter.content` so future phases that
   * dispatch edits into the PM are picked up automatically. Returns null
   * for HF instances without a mounted PM (boot, or rId not yet projected).
   */
  getHfPmDoc?: (hf: HeaderFooter) => PMNode | null;
  pageGap: number;
  zoom: number;
  resolvedCommentIds?: Set<number>;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  viewportLayoutRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  getScrollContainer: () => HTMLDivElement | null;
  onTotalPagesChange?: (totalPages: number) => void;
  onAnchorPositionsChange?: (positions: Map<string, number>) => void;
  onRenderedDomContextReady?: (context: RenderedDomContext) => void;
  onPaintedPagesReady: () => void;
}

export interface UseLayoutPipelineReturn {
  pageLayout: PageLayout | null;
  nodes: ContentNode[];
  metrics: LayoutMetrics[];
  decorationSyncToken: number;
  notifyDecorationLayer: () => void;
  contentWidth: number;
  runLayoutPipeline: (state: EditorState) => void;
  scheduleLayout: (state: EditorState) => void;
  markPaintedPagesStale: () => void;
  requestPaintedOverlayRefresh: () => void;
  paintedPagesAreCurrent: () => boolean;
}

export function useLayoutPipeline(opts: UseLayoutPipelineOptions): UseLayoutPipelineReturn {
  const {
    document,
    styles,
    theme,
    sectionProperties,
    finalSectionProperties,
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
    getHfPmDoc,
    pageGap,
    zoom,
    resolvedCommentIds,
    pagesContainerRef,
    viewportLayoutRef,
    hiddenPMRef,
    getScrollContainer,
    onTotalPagesChange,
    onAnchorPositionsChange,
    onRenderedDomContextReady,
    onPaintedPagesReady,
  } = opts;

  const [pageLayout, setPageLayout] = useState<PageLayout | null>(null);
  const [nodes, setNodes] = useState<ContentNode[]>([]);
  const [metrics, setMetrics] = useState<LayoutMetrics[]>([]);
  // Monotonic token bumped on every PM transaction (doc, selection,
  // meta-only). Drives the DecorationLayer's resync so plugins like
  // yCursorPlugin (which update decorations on awareness pings — non-doc
  // transactions) propagate. Only `notifyDecorationLayer` writes to it.
  const [decorationSyncToken, setDecorationSyncToken] = useState(0);
  const notifyDecorationLayer = useCallback(() => setDecorationSyncToken((v) => v + 1), []);

  // Callback refs — parent may hand in a fresh closure every render. Mirroring
  // these in refs keeps `runLayoutPipeline`'s dep array stable; otherwise
  // every parent re-render would invalidate the rAF-coalesced scheduler.
  const onTotalPagesChangeRef = useRef(onTotalPagesChange);
  const onAnchorPositionsChangeRef = useRef(onAnchorPositionsChange);
  const onRenderedDomContextReadyRef = useRef(onRenderedDomContextReady);
  const onPaintedPagesReadyRef = useRef(onPaintedPagesReady);
  const getHfPmDocRef = useRef(getHfPmDoc);
  onTotalPagesChangeRef.current = onTotalPagesChange;
  onAnchorPositionsChangeRef.current = onAnchorPositionsChange;
  onRenderedDomContextReadyRef.current = onRenderedDomContextReady;
  onPaintedPagesReadyRef.current = onPaintedPagesReady;
  getHfPmDocRef.current = getHfPmDoc;

  const paintedPagesGuardRef = useRef<PaintedPagesGuard | null>(null);
  if (!paintedPagesGuardRef.current) {
    paintedPagesGuardRef.current = createPaintedPagesGuard(() => onPaintedPagesReadyRef.current());
  }
  usePaintedPagesGuardLifecycle(paintedPagesGuardRef.current);
  const successfulPaintRef = useRef<ReturnType<PaintedPagesGuard['startPaint']> | null>(null);
  const paintingPagesRef = useRef(false);

  // Total-pages notifier — fires only when count changes (including N → 0).
  const lastTotalPagesRef = useRef<number>(0);
  useEffect(() => {
    const total = pageLayout?.pages.length ?? 0;
    if (total === lastTotalPagesRef.current) return;
    lastTotalPagesRef.current = total;
    onTotalPagesChangeRef.current?.(total);
  }, [pageLayout]);

  // Page geometry derived from section properties.
  const pageSize = useMemo(() => getPageSize(sectionProperties), [sectionProperties]);
  const margins = useMemo(() => getMargins(sectionProperties), [sectionProperties]);
  const columns = useMemo(() => getColumns(sectionProperties), [sectionProperties]);
  const { finalPageSize, finalMargins, finalColumns } = useMemo(() => {
    const props = finalSectionProperties ?? sectionProperties;
    return {
      finalPageSize: getPageSize(props),
      finalMargins: getMargins(props),
      finalColumns: getColumns(props),
    };
  }, [finalSectionProperties, sectionProperties]);
  const contentWidth = pageSize.w - margins.left - margins.right;

  // Painter: shared singleton scoped to this hook instance.
  const painter = useMemo(
    () =>
      new LayoutPainter({
        pageGap,
        showShadow: true,
        pageBackground: 'var(--doc-page-bg, #ffffff)',
      }),
    [pageGap]
  );
  const painterRef = useRef<LayoutPainter | null>(null);
  painterRef.current = painter;

  // Scroll-restore plumbing. `pendingScrollRestoreRef` is read by both the
  // pipeline and the post-commit useLayoutEffect below.
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);
  const pendingIncrementalScrollSnapshotWrittenAtRef = useRef(0);

  // =========================================================================
  // Layout Pipeline
  // =========================================================================

  const runLayoutPipeline = useCallback(
    (state: EditorState) => {
      const pipelineStart = performance.now();

      const applyPendingIncrementalScrollSnapshot = (onlyIfSnapshotJustWritten: boolean) => {
        const pe0 = pagesContainerRef.current;
        const sp0 = pe0 ? (getScrollContainer() ?? findVerticalScrollParentOrRoot(pe0)) : null;
        const age = performance.now() - pendingIncrementalScrollSnapshotWrittenAtRef.current;
        reclampIncrementalSnapshot(
          pendingScrollRestoreRef.current,
          sp0,
          age,
          onlyIfSnapshotJustWritten
        );
      };
      applyPendingIncrementalScrollSnapshot(true);

      try {
        // Steps 1-3 (PM doc → nodes → metrics → HF resolve → margin extend →
        // page layout → footnote items) are the shared compute pass, lifted to
        // `@docx-editor.dev/core/editor`. Paint + scroll/events stay here.
        const {
          nodes: newNodes,
          metrics: newMetrics,
          layout: newPageLayout,
          headerContentForRender,
          footerContentForRender,
          firstPageHeaderForRender,
          firstPageFooterForRender,
          hasTitlePg,
          watermark,
          headerDistancePx,
          footerDistancePx,
          pageBorders,
          footnotesByPage,
        } = computeLayout({
          state,
          document,
          pageSize,
          margins,
          columns,
          finalPageSize,
          finalMargins,
          finalColumns,
          pageGap,
          contentWidth,
          theme,
          styles,
          sectionProperties,
          finalSectionProperties,
          headerContent,
          footerContent,
          firstPageHeaderContent,
          firstPageFooterContent,
          measureBlocks,
          getHfPmDoc: (hf) => getHfPmDocRef.current?.(hf) ?? null,
        });
        setNodes(newNodes);
        setMetrics(newMetrics);
        setPageLayout(newPageLayout);

        // Step 4: Paint to DOM
        if (pagesContainerRef.current && painterRef.current) {
          pendingScrollRestoreRef.current = null;
          pendingIncrementalScrollSnapshotWrittenAtRef.current = 0;

          const pagesEl = pagesContainerRef.current;
          const scrollParent = getScrollContainer() ?? findVerticalScrollParentOrRoot(pagesEl);
          const anchor = scrollParent?.isConnected
            ? captureScrollAnchor(pagesEl, scrollParent, state.selection.head)
            : null;

          const nodeLookup = indexNodesById(newNodes, newMetrics);
          painterRef.current.setNodeLookup(nodeLookup);

          pagesEl.dataset.overlayPagesCurrent = 'false';
          const paintTicket = paintedPagesGuardRef.current!.startPaint();
          let paintPagesKind: ReturnType<typeof paintPages>;
          paintingPagesRef.current = true;
          try {
            paintPagesKind = paintPages(newPageLayout.pages, pagesContainerRef.current, {
              pageGap,
              showShadow: true,
              pageBackground: 'var(--doc-page-bg, #ffffff)',
              nodeLookup,
              headerContent: headerContentForRender,
              footerContent: footerContentForRender,
              firstPageHeaderContent: firstPageHeaderForRender,
              firstPageFooterContent: firstPageFooterForRender,
              titlePg: hasTitlePg,
              headerDistance: headerDistancePx,
              footerDistance: footerDistancePx,
              pageBorders,
              theme,
              watermark,
              footnotesByPage,
              resolvedCommentIds,
            } as RenderPageOptions & {
              pageGap?: number;
              nodeLookup?: NodeLookup;
              footnotesByPage?: Map<number, FootnoteRenderItem[]>;
            });
            successfulPaintRef.current = paintTicket;
          } catch (error) {
            paintedPagesGuardRef.current!.abandonPaint(paintTicket);
            throw error;
          } finally {
            paintingPagesRef.current = false;
          }

          const vp = viewportLayoutRef.current;
          if (vp) {
            const mh = viewportMinHeightPx(newPageLayout, pageGap);
            const visualHeight = getVisualScrollHeight(mh, zoom);
            vp.style.height = `${visualHeight}px`;
            vp.style.minHeight = `${visualHeight}px`;
            vp.style.marginBottom = '';
          }

          if (scrollParent?.isConnected && anchor) {
            const pending = buildPendingScrollRestore(paintPagesKind, scrollParent, anchor);
            pendingScrollRestoreRef.current = pending;
            if (pending.renderKind === 'incremental' && pending.scrollTopSnapshot != null) {
              pendingIncrementalScrollSnapshotWrittenAtRef.current = performance.now();
            }
          }

          if (onRenderedDomContextReadyRef.current) {
            const domContext = createRenderedDomContext(pagesContainerRef.current, zoom);
            onRenderedDomContextReadyRef.current(domContext);
          }
        } else {
          pendingScrollRestoreRef.current = null;
          pendingIncrementalScrollSnapshotWrittenAtRef.current = 0;
        }

        if (onAnchorPositionsChangeRef.current) {
          const positions = computeAnchorPositions(
            hiddenPMRef.current?.getView() ?? null,
            newPageLayout,
            newNodes,
            newMetrics,
            pageGap
          );

          const pagesEl = pagesContainerRef.current;
          if (pagesEl) {
            const hfContainers = pagesEl.querySelectorAll(
              '.layout-page-header, .layout-page-footer'
            );
            if (hfContainers.length > 0) {
              const pagesElRect = pagesEl.getBoundingClientRect();
              const currentZoom = zoom || 1;
              for (let i = 0; i < hfContainers.length; i++) {
                const hf = hfContainers[i] as HTMLElement;
                // Query insertions
                const insertions = hf.querySelectorAll('.docx-insertion[data-revision-id]');
                for (let j = 0; j < insertions.length; j++) {
                  const el = insertions[j] as HTMLElement;
                  const rId = el.getAttribute('data-revision-id');
                  if (rId && !positions.has(`revision-${rId}`)) {
                    const rect = el.getBoundingClientRect();
                    const y = (rect.top - pagesElRect.top + pagesEl.scrollTop) / currentZoom;
                    positions.set(`revision-${rId}`, y);
                  }
                }
                // Query deletions
                const deletions = hf.querySelectorAll('.docx-deletion[data-revision-id]');
                for (let j = 0; j < deletions.length; j++) {
                  const el = deletions[j] as HTMLElement;
                  const rId = el.getAttribute('data-revision-id');
                  if (rId && !positions.has(`revision-${rId}`)) {
                    const rect = el.getBoundingClientRect();
                    const y = (rect.top - pagesElRect.top + pagesEl.scrollTop) / currentZoom;
                    positions.set(`revision-${rId}`, y);
                  }
                }
                // Query comments
                const comments = hf.querySelectorAll('[data-comment-id]');
                for (let j = 0; j < comments.length; j++) {
                  const el = comments[j] as HTMLElement;
                  const commentId = el.getAttribute('data-comment-id');
                  if (commentId && !positions.has(`comment-${commentId}`)) {
                    const rect = el.getBoundingClientRect();
                    const y = (rect.top - pagesElRect.top + pagesEl.scrollTop) / currentZoom;
                    positions.set(`comment-${commentId}`, y);
                  }
                }
                // Query structural revisions
                const structural = hf.querySelectorAll(
                  '.ep-revision-table[data-revision-id], ' +
                    '.ep-revision-row[data-revision-id], ' +
                    '.ep-revision-cell[data-revision-id], ' +
                    '.layout-revision-pmark[data-revision-id]'
                );
                for (let j = 0; j < structural.length; j++) {
                  const el = structural[j] as HTMLElement;
                  const rId = el.getAttribute('data-revision-id');
                  if (rId && !positions.has(`revision-${rId}`)) {
                    const rect = el.getBoundingClientRect();
                    const y = (rect.top - pagesElRect.top + pagesEl.scrollTop) / currentZoom;
                    positions.set(`revision-${rId}`, y);
                  }
                }
              }
            }
          }

          onAnchorPositionsChangeRef.current(positions);
        }

        applyPendingIncrementalScrollSnapshot(false);

        const totalTime = performance.now() - pipelineStart;
        if (totalTime > 2000) {
          console.warn(
            `[PagedEditor] Layout pipeline took ${Math.round(totalTime)}ms total ` +
              `(${newNodes.length} nodes, ${newMetrics.length} metrics)`
          );
        }
      } catch (error) {
        console.error('[PagedEditor] Layout pipeline error:', error);
      }

      applyPendingIncrementalScrollSnapshot(false);
    },
    [
      contentWidth,
      columns,
      pageSize,
      margins,
      finalPageSize,
      finalMargins,
      finalColumns,
      pageGap,
      zoom,
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
      // `getHfPmDoc` is read through a ref in the pipeline so identity
      // changes don't re-trigger the layout effect every render.
      sectionProperties,
      finalSectionProperties,
      document,
      resolvedCommentIds,
      getScrollContainer,
      hiddenPMRef,
      pagesContainerRef,
      styles,
      theme,
      viewportLayoutRef,
    ]
  );

  // After `setLayout`, React still commits `totalHeight` / margin on the viewport wrapper.
  // Restoring scroll here (plus one rAF) matches the committed DOM scrollHeight.
  useLayoutEffect(() => {
    const successfulPaint = successfulPaintRef.current;
    successfulPaintRef.current = null;
    if (successfulPaint) {
      const pagesCurrent = paintedPagesGuardRef.current?.finishPaint(successfulPaint) ?? false;
      if (pagesCurrent && pagesContainerRef.current) {
        pagesContainerRef.current.dataset.overlayPagesCurrent = 'true';
      }
    }

    const pending = pendingScrollRestoreRef.current;
    if (!pending) return;
    pendingScrollRestoreRef.current = null;
    pendingIncrementalScrollSnapshotWrittenAtRef.current = 0;

    const pagesEl = pagesContainerRef.current;
    const scrollParent =
      getScrollContainer() ?? (pagesEl ? findVerticalScrollParentOrRoot(pagesEl) : null);
    if (!pagesEl || !scrollParent?.isConnected) return;

    applyScrollRestore(pending, pagesEl, scrollParent);
    const rafId = requestAnimationFrame(() => {
      // scrollParent may be detached after unmount or another layout commit.
      if (!scrollParent.isConnected) return;
      applyScrollRestore(pending, pagesEl, scrollParent);
    });
    return () => cancelAnimationFrame(rafId);
  }, [pageLayout, getScrollContainer, pagesContainerRef]);

  // Virtualization can populate a shell without running the full layout hook.
  // Route that painter signal through the same readiness guard before any
  // selection, caret, or decoration geometry reads the new DOM.
  useEffect(() => {
    const pages = pagesContainerRef.current;
    if (!pages) return;
    const onPainted = () => {
      if (!paintingPagesRef.current) {
        paintedPagesGuardRef.current?.requestOverlayRefresh();
      }
    };
    pages.addEventListener('painter:painted', onPainted);
    pages.addEventListener('docx-editor-react:request-overlay-refresh', onPainted);
    return () => {
      pages.removeEventListener('painter:painted', onPainted);
      pages.removeEventListener('docx-editor-react:request-overlay-refresh', onPainted);
    };
  }, [pagesContainerRef]);

  // =========================================================================
  // Coalesced Layout (rAF throttle)
  // =========================================================================

  /**
   * Multiple rapid transactions (e.g. typing "hello") within the same frame
   * are coalesced so only the final state triggers a full layout pass. The
   * coalescer lives in core (`createLayoutScheduler`) so React and Vue share
   * it; the `runRef` indirection lets the stable scheduler always call the
   * latest `runLayoutPipeline` without recreating itself.
   */
  const runRef = useRef(runLayoutPipeline);
  runRef.current = runLayoutPipeline;
  const schedulerRef = useRef<LayoutScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createLayoutScheduler((state) => runRef.current(state));
  }

  const scheduleLayout = useCallback((state: EditorState) => {
    schedulerRef.current!.schedule(state);
  }, []);
  const markPaintedPagesStale = useCallback(() => {
    if (pagesContainerRef.current) {
      pagesContainerRef.current.dataset.overlayPagesCurrent = 'false';
    }
    paintedPagesGuardRef.current!.noteDocumentChange();
  }, [pagesContainerRef]);
  const requestPaintedOverlayRefresh = useCallback(() => {
    paintedPagesGuardRef.current!.requestOverlayRefresh();
  }, []);
  const paintedPagesAreCurrent = useCallback(
    () => paintedPagesGuardRef.current?.pagesAreCurrent() ?? false,
    []
  );

  // Clean up pending rAF on unmount. Guard disposal/revival lives in a parent
  // layout effect so Strict Effects cannot leave child passive setup disposed.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler?.cancel();
  }, []);

  return {
    pageLayout,
    nodes,
    metrics,
    decorationSyncToken,
    notifyDecorationLayer,
    contentWidth,
    runLayoutPipeline,
    scheduleLayout,
    markPaintedPagesStale,
    requestPaintedOverlayRefresh,
    paintedPagesAreCurrent,
  };
}

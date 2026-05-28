/**
 * Layout pipeline hook for PagedEditor.
 *
 * Owns the 4-step layout pass (PM doc → flow blocks → measure → layout →
 * paint), its rAF-coalesced scheduler, and the scroll-restore state that
 * keeps the user's scroll position locked across re-paints.
 *
 * Extraction note: every line of `runLayoutPipeline` moves in here
 * verbatim. The FlowBlock invariant (`assertExhaustiveFlowBlock` in the
 * `buildBoxTree` chain via `measureBlock.ts`) depends on this site staying
 * stable — if a new FlowBlock variant is added, the three measureBlock
 * switches still need updates per the CLAUDE.md invariant.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from 'prosemirror-state';

import {
  layOutPages,
  type FlowBlock,
  type FootnoteContent,
  type Layout,
  type Measure,
  type PageMargins,
  type SectionMarkerBlock,
} from '@eigenpal/docx-editor-core/layout-engine';
import { buildBoxTree } from '@eigenpal/docx-editor-core/layout-bridge';
import {
  buildFootnoteContentMap,
  buildFootnoteRenderItems,
  collectFootnoteRefs,
  convertHeaderFooterToContent,
  convertHeaderFooterPmDocToContent,
  getMargins,
  getPageSize,
  stabilizeFootnoteLayout,
} from '@eigenpal/docx-editor-core/layout-bridge';
import type { Node as PMNode } from 'prosemirror-model';
import {
  LayoutPainter,
  paintPages,
  type BlockLookup,
  type FootnoteRenderItem,
  type HeaderFooterContent,
  type RenderPageOptions,
} from '@eigenpal/docx-editor-core/layout-painter';
import { findVerticalScrollParentOrRoot } from '@eigenpal/docx-editor-core/utils/findVerticalScrollParent';
import type {
  Document,
  HeaderFooter,
  SectionProperties,
  StyleDefinitions,
  Theme,
} from '@eigenpal/docx-editor-core/types/document';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import type { SelectionBridge } from '../internals/SelectionBridge';
import { computeAnchorPositions } from '../internals/sidebarAnchorPositions';
import { computePerBlockWidths, getColumns, twipsToPixels } from '../internals/columnLayout';
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
  syncCoordinator: SelectionBridge;
  getScrollContainer: () => HTMLDivElement | null;
  onTotalPagesChange?: (totalPages: number) => void;
  onAnchorPositionsChange?: (positions: Map<string, number>) => void;
  onRenderedDomContextReady?: (context: RenderedDomContext) => void;
}

export interface UseLayoutPipelineReturn {
  layout: Layout | null;
  blocks: FlowBlock[];
  measures: Measure[];
  decorationSyncToken: number;
  notifyDecorationLayer: () => void;
  contentWidth: number;
  runLayoutPipeline: (state: EditorState) => void;
  scheduleLayout: (state: EditorState) => void;
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
    syncCoordinator,
    getScrollContainer,
    onTotalPagesChange,
    onAnchorPositionsChange,
    onRenderedDomContextReady,
  } = opts;

  const [layout, setLayout] = useState<Layout | null>(null);
  const [blocks, setBlocks] = useState<FlowBlock[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
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
  const getHfPmDocRef = useRef(getHfPmDoc);
  onTotalPagesChangeRef.current = onTotalPagesChange;
  onAnchorPositionsChangeRef.current = onAnchorPositionsChange;
  onRenderedDomContextReadyRef.current = onRenderedDomContextReady;
  getHfPmDocRef.current = getHfPmDoc;

  // Total-pages notifier — fires only when count changes (including N → 0).
  const lastTotalPagesRef = useRef<number>(0);
  useEffect(() => {
    const total = layout?.pages.length ?? 0;
    if (total === lastTotalPagesRef.current) return;
    lastTotalPagesRef.current = total;
    onTotalPagesChangeRef.current?.(total);
  }, [layout]);

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
    () => new LayoutPainter({ pageGap, showShadow: true, pageBackground: '#fff' }),
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

      const currentEpoch = syncCoordinator.getStateSeq();
      syncCoordinator.onLayoutStart();

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
        // Step 1: Convert PM doc to flow blocks
        let stepStart = performance.now();
        const pageContentHeight = pageSize.h - margins.top - margins.bottom;
        const newBlocks = buildBoxTree(state.doc, { theme, pageContentHeight });
        let stepTime = performance.now() - stepStart;
        if (stepTime > 500) {
          console.warn(
            `[PagedEditor] buildBoxTree took ${Math.round(stepTime)}ms (${newBlocks.length} blocks)`
          );
        }
        setBlocks(newBlocks);

        // Step 2: Measure all blocks.
        // Must use full measureBlocks() because measurements depend on
        // inter-block context (floating zones, cumulative Y). Individual
        // block measurements cannot be cached by PM node identity since
        // floating tables/images create exclusion zones that affect
        // neighboring paragraphs' line widths.
        stepStart = performance.now();
        const blockWidths = computePerBlockWidths(
          newBlocks,
          { pageSize, margins, columns },
          { pageSize: finalPageSize, margins: finalMargins, columns: finalColumns }
        );
        const newMeasures = measureBlocks(newBlocks, blockWidths);
        stepTime = performance.now() - stepStart;
        if (stepTime > 1000) {
          console.warn(
            `[PagedEditor] measureBlocks took ${Math.round(stepTime)}ms (${newBlocks.length} blocks)`
          );
        }
        setMeasures(newMeasures);

        // Step 2.5: Collect footnote references from blocks
        const footnoteRefs = collectFootnoteRefs(newBlocks);
        const hasFootnotes = footnoteRefs.length > 0 && document?.package?.footnotes;

        // Step 2.75: Prepare header/footer content for rendering (needed before layout
        // to compute effective margins when header content exceeds available space)
        const hfMetricsHeader = { section: 'header' as const, pageSize, margins };
        const hfMetricsFooter = { section: 'footer' as const, pageSize, margins };
        const defaultTabMarkTwips = state.doc.attrs?.defaultTabMarkTwips as number | null;
        const hfOptions = { styles, theme, measureBlocks, defaultTabMarkTwips };

        // HF unification phase 1: when a persistent hidden PM EditorView is
        // mounted for an HF instance (via `HiddenHeaderFooterPMs`), the
        // painter reads from `view.state.doc` rather than re-parsing
        // `HeaderFooter.content` every layout pass. In phase 1 the PM doc is
        // a faithful mirror of the Document model — visible behavior is
        // unchanged — but this routing is the seam that later phases plug
        // edits into. (openspec/changes/unify-hf-editing/)
        const convertHf = (
          hf: HeaderFooter | null | undefined,
          metrics: typeof hfMetricsHeader | typeof hfMetricsFooter
        ) => {
          if (!hf) return undefined;
          const pmDoc = getHfPmDocRef.current?.(hf);
          if (pmDoc) {
            return convertHeaderFooterPmDocToContent(pmDoc, contentWidth, metrics, hfOptions);
          }
          return convertHeaderFooterToContent(hf, contentWidth, metrics, hfOptions);
        };

        const headerContentForRender = convertHf(headerContent, hfMetricsHeader);
        const footerContentForRender = convertHf(footerContent, hfMetricsFooter);
        const hasTitlePg = sectionProperties?.titlePg === true;
        const firstPageHeaderForRender = hasTitlePg
          ? convertHf(firstPageHeaderContent, hfMetricsHeader)
          : undefined;
        const firstPageFooterForRender = hasTitlePg
          ? convertHf(firstPageFooterContent, hfMetricsFooter)
          : undefined;

        // Adjust margins if header/footer content exceeds available space
        // (Word and Google Docs push body content down when header grows)
        const headerDistance = margins.header ?? 48;
        const footerDistance = margins.footer ?? 48;
        const availableHeaderSpace = margins.top - headerDistance;
        const availableFooterSpace = margins.bottom - footerDistance;
        const hfHeight = (hf: HeaderFooterContent | undefined) =>
          hf ? (hf.visualBottom ?? hf.height) : 0;
        const hfFooterHeight = (hf: HeaderFooterContent | undefined) =>
          hf ? Math.max((hf.visualBottom ?? hf.height) - (hf.visualTop ?? 0), hf.height) : 0;
        const headerContentHeight = Math.max(
          hfHeight(headerContentForRender),
          hfHeight(firstPageHeaderForRender)
        );
        const footerContentHeight = Math.max(
          hfFooterHeight(footerContentForRender),
          hfFooterHeight(firstPageFooterForRender)
        );

        // Extend margins so body content gets pushed clear of header / footer.
        // Apply to body-level fallback, finalMargins, and every per-sectionBreak margins.
        const extendHeader = headerContentHeight > availableHeaderSpace;
        const extendFooter = footerContentHeight > availableFooterSpace;
        let effectiveMargins = margins;
        let effectiveFinalMargins = finalMargins;
        if (extendHeader || extendFooter) {
          const extend = (m: PageMargins): PageMargins => {
            const out = { ...m };
            if (extendHeader) {
              out.top = Math.max(m.top, headerDistance + headerContentHeight);
            }
            if (extendFooter) {
              out.bottom = Math.max(m.bottom, footerDistance + footerContentHeight);
            }
            return out;
          };
          effectiveMargins = extend(margins);
          effectiveFinalMargins = extend(finalMargins);
          for (const block of newBlocks) {
            if (block.kind !== 'sectionBreak') continue;
            const sb = block as SectionMarkerBlock;
            if (sb.margins) sb.margins = extend(sb.margins);
          }
        }

        // Step 3: Layout blocks onto pages (two-pass if footnotes exist)
        stepStart = performance.now();
        let newLayout: Layout;
        let pageFootnoteMap = new Map<number, number[]>();
        let footnoteContentMap = new Map<number, FootnoteContent>();

        const bodyBreakType = finalSectionProperties?.sectionStart as
          | 'continuous'
          | 'nextPage'
          | 'evenPage'
          | 'oddPage'
          | undefined;
        const layoutOpts = {
          pageSize,
          margins: effectiveMargins,
          finalPageSize,
          finalMargins: effectiveFinalMargins,
          columns: finalColumns,
          bodyBreakType,
          pageGap,
        };

        if (hasFootnotes) {
          const pass1Layout = layOutPages(newBlocks, newMeasures, layoutOpts);
          footnoteContentMap = buildFootnoteContentMap(
            document!.package.footnotes!,
            footnoteRefs,
            contentWidth,
            {
              styles: styles ?? undefined,
              theme: theme ?? null,
              measureBlocks,
              defaultTabMarkTwips,
            }
          );
          const stabilized = stabilizeFootnoteLayout({
            blocks: newBlocks,
            measures: newMeasures,
            layoutOpts,
            footnoteRefs,
            footnoteContentMap,
            initialLayout: pass1Layout,
          });
          newLayout = stabilized.layout;
          pageFootnoteMap = stabilized.pageFootnoteMap;
        } else {
          newLayout = layOutPages(newBlocks, newMeasures, layoutOpts);
        }

        stepTime = performance.now() - stepStart;
        if (stepTime > 500) {
          console.warn(
            `[PagedEditor] layOutPages took ${Math.round(stepTime)}ms (${newLayout.pages.length} pages)`
          );
        }
        setLayout(newLayout);

        // Step 4: Paint to DOM
        if (pagesContainerRef.current && painterRef.current) {
          stepStart = performance.now();
          pendingScrollRestoreRef.current = null;
          pendingIncrementalScrollSnapshotWrittenAtRef.current = 0;

          const pagesEl = pagesContainerRef.current;
          const scrollParent = getScrollContainer() ?? findVerticalScrollParentOrRoot(pagesEl);
          const anchor = scrollParent?.isConnected
            ? captureScrollAnchor(pagesEl, scrollParent, state.selection.head)
            : null;

          const blockLookup: BlockLookup = new Map();
          for (let i = 0; i < newBlocks.length; i++) {
            const block = newBlocks[i];
            const measure = newMeasures[i];
            if (block && measure) {
              blockLookup.set(String(block.id), { block, measure });
            }
          }
          painterRef.current.setBlockLookup(blockLookup);

          const footnotesByPage = hasFootnotes
            ? buildFootnoteRenderItems(pageFootnoteMap, footnoteContentMap, document)
            : undefined;

          const paintPagesKind = paintPages(newLayout.pages, pagesContainerRef.current, {
            pageGap,
            showShadow: true,
            pageBackground: '#fff',
            blockLookup,
            headerContent: headerContentForRender,
            footerContent: footerContentForRender,
            firstPageHeaderContent: firstPageHeaderForRender,
            firstPageFooterContent: firstPageFooterForRender,
            titlePg: hasTitlePg,
            headerDistance: sectionProperties?.headerDistance
              ? twipsToPixels(sectionProperties.headerDistance)
              : undefined,
            footerDistance: sectionProperties?.footerDistance
              ? twipsToPixels(sectionProperties.footerDistance)
              : undefined,
            pageBorders: sectionProperties?.pageBorders,
            theme,
            footnotesByPage: footnotesByPage?.size ? footnotesByPage : undefined,
            resolvedCommentIds,
          } as RenderPageOptions & {
            pageGap?: number;
            blockLookup?: BlockLookup;
            footnotesByPage?: Map<number, FootnoteRenderItem[]>;
          });

          const vp = viewportLayoutRef.current;
          if (vp) {
            const mh = viewportMinHeightPx(newLayout, pageGap);
            vp.style.minHeight = `${mh}px`;
            if (zoom !== 1) {
              vp.style.marginBottom = `${mh * (zoom - 1)}px`;
            } else {
              vp.style.marginBottom = '';
            }
          }

          if (scrollParent?.isConnected && anchor) {
            const pending = buildPendingScrollRestore(paintPagesKind, scrollParent, anchor);
            pendingScrollRestoreRef.current = pending;
            if (pending.renderKind === 'incremental' && pending.scrollTopSnapshot != null) {
              pendingIncrementalScrollSnapshotWrittenAtRef.current = performance.now();
            }
          }

          stepTime = performance.now() - stepStart;
          if (stepTime > 500) {
            console.warn(`[PagedEditor] paintPages took ${Math.round(stepTime)}ms`);
          }

          // Deterministic "painter is done writing" signal. HF caret +
          // selection-rect resolvers wait on this instead of `requestAnimationFrame`
          // chains — the rAF approach raced the painter and stale
          // `data-doc-from` spans showed up on the first frame after engage
          // (`computeHfCaretRectFromView` had to retry through a second rAF).
          // Bubbling CustomEvent so any ancestor (DocxEditorPagedArea) can
          // listen via `pagesContainerRef.current?.addEventListener(...)`.
          pagesContainerRef.current?.dispatchEvent(
            new CustomEvent('painter:painted', { bubbles: true })
          );

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
            newLayout,
            newBlocks,
            newMeasures,
            pageGap
          );
          onAnchorPositionsChangeRef.current(positions);
        }

        applyPendingIncrementalScrollSnapshot(false);

        const totalTime = performance.now() - pipelineStart;
        if (totalTime > 2000) {
          console.warn(
            `[PagedEditor] Layout pipeline took ${Math.round(totalTime)}ms total ` +
              `(${newBlocks.length} blocks, ${newMeasures.length} measures)`
          );
        }
      } catch (error) {
        console.error('[PagedEditor] Layout pipeline error:', error);
      }

      syncCoordinator.onLayoutComplete(currentEpoch);
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
      syncCoordinator,
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
  }, [layout, getScrollContainer, pagesContainerRef]);

  // =========================================================================
  // Coalesced Layout (rAF throttle)
  // =========================================================================

  /**
   * Multiple rapid transactions (e.g. typing "hello") within the same frame
   * are coalesced so only the final state triggers a full layout pass.
   */
  const pendingLayoutRef = useRef<{
    rafId: number;
    state: EditorState;
  } | null>(null);

  const scheduleLayout = useCallback(
    (state: EditorState) => {
      if (pendingLayoutRef.current) {
        pendingLayoutRef.current.state = state;
        return;
      }
      const rafId = requestAnimationFrame(() => {
        const pending = pendingLayoutRef.current;
        pendingLayoutRef.current = null;
        if (pending) {
          runLayoutPipeline(pending.state);
        }
      });
      pendingLayoutRef.current = { rafId, state };
    },
    [runLayoutPipeline]
  );

  // Clean up pending rAF on unmount
  useEffect(() => {
    return () => {
      if (pendingLayoutRef.current) {
        cancelAnimationFrame(pendingLayoutRef.current.rafId);
        pendingLayoutRef.current = null;
      }
    };
  }, []);

  return {
    layout,
    blocks,
    measures,
    decorationSyncToken,
    notifyDecorationLayer,
    contentWidth,
    runLayoutPipeline,
    scheduleLayout,
  };
}

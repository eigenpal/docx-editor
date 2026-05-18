/**
 * PagedEditor Component
 *
 * Main paginated editing component that integrates:
 * - OffscreenEditorHost: off-screen editor for keyboard input
 * - Layout engine: computes page layout from PM state
 * - DOM painter: renders pages to visible DOM
 * - Selection overlay: renders caret and selection highlights
 *
 * Architecture:
 * 1. User clicks on visible pages → hit test → update PM selection
 * 2. User types → hidden PM receives input → PM transaction
 * 3. PM transaction → convert to blocks → measure → layout → paint
 * 4. Selection changes → compute rects → update overlay
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  memo,
} from 'react';
import type { CSSProperties } from 'react';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction, Plugin } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';

// Internal components
import { OffscreenEditorHost, type OffscreenEditorHostRef } from './OffscreenEditorHost';
import { SelectionOverlay } from './SelectionOverlay';
import { ImageSelectionOverlay, type ImageSelectionInfo } from './ImageSelectionOverlay';
import { DecorationLayer } from './DecorationLayer';

// Layout engine
import {
  layOutPages,
  findPageIndexContainingPmPos,
} from '@eigenpal/docx-editor-core/layout-engine';
import type {
  Layout,
  FlowBlock,
  Measure,
  FootnoteContent,
  PageMargins,
  SectionMarkerBlock,
} from '@eigenpal/docx-editor-core/layout-engine';

// Table commands (for quick-action insert buttons)
import {
  addRowBelow,
  addColumnRight,
  findStartPosForParaId,
} from '@eigenpal/docx-editor-core/prosemirror';

// Layout bridge
import { buildBoxTree } from '@eigenpal/docx-editor-core/layout-bridge';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import { pointerHitResolveImage, captureInlinePositionEmu } from '@eigenpal/docx-editor-core/layout-painter';
import {
  resetCanvasContext,
  clearAllCaches,
  getPageSize,
  getMargins,
  DEFAULT_PAGE_HEIGHT_PX,
} from '@eigenpal/docx-editor-core/layout-bridge';
import { resolveFragmentHit, resolveTableCellHit } from '@eigenpal/docx-editor-core/layout-bridge';
import { pointerToDocPos } from '@eigenpal/docx-editor-core/layout-bridge';
import { resolveDomPosition } from '@eigenpal/docx-editor-core/layout-bridge';
import {
  findBodyEmptyRuns,
  findBodyPmAnchor,
  collectBodySpans,
} from '@eigenpal/docx-editor-core/layout-bridge';
import {
  rectsForSelection,
  getCaretPosition,
  type SelectionBox,
  type CaretPosition,
} from '@eigenpal/docx-editor-core/layout-bridge';
import { findWordBoundaries, pixelsToEmu } from '@eigenpal/docx-editor-core/utils';

// Layout painter
import { LayoutPainter, type BlockLookup } from '@eigenpal/docx-editor-core/layout-painter';
import {
  paintPages,
  type RenderPageOptions,
  type RenderPagesUpdateKind,
  type HeaderFooterContent,
  type FootnoteRenderItem,
  findImageElement as coreFindImageElement,
} from '@eigenpal/docx-editor-core/layout-painter';

// Selection sync
import { SelectionBridge } from './SelectionBridge';

// Visual line navigation hook
import { useVisualLineNavigation } from '../../hooks/useVisualLineNavigation';
import { useDragAutoScroll } from '../../hooks/useDragAutoScroll';

// Sidebar constants
import { SIDEBAR_DOCUMENT_SHIFT } from '../sidebar/constants';

// Types
import type {
  Document,
  Theme,
  StyleDefinitions,
  SectionProperties,
  HeaderFooter,
} from '@eigenpal/docx-editor-core/types/document';
import {
  collectFootnoteRefs,
  buildFootnoteContentMap,
  buildFootnoteRenderItems,
  stabilizeFootnoteLayout,
  convertHeaderFooterToContent,
  detectTableInsertHover,
  TABLE_INSERT_HIDE_DELAY_MS as TABLE_INSERT_HIDE_DELAY,
} from '@eigenpal/docx-editor-core/layout-bridge';
import type { RenderedDomContext } from '../../plugin-api/types';
import { createRenderedDomContext } from '../../plugin-api/RenderedDomContext';
import { findVerticalScrollParentOrRoot } from '@eigenpal/docx-editor-core/utils/findVerticalScrollParent';

import {
  scrollElementCenterIntoContainer,
  runAfterPaint,
  findPaintedPmStartAtOrBefore,
  viewportMinHeightPx,
} from './scrollUtils';
import {
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_GAP,
  EMPTY_PLUGINS,
  containerStyles,
  viewportStyles,
  pagesContainerStyles,
  pluginOverlaysStyles,
} from './styles';
import { computeAnchorPositions } from './anchorPositions';
import { twipsToPixels, getColumns, computePerBlockWidths } from './columnLayout';
import { measureBlocks } from './measureBlock';

export { DEFAULT_PAGE_WIDTH };

// =============================================================================
// TYPES
// =============================================================================

export interface PagedEditorProps {
  /** The document to edit. */
  document: Document | null;
  /** Document styles for style resolution. */
  styles?: StyleDefinitions | null;
  /** Theme for styling. */
  theme?: Theme | null;
  /** Section properties (page size, margins). */
  sectionProperties?: SectionProperties | null;
  /** Body-level final section properties, used after the last explicit section break. */
  finalSectionProperties?: SectionProperties | null;
  /** Header content for all pages (or pages 2+ when titlePg is set). */
  headerContent?: HeaderFooter | null;
  /** Footer content for all pages (or pages 2+ when titlePg is set). */
  footerContent?: HeaderFooter | null;
  /** Header content for first page only (when titlePg is set). */
  firstPageHeaderContent?: HeaderFooter | null;
  /** Footer content for first page only (when titlePg is set). */
  firstPageFooterContent?: HeaderFooter | null;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Gap between pages in pixels. */
  pageGap?: number;
  /** Zoom level (1 = 100%). */
  zoom?: number;
  /** Callback when document changes. */
  onDocumentChange?: (document: Document) => void;
  /** Callback when selection changes. */
  onSelectionChange?: (from: number, to: number) => void;
  /** External ProseMirror plugins. */
  externalPlugins?: Plugin[];
  /** Extension manager for plugins/schema/commands (optional — falls back to default) */
  extensionManager?: import('@eigenpal/docx-editor-core/prosemirror/extensions').ExtensionManager;
  /** Callback when editor is ready. */
  onReady?: (ref: PagedEditorRef) => void;
  /** Callback when rendered DOM context is ready. */
  onRenderedDomContextReady?: (context: RenderedDomContext) => void;
  /** Plugin overlays to render inside the viewport. */
  pluginOverlays?: React.ReactNode;
  /** Callback when header or footer is double-clicked for editing. */
  onHeaderFooterDoubleClick?: (position: 'header' | 'footer', pageNumber?: number) => void;
  /** Active header/footer editing mode (dims body, intercepts body clicks). */
  hfEditMode?: 'header' | 'footer' | null;
  /** Called when user clicks the body area while in HF editing mode. */
  onBodyClick?: () => void;
  /** Custom class name. */
  className?: string;
  /** Custom styles. */
  style?: CSSProperties;
  /** Whether comments sidebar is open (shifts document left). */
  commentsSidebarOpen?: boolean;
  /** Sidebar overlay rendered inside the scroll container (scrolls with document). */
  sidebarOverlay?: React.ReactNode;
  /** Ref callback for the scroll container element. */
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  /** Callback when a hyperlink is clicked (for showing popup). */
  onHyperlinkClick?: (data: {
    href: string;
    displayText: string;
    tooltip?: string;
    anchorRect: DOMRect;
  }) => void;
  /** Callback when user right-clicks on the pages (for context menu).
   *  When the right-click target resolves to an image node, `image` carries
   *  the image's PM doc position, current wrap type, current cssFloat (lets
   *  the menu disambiguate Square Left vs Square Right), and — for inline
   *  images only — the rendered EMU offset of the image relative to the
   *  page content origin. The host promotes that offset into the new
   *  anchor's `wp:positionH/V` if the user converts inline → anchor. */
  onContextMenu?: (data: {
    x: number;
    y: number;
    hasSelection: boolean;
    image?: {
      pos: number;
      wrapType: WrapType;
      cssFloat?: 'left' | 'right' | 'none' | null;
      inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
    } | null;
  }) => void;
  /** Callback with pre-computed Y positions for comment/tracked-change anchors (for sidebar positioning without DOM queries). */
  onAnchorPositionsChange?: (positions: Map<string, number>) => void;
  /**
   * Callback fired when the page count changes after a layout pass.
   * Parents use this to keep their own page counters (e.g. scroll indicator,
   * `getTotalPages()` ref method) in sync without having to poll `getLayout()`.
   */
  onTotalPagesChange?: (totalPages: number) => void;
  /** Set of resolved comment IDs — hides highlight for these comments */
  resolvedCommentIds?: Set<number>;
}

export interface PagedEditorRef {
  /** Get the current document. */
  getDocument(): Document | null;
  /** Get the ProseMirror EditorState. */
  getState(): EditorState | null;
  /** Get the ProseMirror EditorView. */
  getView(): EditorView | null;
  /** Focus the editor. */
  focus(): void;
  /** Blur the editor. */
  blur(): void;
  /** Check if focused. */
  isFocused(): boolean;
  /** Dispatch a transaction. */
  dispatch(tr: Transaction): void;
  /** Undo. */
  undo(): boolean;
  /** Redo. */
  redo(): boolean;
  /** Set selection by PM position. */
  setSelection(anchor: number, head?: number): void;
  /** Get current layout. */
  getLayout(): Layout | null;
  /** Force re-layout. */
  relayout(): void;
  /** Scroll the visible pages to bring a PM position into view. */
  scrollToPosition(pmPos: number): void;
  /**
   * Scroll to the paragraph identified by Word `w14:paraId` / PM `paraId`.
   * @returns whether a matching paragraph was found
   */
  scrollToParaId(paraId: string): boolean;
  /**
   * Scroll the paginated view so `pageNumber` (1-indexed) is in view.
   * No-op if the layout isn't ready yet or pageNumber is out of range.
   */
  scrollToPage(pageNumber: number): void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
// Module-scope helpers extracted to per-domain files — see top of file
// for the import block.
// =============================================================================
// COMPONENT
// =============================================================================

/**
 * PagedEditor - Main paginated editing component.
 */
const PagedEditorComponent = forwardRef<PagedEditorRef, PagedEditorProps>(
  function PagedEditor(props, ref) {
    const {
      document,
      styles,
      theme: _theme,
      sectionProperties,
      finalSectionProperties,
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
      readOnly = false,
      pageGap = DEFAULT_PAGE_GAP,
      zoom = 1,
      onDocumentChange,
      onSelectionChange,
      externalPlugins = EMPTY_PLUGINS,
      extensionManager,
      onReady,
      onRenderedDomContextReady,
      pluginOverlays,
      onHeaderFooterDoubleClick,
      hfEditMode,
      onBodyClick,
      className,
      style,
      commentsSidebarOpen = false,
      sidebarOverlay,
      scrollContainerRef: scrollContainerRefProp,
      onHyperlinkClick,
      onContextMenu,
      onAnchorPositionsChange,
      onTotalPagesChange,
      resolvedCommentIds,
    } = props;

    // Resolve the scroll container: prefer parent-provided ref, fallback to own container
    const getScrollContainer = useCallback((): HTMLDivElement | null => {
      if (scrollContainerRefProp && typeof scrollContainerRefProp === 'object') {
        return (scrollContainerRefProp as React.RefObject<HTMLDivElement | null>).current;
      }
      return containerRef.current;
    }, [scrollContainerRefProp]);

    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const pagesContainerRef = useRef<HTMLDivElement>(null);
    /** Viewport wrapper: sync minHeight/marginBottom in layout pipeline before scroll restore. */
    const viewportLayoutRef = useRef<HTMLDivElement>(null);
    const pendingScrollRestoreRef = useRef<{
      renderKind: RenderPagesUpdateKind;
      ratio: number;
      scrollTopSnapshot: number | null;
      domAnchorPmStart: number | null;
      domAnchorOffsetInScroller: number;
    } | null>(null);
    const pendingIncrementalScrollSnapshotWrittenAtRef = useRef(0);
    const hiddenPMRef = useRef<OffscreenEditorHostRef>(null);
    const painterRef = useRef<LayoutPainter | null>(null);

    // Visual line navigation (ArrowUp/ArrowDown with sticky X)
    const { handlePMKeyDown } = useVisualLineNavigation({ pagesContainerRef });

    // Stable ref for drag-extend callback (avoids circular deps with getPositionFromMouse)
    const dragExtendRef = useRef<(cx: number, cy: number) => void>(() => {});

    // Store callbacks in refs to avoid infinite re-render loops
    // when parent passes unstable callback references
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onDocumentChangeRef = useRef(onDocumentChange);
    const onReadyRef = useRef(onReady);
    const onRenderedDomContextReadyRef = useRef(onRenderedDomContextReady);
    // Last PM state we invoked onSelectionChange for. updateSelectionOverlay
    // runs from ResizeObserver / layout / font-load paths too, not only on real
    // state changes — firing the callback in those cases caused the sidebar
    // expand→resize→re-fire→collapse feedback loop (regression #268). PM states
    // are immutable so reference equality is the canonical "nothing changed"
    // signal (covers selection, doc, and stored-marks changes alike).
    const lastNotifiedStateRef = useRef<EditorState | null>(null);

    // Keep refs in sync with latest props
    onSelectionChangeRef.current = onSelectionChange;
    onDocumentChangeRef.current = onDocumentChange;
    onReadyRef.current = onReady;
    onRenderedDomContextReadyRef.current = onRenderedDomContextReady;

    // State
    const [layout, setLayout] = useState<Layout | null>(null);
    const lastTotalPagesRef = useRef<number>(0);
    const onTotalPagesChangeRef = useRef(onTotalPagesChange);
    onTotalPagesChangeRef.current = onTotalPagesChange;
    useEffect(() => {
      // Fires on every page-count change including N → 0 (e.g. doc cleared),
      // so consumers don't get stuck showing the previous count. ref=0 init
      // matches `layout?.pages.length ?? 0` so we don't fire on initial mount.
      const total = layout?.pages.length ?? 0;
      if (total === lastTotalPagesRef.current) return;
      lastTotalPagesRef.current = total;
      onTotalPagesChangeRef.current?.(total);
    }, [layout]);
    const [blocks, setBlocks] = useState<FlowBlock[]>([]);
    const [measures, setMeasures] = useState<Measure[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const [selectionGeometry, setSelectionGeometry] = useState<SelectionBox[]>([]);
    const [caretPosition, setCaretPosition] = useState<CaretPosition | null>(null);

    // Image selection state
    const [selectedImageInfo, setSelectedImageInfo] = useState<ImageSelectionInfo | null>(null);
    const isImageInteractingRef = useRef(false);

    /** Build ImageSelectionInfo from a DOM element with data-doc-from */
    const buildImageSelectionInfo = useCallback(
      (el: HTMLElement, pmPos: number): ImageSelectionInfo => {
        const imgTag = el.tagName === 'IMG' ? el : el.querySelector('img');
        const rect = (imgTag ?? el).getBoundingClientRect();
        return {
          element: (imgTag ?? el) as HTMLElement,
          pmPos,
          width: Math.round(rect.width / zoom),
          height: Math.round(rect.height / zoom),
        };
      },
      [zoom]
    );

    // Drag selection state
    const isDraggingRef = useRef(false);
    const dragAnchorRef = useRef<number | null>(null);

    // Column resize state
    const isResizingColumnRef = useRef(false);
    const resizeStartXRef = useRef(0);
    const resizeColumnIndexRef = useRef(0);
    const resizeTablePmStartRef = useRef(0);
    const resizeOrigWidthsRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
    const resizeHandleRef = useRef<HTMLElement | null>(null);

    // Row resize state
    const isResizingRowRef = useRef(false);
    const resizeStartYRef = useRef(0);
    const resizeRowIndexRef = useRef(0);
    const resizeRowTablePmStartRef = useRef(0);
    const resizeRowOrigHeightRef = useRef(0); // twips
    const resizeRowHandleRef = useRef<HTMLElement | null>(null);
    const resizeRowIsEdgeRef = useRef(false);

    // Right edge resize state (grows last column only)
    const isResizingRightEdgeRef = useRef(false);
    const resizeRightEdgeStartXRef = useRef(0);
    const resizeRightEdgeColIndexRef = useRef(0);
    const resizeRightEdgePmStartRef = useRef(0);
    const resizeRightEdgeOrigWidthRef = useRef(0); // twips
    const resizeRightEdgeHandleRef = useRef<HTMLElement | null>(null);

    // Cell selection drag state
    const isCellDraggingRef = useRef(false);
    const cellDragAnchorPosRef = useRef<number | null>(null);
    const cellDragLastPmPosRef = useRef<number | null>(null);
    const cellDragOverflowXRef = useRef<number | null>(null);
    const CELL_SELECT_OVERFLOW_PX = 5; // px of continued drag after text selection maxes out

    // Table quick action insert button state
    type TableInsertButtonState = {
      type: 'row' | 'column';
      /** Pixel position relative to viewport container */
      x: number;
      y: number;
      /** PM position inside target cell (to set selection before dispatching) */
      cellPmPos: number;
    };
    const [tableInsertButton, setTableInsertButton] = useState<TableInsertButtonState | null>(null);
    const tableInsertHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTableInsertTimer = useCallback(() => {
      if (tableInsertHideTimerRef.current) {
        clearTimeout(tableInsertHideTimerRef.current);
        tableInsertHideTimerRef.current = null;
      }
    }, []);

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (tableInsertHideTimerRef.current) clearTimeout(tableInsertHideTimerRef.current);
      };
    }, []);

    // Selection gate - ensures selection renders only when layout is current
    const syncCoordinator = useMemo(() => new SelectionBridge(), []);

    // Bumps on every PM transaction (doc, selection, meta-only). Drives the
    // DecorationLayer's resync so plugins like yCursorPlugin (which update
    // decorations on awareness pings — non-doc transactions) propagate.
    const [transactionVersion, setTransactionVersion] = useState(0);

    // Compute page size and margins
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

    // Initialize painter using useMemo to ensure it's ready before first render callbacks
    const painter = useMemo(() => {
      return new LayoutPainter({
        pageGap,
        showShadow: true,
        pageBackground: '#fff',
      });
    }, [pageGap]);

    // Keep ref in sync with memoized painter
    painterRef.current = painter;

    // =========================================================================
    // Layout Pipeline
    // =========================================================================

    /**
     * Run the full layout pipeline:
     * 1. Convert PM doc to blocks
     * 2. Measure blocks
     * 3. Layout blocks onto pages
     * 4. Paint pages to DOM
     */
    const runLayoutPipeline = useCallback(
      (state: EditorState) => {
        const pipelineStart = performance.now();

        // Capture current state sequence for this layout run
        const currentEpoch = syncCoordinator.getStateSeq();

        // Signal layout is starting
        syncCoordinator.onLayoutStart();

        /** Re-clamp scroll when a second layout pass runs before useLayoutEffect consumes pending. */
        const applyPendingIncrementalScrollSnapshot = (onlyIfSnapshotJustWritten: boolean) => {
          const pend = pendingScrollRestoreRef.current;
          if (pend?.renderKind !== 'incremental' || pend.scrollTopSnapshot == null) return;
          if (onlyIfSnapshotJustWritten) {
            const age = performance.now() - pendingIncrementalScrollSnapshotWrittenAtRef.current;
            if (age > 32) return;
          }
          const pe0 = pagesContainerRef.current;
          const sp0 = pe0 ? (getScrollContainer() ?? findVerticalScrollParentOrRoot(pe0)) : null;
          if (!sp0?.isConnected) return;
          const max0 = Math.max(1, sp0.scrollHeight - sp0.clientHeight);
          const target = Math.min(Math.max(0, pend.scrollTopSnapshot), max0);
          if (Math.abs(sp0.scrollTop - target) > 0.5) {
            sp0.scrollTop = target;
          }
        };
        applyPendingIncrementalScrollSnapshot(true);

        try {
          // Step 1: Convert PM doc to flow blocks
          let stepStart = performance.now();
          const pageContentHeight = pageSize.h - margins.top - margins.bottom;
          const newBlocks = buildBoxTree(state.doc, { theme: _theme, pageContentHeight });
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
          // Compute per-block widths accounting for section breaks with different column configs
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
          const hfOptions = { styles, theme: _theme, measureBlocks };
          const headerContentForRender = convertHeaderFooterToContent(
            headerContent,
            contentWidth,
            hfMetricsHeader,
            hfOptions
          );
          const footerContentForRender = convertHeaderFooterToContent(
            footerContent,
            contentWidth,
            hfMetricsFooter,
            hfOptions
          );
          const hasTitlePg = sectionProperties?.titlePg === true;
          const firstPageHeaderForRender = hasTitlePg
            ? convertHeaderFooterToContent(
                firstPageHeaderContent,
                contentWidth,
                hfMetricsHeader,
                hfOptions
              )
            : undefined;
          const firstPageFooterForRender = hasTitlePg
            ? convertHeaderFooterToContent(
                firstPageFooterContent,
                contentWidth,
                hfMetricsFooter,
                hfOptions
              )
            : undefined;

          // Adjust margins if header/footer content exceeds available space
          // (Word and Google Docs push body content down when header grows)
          // Use the tallest header/footer across all variants for margin computation
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

          // When header/footer content exceeds the authored margin space,
          // extend the margins so body content gets pushed clear of the
          // header and footer. Apply to:
          //   1. `margins` (body-level fallback used when a section break
          //      doesn't carry its own margins)
          //   2. `finalMargins` (used by the trailing section)
          //   3. Every `sb.margins` carried on `sectionBreak` blocks — the
          //      layout engine prefers these over the body-level fallback,
          //      so without this they keep the unextended OOXML values and
          //      the body still overlaps header/footer.
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

          // Common layout options for all passes
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
            // Pass 1: Layout without footnote space to determine page assignments
            const pass1Layout = layOutPages(newBlocks, newMeasures, layoutOpts);

            // Build footnote content via the core pipeline. Styles + theme
            // thread through so footnotes containing themed shading or
            // styled tables resolve their colors / fonts the same way the
            // body does. The adapter supplies its `measureBlocks` so core
            // stays Canvas-free.
            footnoteContentMap = buildFootnoteContentMap(
              document!.package.footnotes!,
              footnoteRefs,
              contentWidth,
              {
                styles: styles ?? undefined,
                theme: _theme ?? null,
                measureBlocks,
              }
            );

            // Pass 2+: multi-pass convergence loop lives in core so the
            // React + Vue adapters stay in lockstep.
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
            // No footnotes — single pass
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
            let scrollRestoreRatioPre = 0;
            let domAnchorPmStart: number | null = null;
            let domAnchorOffsetInScroller = 0;
            if (scrollParent?.isConnected) {
              if (!scrollParent.style.overflowAnchor) {
                scrollParent.style.setProperty('overflow-anchor', 'none');
              }
              const maxBefore = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
              scrollRestoreRatioPre = scrollParent.scrollTop / maxBefore;

              const head = state.selection.head;
              domAnchorPmStart = findPaintedPmStartAtOrBefore(pagesEl, head);
              if (domAnchorPmStart != null) {
                const anchorEl = findBodyPmAnchor(pagesEl, domAnchorPmStart);
                if (anchorEl) {
                  const ar = anchorEl.getBoundingClientRect();
                  const sr = scrollParent.getBoundingClientRect();
                  domAnchorOffsetInScroller = ar.top - sr.top;
                } else {
                  domAnchorPmStart = null;
                }
              }
            }

            // Build block lookup
            const blockLookup: BlockLookup = new Map();
            for (let i = 0; i < newBlocks.length; i++) {
              const block = newBlocks[i];
              const measure = newMeasures[i];
              if (block && measure) {
                blockLookup.set(String(block.id), { block, measure });
              }
            }
            painterRef.current.setBlockLookup(blockLookup);

            // Build per-page footnote render items
            const footnotesByPage = hasFootnotes
              ? buildFootnoteRenderItems(pageFootnoteMap, footnoteContentMap, document)
              : undefined;

            // Render pages to container
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
              theme: _theme,
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

            if (scrollParent?.isConnected) {
              let ratioForRestore = scrollRestoreRatioPre;
              if (paintPagesKind === 'incremental') {
                const maxPost = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
                ratioForRestore = scrollParent.scrollTop / maxPost;
              }
              const scrollTopSnapshot =
                paintPagesKind === 'incremental' ? scrollParent.scrollTop : null;
              pendingScrollRestoreRef.current = {
                renderKind: paintPagesKind,
                ratio: ratioForRestore,
                scrollTopSnapshot,
                domAnchorPmStart,
                domAnchorOffsetInScroller,
              };
              if (paintPagesKind === 'incremental' && scrollTopSnapshot != null) {
                pendingIncrementalScrollSnapshotWrittenAtRef.current = performance.now();
              }
            }

            stepTime = performance.now() - stepStart;
            if (stepTime > 500) {
              console.warn(`[PagedEditor] paintPages took ${Math.round(stepTime)}ms`);
            }

            // Create and expose RenderedDomContext after DOM is painted
            if (onRenderedDomContextReady) {
              const domContext = createRenderedDomContext(pagesContainerRef.current, zoom);
              onRenderedDomContextReady(domContext);
            }
          } else {
            pendingScrollRestoreRef.current = null;
            pendingIncrementalScrollSnapshotWrittenAtRef.current = 0;
          }

          // Compute anchor Y positions for comments sidebar (works without DOM queries).
          // Only runs when the sidebar callback is registered.
          if (onAnchorPositionsChange) {
            const positions = computeAnchorPositions(
              hiddenPMRef.current?.getView() ?? null,
              newLayout,
              newBlocks,
              newMeasures,
              pageGap
            );
            onAnchorPositionsChange(positions);
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

        // Signal layout is complete for this sequence
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
        sectionProperties,
        finalSectionProperties,
        onRenderedDomContextReady,
        document,
        resolvedCommentIds,
        getScrollContainer,
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

      const { renderKind, ratio, scrollTopSnapshot, domAnchorPmStart, domAnchorOffsetInScroller } =
        pending;

      const applyRatio = () => {
        const maxAfter = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
        scrollParent.scrollTop = ratio * maxAfter;
      };

      const applyIncrementalSnapshot = (): boolean => {
        if (renderKind !== 'incremental' || scrollTopSnapshot == null) return false;
        const maxAfter = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
        scrollParent.scrollTop = Math.min(Math.max(0, scrollTopSnapshot), maxAfter);
        return true;
      };

      const applyScrollRestore = () => {
        if (applyIncrementalSnapshot()) return;
        if (renderKind !== 'incremental' && domAnchorPmStart != null) {
          const el2 = findBodyPmAnchor(pagesEl, domAnchorPmStart);
          if (el2) {
            const sr = scrollParent.getBoundingClientRect();
            const newOffset = el2.getBoundingClientRect().top - sr.top;
            scrollParent.scrollTop += domAnchorOffsetInScroller - newOffset;
            return;
          }
        }
        applyRatio();
      };

      applyScrollRestore();
      const rafId = requestAnimationFrame(() => {
        // After unmount or another layout commit, scrollParent may be detached
        // — writing scrollTop on a detached element silently no-ops, but is
        // still a leaked frame's worth of work.
        if (!scrollParent.isConnected) return;
        applyScrollRestore();
      });
      return () => cancelAnimationFrame(rafId);
    }, [layout, getScrollContainer]);

    // =========================================================================
    // Coalesced Layout (rAF throttle)
    // =========================================================================

    /**
     * Ref holding a pending requestAnimationFrame ID and the latest state.
     * Multiple rapid transactions (e.g. typing "hello") within the same frame
     * are coalesced so only the final state triggers a full layout pass.
     */
    const pendingLayoutRef = useRef<{
      rafId: number;
      state: EditorState;
    } | null>(null);

    /**
     * Schedule a layout pipeline run for the next animation frame.
     * If a run is already scheduled, the pending state is replaced so only
     * the most recent document state gets laid out.
     */
    const scheduleLayout = useCallback(
      (state: EditorState) => {
        if (pendingLayoutRef.current) {
          // Already scheduled — just update the state to the latest
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

    /**
     * Get caret position using DOM-based measurement.
     * This uses the browser's text rendering to get precise pixel positions.
     */
    const getCaretFromDom = useCallback(
      (pmPos: number, currentZoom: number = 1): CaretPosition | null => {
        if (!pagesContainerRef.current) return null;

        const overlay = pagesContainerRef.current.parentElement?.querySelector(
          '[data-testid="selection-overlay"]'
        );
        if (!overlay) return null;

        const overlayRect = overlay.getBoundingClientRect();

        const spans = collectBodySpans(pagesContainerRef.current);

        for (const spanEl of spans) {
          const docFrom = Number(spanEl.dataset.docFrom);
          const docTo = Number(spanEl.dataset.docTo);

          // Special handling for tab spans - use exclusive end to avoid boundary conflicts
          // Tab at [5,6) means position 6 belongs to the next run, not the tab
          if (spanEl.classList.contains('layout-run-tab')) {
            if (pmPos >= docFrom && pmPos < docTo) {
              const spanRect = spanEl.getBoundingClientRect();
              const pageEl = spanEl.closest('.layout-page');
              const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
              const lineEl = spanEl.closest('.layout-line');
              const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;

              return {
                x: (spanRect.left - overlayRect.left) / currentZoom,
                y: (spanRect.top - overlayRect.top) / currentZoom,
                height: lineHeight,
                pageIndex,
              };
            }
            continue; // Skip to next span
          }

          // For text runs, use inclusive range
          if (
            pmPos >= docFrom &&
            pmPos <= docTo &&
            spanEl.firstChild?.nodeType === Node.TEXT_NODE
          ) {
            const textNode = spanEl.firstChild as Text;
            const charIndex = Math.min(pmPos - docFrom, textNode.length);

            // Create a range at the exact character position
            const ownerDoc = spanEl.ownerDocument;
            if (!ownerDoc) continue;
            const range = ownerDoc.createRange();
            range.setStart(textNode, charIndex);
            range.setEnd(textNode, charIndex);

            const rangeRect = range.getBoundingClientRect();

            // Find which page this span is on
            const pageEl = spanEl.closest('.layout-page');
            const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;

            // Get line height from the line element or use default
            const lineEl = spanEl.closest('.layout-line');
            const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;

            return {
              x: (rangeRect.left - overlayRect.left) / currentZoom,
              y: (rangeRect.top - overlayRect.top) / currentZoom,
              height: lineHeight,
              pageIndex,
            };
          }
        }

        // Fallback: try to find position in empty paragraphs (they have empty runs).
        const emptyRuns = findBodyEmptyRuns(pagesContainerRef.current);
        for (const emptyRun of emptyRuns) {
          const paragraph = emptyRun.closest('.layout-paragraph') as HTMLElement;
          if (!paragraph) continue;

          const docFrom = Number(paragraph.dataset.docFrom);
          const docTo = Number(paragraph.dataset.docTo);

          if (pmPos >= docFrom && pmPos <= docTo) {
            const runRect = emptyRun.getBoundingClientRect();
            const pageEl = paragraph.closest('.layout-page');
            const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
            const lineEl = emptyRun.closest('.layout-line');
            const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;

            return {
              x: (runRect.left - overlayRect.left) / currentZoom,
              y: (runRect.top - overlayRect.top) / currentZoom,
              height: lineHeight,
              pageIndex,
            };
          }
        }

        return null;
      },
      []
    );

    /**
     * Update selection overlay from PM selection.
     */
    const updateSelectionOverlay = useCallback(
      (state: EditorState) => {
        const { from, to } = state.selection;

        // Notify consumers only when PM state actually changed. Overlay may
        // still need redraw for DOM geometry reasons (resize, layout, font
        // load) — that happens below — but the public callback should only
        // fire for real selection / doc / stored-marks changes. See
        // lastNotifiedStateRef comment; regression #268.
        if (lastNotifiedStateRef.current !== state) {
          lastNotifiedStateRef.current = state;
          onSelectionChangeRef.current?.(from, to);
        }

        // Update visual cell selection highlighting on visible layout table cells
        if (pagesContainerRef.current) {
          // Clear previous cell highlighting
          const prevSelected = pagesContainerRef.current.querySelectorAll(
            '.layout-table-cell-selected'
          );
          for (const el of Array.from(prevSelected)) {
            el.classList.remove('layout-table-cell-selected');
          }

          // If CellSelection, highlight the corresponding visible cells
          // Use duck-typing ($anchorCell) instead of instanceof to avoid bundling issues
          const sel = state.selection as CellSelection;
          const isCellSel = '$anchorCell' in sel && typeof sel.forEachCell === 'function';
          if (isCellSel) {
            // Collect ranges [cellStart, cellEnd) for each selected cell
            const selectedRanges: Array<[number, number]> = [];
            sel.forEachCell((node, pos) => {
              selectedRanges.push([pos, pos + node.nodeSize]);
            });

            // Find visible layout cells whose docFrom falls inside a selected cell range
            const allCells = pagesContainerRef.current.querySelectorAll('.layout-table-cell');
            for (const cellEl of Array.from(allCells)) {
              const htmlEl = cellEl as HTMLElement;
              const docFromAttr = htmlEl.dataset.docFrom;
              if (docFromAttr !== undefined) {
                const pmPos = Number(docFromAttr);
                for (const [start, end] of selectedRanges) {
                  if (pmPos >= start && pmPos < end) {
                    htmlEl.classList.add('layout-table-cell-selected');
                    break;
                  }
                }
              }
            }
          }
        }

        if (!layout || blocks.length === 0) return;

        // Collapsed selection - show caret
        if (from === to) {
          // Use DOM-based caret positioning for accuracy
          const domCaret = getCaretFromDom(from, zoom);
          if (domCaret) {
            setCaretPosition(domCaret);
          } else {
            // Fallback to layout-based calculation if DOM not ready
            const overlay = pagesContainerRef.current?.parentElement?.querySelector(
              '[data-testid="selection-overlay"]'
            );
            const firstPage = pagesContainerRef.current?.querySelector('.layout-page');

            if (overlay && firstPage) {
              const overlayRect = overlay.getBoundingClientRect();
              const pageRect = firstPage.getBoundingClientRect();
              const caret = getCaretPosition(layout, blocks, measures, from);

              if (caret) {
                setCaretPosition({
                  ...caret,
                  x: caret.x + (pageRect.left - overlayRect.left) / zoom,
                  y: caret.y + (pageRect.top - overlayRect.top) / zoom,
                });
              } else {
                setCaretPosition(null);
              }
            } else {
              setCaretPosition(null);
            }
          }
          setSelectionGeometry([]);
        } else {
          // Range selection - show highlight rectangles using DOM-based approach
          const overlay = pagesContainerRef.current?.parentElement?.querySelector(
            '[data-testid="selection-overlay"]'
          );

          if (overlay && pagesContainerRef.current) {
            const overlayRect = overlay.getBoundingClientRect();
            const domRects: SelectionBox[] = [];

            const spans = collectBodySpans(pagesContainerRef.current);

            for (const spanEl of spans) {
              const docFrom = Number(spanEl.dataset.docFrom);
              const docTo = Number(spanEl.dataset.docTo);

              // Check if this span overlaps with selection
              if (docTo > from && docFrom < to) {
                // Special handling for tab spans - highlight the full visual width
                if (spanEl.classList.contains('layout-run-tab')) {
                  const spanRect = spanEl.getBoundingClientRect();
                  const pageEl = spanEl.closest('.layout-page');
                  const pageIndex = pageEl
                    ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1
                    : 0;

                  domRects.push({
                    x: (spanRect.left - overlayRect.left) / zoom,
                    y: (spanRect.top - overlayRect.top) / zoom,
                    width: spanRect.width / zoom,
                    height: spanRect.height / zoom,
                    pageIndex,
                  });
                  continue;
                }

                // Find the text node — may be a direct child or inside an <a> for hyperlinks
                let textNode: Text | null = null;
                if (spanEl.firstChild?.nodeType === Node.TEXT_NODE) {
                  textNode = spanEl.firstChild as Text;
                } else if (
                  spanEl.firstChild?.nodeType === Node.ELEMENT_NODE &&
                  (spanEl.firstChild as HTMLElement).tagName === 'A' &&
                  spanEl.firstChild.firstChild?.nodeType === Node.TEXT_NODE
                ) {
                  textNode = spanEl.firstChild.firstChild as Text;
                }
                if (!textNode) continue;
                const ownerDoc = spanEl.ownerDocument;
                if (!ownerDoc) continue;

                // Calculate the character range within this span
                const startChar = Math.max(0, from - docFrom);
                const endChar = Math.min(textNode.length, to - docFrom);

                if (startChar < endChar) {
                  const range = ownerDoc.createRange();
                  range.setStart(textNode, startChar);
                  range.setEnd(textNode, endChar);

                  // Get all client rects for this range (handles line wraps)
                  const clientRects = range.getClientRects();
                  for (const rect of Array.from(clientRects)) {
                    const pageEl = spanEl.closest('.layout-page');
                    const pageIndex = pageEl
                      ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1
                      : 0;

                    domRects.push({
                      x: (rect.left - overlayRect.left) / zoom,
                      y: (rect.top - overlayRect.top) / zoom,
                      width: rect.width / zoom,
                      height: rect.height / zoom,
                      pageIndex,
                    });
                  }
                }
              }
            }

            if (domRects.length > 0) {
              setSelectionGeometry(domRects);
            } else {
              // Fallback to layout-based calculation
              const firstPage = pagesContainerRef.current.querySelector('.layout-page');
              if (firstPage) {
                const pageRect = firstPage.getBoundingClientRect();
                const pageOffsetX = (pageRect.left - overlayRect.left) / zoom;
                const pageOffsetY = (pageRect.top - overlayRect.top) / zoom;

                const rects = rectsForSelection(layout, blocks, measures, from, to);
                const adjustedRects = rects.map((rect) => ({
                  ...rect,
                  x: rect.x + pageOffsetX,
                  y: rect.y + pageOffsetY,
                }));
                setSelectionGeometry(adjustedRects);
              } else {
                setSelectionGeometry([]);
              }
            }
          } else {
            setSelectionGeometry([]);
          }
          setCaretPosition(null);
        }
      },
      [layout, blocks, measures, getCaretFromDom, zoom]
      // NOTE: onSelectionChange removed from dependencies - accessed via ref to prevent infinite loops
    );

    // =========================================================================
    // Event Handlers
    // =========================================================================

    /**
     * Handle PM transaction - re-layout on content/selection change.
     */
    const handleTransaction = useCallback(
      (transaction: Transaction, newState: EditorState) => {
        // Bump on every transaction (including selection-only and meta-only
        // ones) so DecorationLayer re-syncs — yCursorPlugin awareness updates
        // arrive as meta transactions with no doc change.
        setTransactionVersion((v) => v + 1);

        if (transaction.docChanged) {
          // Increment state sequence to signal document changed
          syncCoordinator.incrementStateSeq();

          // Content changed - schedule layout (coalesced via rAF)
          scheduleLayout(newState);

          // Notify document change - use ref to avoid infinite loops
          const newDoc = hiddenPMRef.current?.getDocument();
          if (newDoc) {
            onDocumentChangeRef.current?.(newDoc);
          }
        }

        // Request selection update (will only execute when layout is current)
        syncCoordinator.requestRender();

        // Only update selection overlay immediately for non-doc-changing transactions
        // (e.g. arrow keys, clicks). For doc changes, the overlay will be updated
        // after layout completes via the useEffect([layout]) hook, avoiding cursor
        // flicker from stale DOM positions.
        if (!transaction.docChanged) {
          updateSelectionOverlay(newState);
        }
      },
      [scheduleLayout, updateSelectionOverlay, syncCoordinator]
      // NOTE: onDocumentChange removed from dependencies - accessed via ref to prevent infinite loops
    );

    /**
     * Handle selection change from PM.
     */
    const handleSelectionChange = useCallback(
      (state: EditorState) => {
        // Check if this is an image node selection - suppress text overlay if so
        const { selection } = state;
        if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
          // Suppress text selection overlay for image selections
          setSelectionGeometry([]);
          setCaretPosition(null);
        } else if (syncCoordinator.isSafeToRender()) {
          // Only update overlay when layout is current. When doc changed,
          // layout is pending and DOM hasn't been updated yet — updating the
          // overlay now would position the cursor against stale geometry,
          // causing it to visibly jump. The overlay will be updated after
          // layout completes via the useEffect([layout]) hook.
          updateSelectionOverlay(state);
        }

        // Defer image selection check until after layout update
        requestAnimationFrame(() => {
          const view = hiddenPMRef.current?.getView();
          if (!view) {
            setSelectedImageInfo(null);
            return;
          }
          const { selection: sel } = view.state;
          if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
            const pmPos = sel.from;
            const imgEl = pagesContainerRef.current
              ? findBodyPmAnchor(pagesContainerRef.current, pmPos)
              : null;
            if (imgEl) {
              setSelectedImageInfo(buildImageSelectionInfo(imgEl, pmPos));
              return;
            }
          }
          if (!isImageInteractingRef.current) {
            setSelectedImageInfo(null);
          }
        });
      },
      [updateSelectionOverlay, zoom, buildImageSelectionInfo, syncCoordinator]
    );

    /**
     * Get PM position from mouse coordinates using DOM-based detection.
     * Falls back to geometry-based calculation if DOM mapping fails.
     */
    const getPositionFromMouse = useCallback(
      (clientX: number, clientY: number): number | null => {
        if (!pagesContainerRef.current || !layout) return null;

        // Try DOM-based click mapping first (most accurate)
        const domPos = resolveDomPosition(pagesContainerRef.current, clientX, clientY, zoom);
        if (domPos !== null) {
          return domPos;
        }

        // Fallback to geometry-based mapping
        const pageElements = pagesContainerRef.current.querySelectorAll('.layout-page');
        let clickedPageIndex = -1;
        let pageRect: DOMRect | null = null;

        for (let i = 0; i < pageElements.length; i++) {
          const pageEl = pageElements[i];
          const rect = pageEl.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            clickedPageIndex = i;
            pageRect = rect;
            break;
          }
        }

        if (clickedPageIndex < 0 || !pageRect) {
          return null;
        }

        const pageX = (clientX - pageRect.left) / zoom;
        const pageY = (clientY - pageRect.top) / zoom;

        const page = layout.pages[clickedPageIndex];
        if (!page) return null;

        const pageHit = {
          pageIndex: clickedPageIndex,
          page,
          pageY,
        };

        const fragmentHit = resolveFragmentHit(pageHit, blocks, measures, {
          x: pageX,
          y: pageY,
        });

        if (!fragmentHit) return null;

        // For table fragments, do cell-level hit testing
        if (fragmentHit.fragment.kind === 'table') {
          const tableCellHit = resolveTableCellHit(pageHit, blocks, measures, {
            x: pageX,
            y: pageY,
          });
          return pointerToDocPos(fragmentHit, tableCellHit);
        }

        return pointerToDocPos(fragmentHit);
      },
      [layout, blocks, measures, zoom]
    );

    /**
     * Find the table cell position in ProseMirror doc for a given PM position.
     * Returns the position just inside the cell node, suitable for CellSelection.create().
     */
    const findCellPosFromPmPos = useCallback((pmPos: number): number | null => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return null;
      try {
        const $pos = view.state.doc.resolve(pmPos);
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            // Return position of the cell node itself (before(d)).
            // CellSelection.create will resolve this and use cellAround() internally.
            return $pos.before(d);
          }
        }
      } catch {
        // Position resolution failed
      }
      return null;
    }, []);

    /**
     * Find the closest image element from a click target.
     * Returns the element with data-doc-from if it's an image, or null.
     */
    // `findImageElement` is shared between adapters; lives in core's
    // `layout-painter/imageLayout.ts` next to the rest of the rendered-
    // image hit-test taxonomy (LAYOUT_IMAGE_CLASSES + pointerHitResolveImage).
    // useCallback wrapper keeps the prop-stable identity.
    const findImageElement = useCallback(
      (target: HTMLElement): HTMLElement | null => coreFindImageElement(target),
      []
    );

    /**
     * AbortController shared by every in-flight scroll's rAF chain. Aborted
     * on unmount or whenever a new scroll request supersedes the previous
     * one. Prevents writing scrollTop on a detached scroller, and prevents
     * a stale paint-settle from clobbering a fresh user-initiated scroll.
     */
    const scrollAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      return () => {
        scrollAbortRef.current?.abort();
        scrollAbortRef.current = null;
      };
    }, []);

    /**
     * Scroll pages to a ProseMirror position (handles virtualization via page shells).
     * @param forParaIdScroll — when true, use manual container scroll (reliable under CSS
     *   transform / zoom). Otherwise use `scrollIntoView` (legacy behavior for outline,
     *   bookmarks, etc.).
     */
    const scrollToPositionImpl = useCallback(
      (pmPos: number, forParaIdScroll = false) => {
        // Reject malformed input — pmPos must be a non-negative integer.
        // Without this, a string or float would be interpolated into the
        // [data-doc-from="..."] selector below and either crash with a
        // SyntaxError or escape the attribute (selector injection).
        if (!Number.isInteger(pmPos) || pmPos < 0) return;

        const pages = pagesContainerRef.current;
        if (!pages) return;

        // Abort any in-flight scroll's rAF chain — its paint-settle would
        // otherwise stomp on this fresh scroll target a few frames later.
        scrollAbortRef.current?.abort();
        const ac = new AbortController();
        scrollAbortRef.current = ac;
        const { signal } = ac;

        const queryPaintedStartEl = (): HTMLElement | null => findBodyPmAnchor(pages, pmPos);

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
          const targetEl = queryPaintedStartEl();
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
            const painted = queryPaintedStartEl();
            if (painted) painted.scrollIntoView(smoothScroll);
          }, signal);
          return;
        }

        const scroller = getScrollContainer() ?? findVerticalScrollParentOrRoot(pages);

        const scrollPaintedTargetInstant = (): boolean => {
          const targetEl = queryPaintedStartEl();
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
          const painted = queryPaintedStartEl();
          if (painted) {
            scrollElementCenterIntoContainer(painted, scroller, 'instant');
          } else {
            scrollPaintedTargetInstant();
          }
        }, signal);
      },
      [layout, blocks, measures, getScrollContainer]
    );

    // 1-indexed pageNumber. Prefers scrolling to the page's first PM-anchored
    // fragment so virtualization is handled by scrollToPositionImpl. Falls
    // back to the page shell directly when no fragment carries docFrom
    // (e.g. a page containing only a continuation of a long paragraph or a
    // floating image without a PM anchor).
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
      [layout, scrollToPositionImpl]
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
        // fights the in-flight scroll. Reuses the same AbortController so
        // a superseding scroll cancels this too.
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
      [scrollToPositionImpl]
    );

    /**
     * Handle mousedown on pages - start selection or drag.
     */
    const handlePagesMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (!hiddenPMRef.current) return;

        // Right-click: prevent default to stop Firefox from resetting selection,
        // but don't process our selection logic
        if (e.button === 2) {
          e.preventDefault();
          return;
        }

        if (e.button !== 0) return; // Only handle left click

        // Hide table insert button on any mousedown
        setTableInsertButton(null);
        clearTableInsertTimer();

        // Prevent default browser navigation for hyperlink clicks,
        // but let the rest of the handler run for cursor placement and drag selection.
        // The popup is shown in handlePagesClick (on mouseup) instead.
        const anchorEl = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (anchorEl) {
          e.preventDefault(); // Prevent navigation only
        }

        if (readOnly) return;

        // When in HF edit mode, clicks outside header/footer area close the HF editor
        if (hfEditMode && onBodyClick) {
          const target = e.target as HTMLElement;
          const isInHfArea =
            target.closest('.layout-page-header') ||
            target.closest('.layout-page-footer') ||
            target.closest('.hf-inline-editor');
          if (!isInHfArea) {
            e.preventDefault();
            e.stopPropagation();
            onBodyClick();
            return;
          }
        }

        // In normal mode, clicks in header/footer area should place cursor at
        // start of body content, not inside header/footer (matches Word/Google Docs)
        if (!hfEditMode) {
          const target = e.target as HTMLElement;
          const isInHfArea =
            target.closest('.layout-page-header') || target.closest('.layout-page-footer');
          if (isInHfArea) {
            e.preventDefault();
            // Place cursor at start of body content
            if (hiddenPMRef.current) {
              hiddenPMRef.current.setSelection(0);
              hiddenPMRef.current.focus();
              setIsFocused(true);
            }
            return;
          }
        }

        // Column resize: intercept clicks on resize handles
        const target = e.target as HTMLElement;
        if (target.classList.contains('layout-table-resize-handle')) {
          e.preventDefault();
          e.stopPropagation();
          isResizingColumnRef.current = true;
          resizeStartXRef.current = e.clientX;
          resizeHandleRef.current = target;
          target.classList.add('dragging');

          const colIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
          resizeColumnIndexRef.current = colIndex;
          resizeTablePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);

          // Get current column widths from the ProseMirror doc
          const view = hiddenPMRef.current.getView();
          if (view) {
            const $pos = view.state.doc.resolve(resizeTablePmStartRef.current + 1);
            for (let d = $pos.depth; d >= 0; d--) {
              const node = $pos.node(d);
              if (node.type.name === 'table') {
                const widths = node.attrs.columnWidths as number[] | null;
                if (
                  widths &&
                  widths[colIndex] !== undefined &&
                  widths[colIndex + 1] !== undefined
                ) {
                  resizeOrigWidthsRef.current = {
                    left: widths[colIndex],
                    right: widths[colIndex + 1],
                  };
                }
                break;
              }
            }
          }
          return;
        }

        // Row resize: intercept clicks on row resize handles or bottom edge handle
        if (
          target.classList.contains('layout-table-row-resize-handle') ||
          target.classList.contains('layout-table-edge-handle-bottom')
        ) {
          e.preventDefault();
          e.stopPropagation();
          isResizingRowRef.current = true;
          resizeStartYRef.current = e.clientY;
          resizeRowHandleRef.current = target;
          resizeRowIsEdgeRef.current = target.dataset.isEdge === 'bottom';
          target.classList.add('dragging');

          const rowIndex = parseInt(target.dataset.rowIndex ?? '0', 10);
          resizeRowIndexRef.current = rowIndex;
          resizeRowTablePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);

          // Get current row height from ProseMirror doc
          const view = hiddenPMRef.current.getView();
          if (view) {
            const $pos = view.state.doc.resolve(resizeRowTablePmStartRef.current + 1);
            for (let d = $pos.depth; d >= 0; d--) {
              const node = $pos.node(d);
              if (node.type.name === 'table') {
                let rowNode: typeof node | null = null;
                let idx = 0;
                node.forEach((child) => {
                  if (idx === rowIndex) rowNode = child;
                  idx++;
                });
                if (rowNode) {
                  const height = (rowNode as typeof node).attrs.height as number | null;
                  if (height) {
                    resizeRowOrigHeightRef.current = height;
                  } else {
                    // Estimate from rendered height: find the row element
                    const tableEl = target.closest('.layout-table');
                    const rowEl = tableEl?.querySelector(`[data-row-index="${rowIndex}"]`);
                    const renderedHeight = rowEl
                      ? (rowEl as HTMLElement).getBoundingClientRect().height
                      : 30;
                    resizeRowOrigHeightRef.current = Math.round(renderedHeight * 15);
                  }
                }
                break;
              }
            }
          }
          return;
        }

        // Right edge resize: intercept clicks on right edge handle
        if (target.classList.contains('layout-table-edge-handle-right')) {
          e.preventDefault();
          e.stopPropagation();
          isResizingRightEdgeRef.current = true;
          resizeRightEdgeStartXRef.current = e.clientX;
          resizeRightEdgeHandleRef.current = target;
          target.classList.add('dragging');

          const colIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
          resizeRightEdgeColIndexRef.current = colIndex;
          resizeRightEdgePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);

          // Get current last column width from ProseMirror doc
          const view = hiddenPMRef.current.getView();
          if (view) {
            const $pos = view.state.doc.resolve(resizeRightEdgePmStartRef.current + 1);
            for (let d = $pos.depth; d >= 0; d--) {
              const node = $pos.node(d);
              if (node.type.name === 'table') {
                const widths = node.attrs.columnWidths as number[] | null;
                if (widths && widths[colIndex] !== undefined) {
                  resizeRightEdgeOrigWidthRef.current = widths[colIndex];
                }
                break;
              }
            }
          }
          return;
        }

        // Check if the click target is an image element
        const imageEl = findImageElement(target);
        if (imageEl) {
          e.preventDefault();
          e.stopPropagation();

          const docFrom = imageEl.dataset.docFrom;
          if (docFrom !== undefined) {
            const pos = parseInt(docFrom, 10);
            hiddenPMRef.current.setNodeSelection(pos);
            setSelectedImageInfo(buildImageSelectionInfo(imageEl, pos));
            setSelectionGeometry([]);
            setCaretPosition(null);
          }

          hiddenPMRef.current.focus();
          setIsFocused(true);
          return;
        }

        // Clicking outside an image clears image selection
        setSelectedImageInfo(null);

        e.preventDefault(); // Prevent native text selection

        const pmPos = getPositionFromMouse(e.clientX, e.clientY);

        if (pmPos !== null) {
          // Check if click is inside a table cell - track for potential cell drag selection
          const cellPos = findCellPosFromPmPos(pmPos);
          cellDragAnchorPosRef.current = cellPos;
          isCellDraggingRef.current = false;
          cellDragLastPmPosRef.current = null;
          cellDragOverflowXRef.current = null;

          // Start dragging
          isDraggingRef.current = true;
          dragAnchorRef.current = pmPos;

          // Set initial selection (collapsed)
          hiddenPMRef.current.setSelection(pmPos);
        } else {
          // Clicked outside content - move to end
          cellDragAnchorPosRef.current = null;
          isCellDraggingRef.current = false;
          const view = hiddenPMRef.current.getView();
          if (view) {
            const endPos = Math.max(0, view.state.doc.content.size - 1);
            hiddenPMRef.current.setSelection(endPos);
            dragAnchorRef.current = endPos;
            isDraggingRef.current = true;
          }
        }

        // Focus the hidden editor
        hiddenPMRef.current.focus();
        setIsFocused(true);
      },
      [
        getPositionFromMouse,
        findCellPosFromPmPos,
        readOnly,
        hfEditMode,
        onBodyClick,
        zoom,
        onHyperlinkClick,
        clearTableInsertTimer,
      ]
    );

    // Drag auto-scroll: scrolls when dragging near viewport edges
    const dragAutoScrollCallbackRef = useCallback((cx: number, cy: number) => {
      dragExtendRef.current(cx, cy);
    }, []);
    const { updateMousePosition: updateDragScroll, stopAutoScroll: stopDragAutoScroll } =
      useDragAutoScroll({
        pagesContainerRef,
        onScrollExtendSelection: dragAutoScrollCallbackRef,
      });

    // Wire up the drag-extend callback after getPositionFromMouse is available
    dragExtendRef.current = (cx: number, cy: number) => {
      if (!isDraggingRef.current || dragAnchorRef.current === null) return;
      if (!hiddenPMRef.current) return;
      const pmPos = getPositionFromMouse(cx, cy);
      if (pmPos === null) return;
      hiddenPMRef.current.setSelection(dragAnchorRef.current, pmPos);
    };

    /**
     * Handle mousemove - extend selection during drag.
     */
    const handleMouseMove = useCallback(
      (e: MouseEvent) => {
        // Column resize drag
        if (isResizingColumnRef.current) {
          e.preventDefault();
          const delta = e.clientX - resizeStartXRef.current;
          // Move the handle visually
          if (resizeHandleRef.current) {
            const origLeft = parseFloat(resizeHandleRef.current.style.left);
            resizeHandleRef.current.style.left = `${origLeft + delta}px`;
            resizeStartXRef.current = e.clientX;

            // Update stored widths (convert pixel delta to twips: 1px ≈ 15 twips at 96dpi)
            const deltaTwips = Math.round(delta * 15);
            const minWidth = 300; // ~0.2 inches minimum
            const newLeft = resizeOrigWidthsRef.current.left + deltaTwips;
            const newRight = resizeOrigWidthsRef.current.right - deltaTwips;
            if (newLeft >= minWidth && newRight >= minWidth) {
              resizeOrigWidthsRef.current = { left: newLeft, right: newRight };
            }
          }
          return;
        }

        // Row resize drag
        if (isResizingRowRef.current) {
          e.preventDefault();
          const delta = e.clientY - resizeStartYRef.current;
          if (resizeRowHandleRef.current) {
            const origTop = parseFloat(resizeRowHandleRef.current.style.top);
            resizeRowHandleRef.current.style.top = `${origTop + delta}px`;
            resizeStartYRef.current = e.clientY;

            // Update stored height (convert pixel delta to twips)
            const deltaTwips = Math.round(delta * 15);
            const minHeight = 200; // ~0.14 inches minimum
            const newHeight = resizeRowOrigHeightRef.current + deltaTwips;
            if (newHeight >= minHeight) {
              resizeRowOrigHeightRef.current = newHeight;
            }
          }
          return;
        }

        // Right edge resize drag
        if (isResizingRightEdgeRef.current) {
          e.preventDefault();
          const delta = e.clientX - resizeRightEdgeStartXRef.current;
          if (resizeRightEdgeHandleRef.current) {
            const origLeft = parseFloat(resizeRightEdgeHandleRef.current.style.left);
            resizeRightEdgeHandleRef.current.style.left = `${origLeft + delta}px`;
            resizeRightEdgeStartXRef.current = e.clientX;

            // Update stored width (convert pixel delta to twips)
            const deltaTwips = Math.round(delta * 15);
            const minWidth = 300; // ~0.2 inches minimum
            const newWidth = resizeRightEdgeOrigWidthRef.current + deltaTwips;
            if (newWidth >= minWidth) {
              resizeRightEdgeOrigWidthRef.current = newWidth;
            }
          }
          return;
        }

        if (!isDraggingRef.current || dragAnchorRef.current === null) return;
        if (!hiddenPMRef.current || !pagesContainerRef.current) return;

        // Auto-scroll when dragging near viewport edges
        updateDragScroll(e.clientX, e.clientY);

        const pmPos = getPositionFromMouse(e.clientX, e.clientY);
        if (pmPos === null) return;

        // Dragging in table cells: text selection first, cell selection when crossing boundary
        if (cellDragAnchorPosRef.current !== null) {
          // If already in cell-drag mode, continue updating cell selection
          if (isCellDraggingRef.current) {
            const currentCellPos = findCellPosFromPmPos(pmPos);
            if (currentCellPos !== null) {
              hiddenPMRef.current.setCellSelection(cellDragAnchorPosRef.current, currentCellPos);
              return;
            }
          }

          // Switch to cell selection when drag crosses into a different cell
          const currentCellPos = findCellPosFromPmPos(pmPos);
          if (currentCellPos !== null && currentCellPos !== cellDragAnchorPosRef.current) {
            isCellDraggingRef.current = true;
            hiddenPMRef.current.setCellSelection(cellDragAnchorPosRef.current, currentCellPos);
            cellDragOverflowXRef.current = null;
            return;
          }

          // Detect when text selection has maxed out within the cell:
          // If pmPos stops changing but mouse keeps moving, user has dragged past text content
          if (cellDragLastPmPosRef.current !== null && pmPos === cellDragLastPmPosRef.current) {
            if (cellDragOverflowXRef.current === null) {
              cellDragOverflowXRef.current = e.clientX;
            } else if (
              Math.abs(e.clientX - cellDragOverflowXRef.current) >= CELL_SELECT_OVERFLOW_PX
            ) {
              // Overflow threshold reached — select the entire cell
              isCellDraggingRef.current = true;
              hiddenPMRef.current.setCellSelection(
                cellDragAnchorPosRef.current,
                cellDragAnchorPosRef.current
              );
              cellDragOverflowXRef.current = null;
              return;
            }
          } else {
            // Position is still advancing — reset overflow tracking
            cellDragOverflowXRef.current = null;
            cellDragLastPmPosRef.current = pmPos;
          }
        }

        // Regular text selection drag (within cell or outside tables)
        const anchor = dragAnchorRef.current;
        hiddenPMRef.current.setSelection(anchor, pmPos);
      },
      [getPositionFromMouse, findCellPosFromPmPos, updateDragScroll]
    );

    /**
     * Handle mouseup - end drag selection.
     */
    const handleMouseUp = useCallback(() => {
      // Commit column resize
      if (isResizingColumnRef.current) {
        isResizingColumnRef.current = false;
        if (resizeHandleRef.current) {
          resizeHandleRef.current.classList.remove('dragging');
          resizeHandleRef.current = null;
        }

        // Update ProseMirror document with new column widths
        const view = hiddenPMRef.current?.getView();
        if (view) {
          const docFrom = resizeTablePmStartRef.current;
          const colIdx = resizeColumnIndexRef.current;
          const { left: newLeft, right: newRight } = resizeOrigWidthsRef.current;

          // Find the table node and update columnWidths + cell widths
          const $pos = view.state.doc.resolve(docFrom + 1);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'table') {
              const tablePos = $pos.before(d);
              const tr = view.state.tr;
              const widths = [...(node.attrs.columnWidths as number[])];
              widths[colIdx] = newLeft;
              widths[colIdx + 1] = newRight;

              // Update table columnWidths attr
              tr.setNodeMarkup(tablePos, undefined, {
                ...node.attrs,
                columnWidths: widths,
              });

              // Update cell width attrs in each row
              let rowOffset = tablePos + 1;
              node.forEach((row) => {
                let cellOffset = rowOffset + 1;
                let cellColIdx = 0;
                row.forEach((cell) => {
                  const colspan = (cell.attrs.colspan as number) || 1;
                  if (cellColIdx === colIdx || cellColIdx === colIdx + 1) {
                    const newWidth = cellColIdx === colIdx ? newLeft : newRight;
                    tr.setNodeMarkup(tr.mapping.map(cellOffset), undefined, {
                      ...cell.attrs,
                      width: newWidth,
                      widthType: 'dxa',
                      colwidth: null,
                    });
                  }
                  cellOffset += cell.nodeSize;
                  cellColIdx += colspan;
                });
                rowOffset += row.nodeSize;
              });

              view.dispatch(tr);
              break;
            }
          }
        }
        return;
      }

      // Commit row resize
      if (isResizingRowRef.current) {
        isResizingRowRef.current = false;
        if (resizeRowHandleRef.current) {
          resizeRowHandleRef.current.classList.remove('dragging');
          resizeRowHandleRef.current = null;
        }

        const view = hiddenPMRef.current?.getView();
        if (view) {
          const docFrom = resizeRowTablePmStartRef.current;
          const rowIdx = resizeRowIndexRef.current;
          const newHeight = resizeRowOrigHeightRef.current;

          const $pos = view.state.doc.resolve(docFrom + 1);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'table') {
              const tablePos = $pos.before(d);
              const tr = view.state.tr;

              // Walk to the target row
              let rowOffset = tablePos + 1;
              let idx = 0;
              node.forEach((row) => {
                if (idx === rowIdx) {
                  tr.setNodeMarkup(tr.mapping.map(rowOffset), undefined, {
                    ...row.attrs,
                    height: newHeight,
                    heightRule: 'atLeast',
                  });
                }
                rowOffset += row.nodeSize;
                idx++;
              });

              view.dispatch(tr);
              break;
            }
          }
        }
        return;
      }

      // Commit right edge resize
      if (isResizingRightEdgeRef.current) {
        isResizingRightEdgeRef.current = false;
        if (resizeRightEdgeHandleRef.current) {
          resizeRightEdgeHandleRef.current.classList.remove('dragging');
          resizeRightEdgeHandleRef.current = null;
        }

        const view = hiddenPMRef.current?.getView();
        if (view) {
          const docFrom = resizeRightEdgePmStartRef.current;
          const colIdx = resizeRightEdgeColIndexRef.current;
          const newWidth = resizeRightEdgeOrigWidthRef.current;

          const $pos = view.state.doc.resolve(docFrom + 1);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'table') {
              const tablePos = $pos.before(d);
              const tr = view.state.tr;

              // Update columnWidths — only change last column
              const widths = [...(node.attrs.columnWidths as number[])];
              widths[colIdx] = newWidth;

              tr.setNodeMarkup(tablePos, undefined, {
                ...node.attrs,
                columnWidths: widths,
              });

              // Update cell width attrs in the last column of each row
              let rowOffset = tablePos + 1;
              node.forEach((row) => {
                let cellOffset = rowOffset + 1;
                let cellColIdx = 0;
                row.forEach((cell) => {
                  const colspan = (cell.attrs.colspan as number) || 1;
                  if (cellColIdx === colIdx) {
                    tr.setNodeMarkup(tr.mapping.map(cellOffset), undefined, {
                      ...cell.attrs,
                      width: newWidth,
                      widthType: 'dxa',
                      colwidth: null,
                    });
                  }
                  cellOffset += cell.nodeSize;
                  cellColIdx += colspan;
                });
                rowOffset += row.nodeSize;
              });

              view.dispatch(tr);
              break;
            }
          }
        }
        return;
      }

      isDraggingRef.current = false;
      isCellDraggingRef.current = false;
      cellDragLastPmPosRef.current = null;
      cellDragOverflowXRef.current = null;
      stopDragAutoScroll();
      // Keep dragAnchorRef for potential shift-click extension
    }, [stopDragAutoScroll]);

    // Add global mouse event listeners for drag selection
    useEffect(() => {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, [handleMouseMove, handleMouseUp]);

    /**
     * Handle mousemove on pages to show table row/column insert buttons.
     * Detects proximity to table row/column boundaries and shows a floating "+" button.
     */
    const handlePagesMouseMove = useCallback(
      (e: React.MouseEvent) => {
        // Skip during drags / resizes
        if (
          readOnly ||
          isDraggingRef.current ||
          isResizingColumnRef.current ||
          isResizingRowRef.current ||
          isResizingRightEdgeRef.current ||
          isCellDraggingRef.current
        )
          return;

        const pagesEl = pagesContainerRef.current;
        if (!pagesEl) return;

        const hit = detectTableInsertHover({
          mouseX: e.clientX,
          mouseY: e.clientY,
          pagesContainer: pagesEl,
          target: e.target as HTMLElement,
          hfEditMode: hfEditMode ?? null,
        });

        if (!hit) {
          // Schedule a delayed hide so brief moves between cells don't flicker
          // the button. The hit-test returns null for both "no nearby table"
          // and "near table but not over a row/column"; both want the same
          // delayed-hide UX.
          if (!tableInsertHideTimerRef.current) {
            tableInsertHideTimerRef.current = setTimeout(() => {
              setTableInsertButton(null);
              tableInsertHideTimerRef.current = null;
            }, TABLE_INSERT_HIDE_DELAY);
          }
          return;
        }

        const viewportEl = pagesEl.parentElement;
        if (!viewportEl) return;
        const viewportRect = viewportEl.getBoundingClientRect();

        setTableInsertButton({
          type: hit.type,
          x: hit.clientX - viewportRect.left,
          y: hit.clientY - viewportRect.top,
          cellPmPos: hit.cellPmPos,
        });
        clearTableInsertTimer();
      },
      [readOnly, clearTableInsertTimer, hfEditMode]
    );

    /**
     * Handle table insert button click — set selection to target cell, then insert.
     */
    const handleTableInsertClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!tableInsertButton || !hiddenPMRef.current) return;

        const view = hiddenPMRef.current.getView();
        if (!view) return;

        const { type, cellPmPos } = tableInsertButton;

        // Set selection inside the target cell
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPmPos + 1));
        view.dispatch(tr);

        // Dispatch the appropriate insert command
        if (type === 'row') {
          addRowBelow(view.state, view.dispatch);
        } else {
          addColumnRight(view.state, view.dispatch);
        }

        setTableInsertButton(null);
        hiddenPMRef.current.focus();
      },
      [tableInsertButton]
    );

    /**
     * Handle click on pages container (for double-click word selection).
     */
    const handlePagesClick = useCallback(
      (e: React.MouseEvent) => {
        // Handle hyperlink clicks (single-click only, not drag-to-select)
        const anchorEl = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (anchorEl) {
          e.preventDefault();
          const href = anchorEl.getAttribute('href') || '';
          if (href.startsWith('#')) {
            // Internal bookmark — navigate within document
            const bookmarkName = href.substring(1);
            if (bookmarkName && hiddenPMRef.current) {
              const view = hiddenPMRef.current.getView();
              if (view) {
                let targetPos: number | null = null;
                view.state.doc.descendants((node, pos) => {
                  if (targetPos !== null) return false;
                  if (node.type.name === 'paragraph') {
                    const bookmarks = node.attrs.bookmarks as
                      | Array<{ id: number; name: string }>
                      | undefined;
                    if (bookmarks?.some((b) => b.name === bookmarkName)) {
                      targetPos = pos;
                      return false;
                    }
                  }
                });
                if (targetPos !== null) {
                  scrollToPositionImpl(targetPos);
                  hiddenPMRef.current.setSelection(targetPos + 1);
                }
              }
            }
          } else if (onHyperlinkClick) {
            // External hyperlink — show popup only if not a drag-to-select
            const view = hiddenPMRef.current?.getView();
            const hasRangeSelection = view && view.state.selection.from !== view.state.selection.to;
            if (!hasRangeSelection) {
              const displayText = anchorEl.textContent || '';
              const tooltip = anchorEl.getAttribute('title') || undefined;
              const anchorRect = anchorEl.getBoundingClientRect();
              onHyperlinkClick({ href, displayText, tooltip, anchorRect });
            }
          }
          // External links: already handled by mousedown, just prevent default
          return;
        }

        // Double-click on header/footer area triggers editing mode
        if (e.detail === 2 && onHeaderFooterDoubleClick) {
          const target = e.target as HTMLElement;
          const headerEl = target.closest('.layout-page-header');
          const footerEl = target.closest('.layout-page-footer');
          if (headerEl || footerEl) {
            const pageEl = target.closest('[data-page-number]') as HTMLElement | null;
            const pageNum = pageEl ? Number(pageEl.dataset.pageNumber) : 1;
            if (headerEl) {
              e.preventDefault();
              e.stopPropagation();
              onHeaderFooterDoubleClick('header', pageNum);
              return;
            }
            if (footerEl) {
              e.preventDefault();
              e.stopPropagation();
              onHeaderFooterDoubleClick('footer', pageNum);
              return;
            }
          }
        }

        // Double-click: select entire cell (CellSelection) if in table, otherwise word selection
        if (e.detail === 2 && hiddenPMRef.current) {
          const pmPos = getPositionFromMouse(e.clientX, e.clientY);
          if (pmPos !== null) {
            // If inside a table cell, select the entire cell
            const cellPos = findCellPosFromPmPos(pmPos);
            if (cellPos !== null) {
              e.preventDefault();
              e.stopPropagation();
              hiddenPMRef.current.setCellSelection(cellPos, cellPos);
              return;
            }

            const view = hiddenPMRef.current.getView();
            if (view) {
              const { doc } = view.state;
              const $pos = doc.resolve(pmPos);
              const parent = $pos.parent;

              // Find word boundaries
              if (parent.isTextblock) {
                const text = parent.textContent;
                const offset = $pos.parentOffset;
                const [start, end] = findWordBoundaries(text, offset);

                // Convert to absolute positions
                const absStart = $pos.start() + start;
                const absEnd = $pos.start() + end;

                if (absStart < absEnd) {
                  hiddenPMRef.current.setSelection(absStart, absEnd);
                }
              }
            }
          }
        }
        // Triple-click for paragraph selection
        if (e.detail === 3 && hiddenPMRef.current) {
          const pmPos = getPositionFromMouse(e.clientX, e.clientY);
          if (pmPos !== null) {
            const view = hiddenPMRef.current.getView();
            if (view) {
              const { doc } = view.state;
              const $pos = doc.resolve(pmPos);

              // Find paragraph start and end
              const paragraphStart = $pos.start($pos.depth);
              const paragraphEnd = $pos.end($pos.depth);

              hiddenPMRef.current.setSelection(paragraphStart, paragraphEnd);
            }
          }
        }
      },
      [getPositionFromMouse, onHeaderFooterDoubleClick, onHyperlinkClick]
    );

    /**
     * Handle right-click on pages — set/preserve selection and show context menu.
     *
     * If the right-click target resolves to an image node (any of the three
     * rendering paths — page-floating layer, block image container, or inline
     * `<img>`), look up the underlying PM image node and pass its position +
     * current wrap type to the host so an image-specific menu can take over.
     */
    const handlePagesContextMenu = useCallback(
      (e: React.MouseEvent) => {
        if (!onContextMenu) return; // No handler, let browser default

        e.preventDefault();

        const view = hiddenPMRef.current?.getView();
        if (!view) return;

        // Try to detect an image right-click first.
        //
        // Two paths route here. The cheap one — clicking on a non-selected
        // image — surfaces the image element as `e.target` and we walk up.
        // The harder one is when PM already has a NodeSelection on the image
        // (because the user clicked it once first): PM mounts a selection
        // overlay that swallows pointer events, so `e.target` lands on the
        // overlay, not on `.layout-page-floating-image` etc. Fall through to
        // the current selection in that case.
        type ImageInfo = {
          pos: number;
          wrapType: WrapType;
          cssFloat?: 'left' | 'right' | 'none' | null;
          inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
        };
        const readImageNodeAt = (pos: number): ImageInfo | null => {
          const node = view.state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'image') return null;
          const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
          const cssFloat = node.attrs.cssFloat as ImageInfo['cssFloat'];
          return { pos, wrapType, cssFloat };
        };

        let imageInfo: ImageInfo | null = null;
        const hit = pointerHitResolveImage(e.target);
        if (hit) {
          imageInfo = readImageNodeAt(hit.pos);
          if (imageInfo) {
            imageInfo.inlinePositionEmu = captureInlinePositionEmu(hit.imageEl, zoom);
          }
        }
        if (!imageInfo) {
          const sel = view.state.selection;
          if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
            imageInfo = readImageNodeAt(sel.from);
            if (imageInfo) {
              const inlineEl = pagesContainerRef.current?.querySelector(
                `.layout-run-image[data-doc-from="${sel.from}"]`
              ) as HTMLElement | null;
              if (inlineEl) {
                imageInfo.inlinePositionEmu = captureInlinePositionEmu(inlineEl, zoom);
              }
            }
          }
        }

        const { from, to } = view.state.selection;
        const pmPos = getPositionFromMouse(e.clientX, e.clientY);

        // If the right-click is within the existing selection, keep it
        // Otherwise, move cursor to the right-click position
        if (pmPos !== null && (from === to || pmPos < from || pmPos > to)) {
          hiddenPMRef.current?.setSelection(pmPos);
          hiddenPMRef.current?.focus();
          setIsFocused(true);
        }

        // Read updated selection state after potential change
        const updatedState = hiddenPMRef.current?.getState();
        const hasSelection = updatedState
          ? updatedState.selection.from !== updatedState.selection.to
          : false;

        onContextMenu({
          x: e.clientX,
          y: e.clientY,
          hasSelection,
          image: imageInfo,
        });
      },
      // `zoom` is read inside `captureInlinePositionEmu` to convert post-
      // transform px deltas back to authored space. Listing it explicitly
      // even though `getPositionFromMouse` already invalidates on zoom — the
      // dep is direct, not transitive, so it survives a refactor of the
      // sibling closure.
      [onContextMenu, getPositionFromMouse, zoom]
    );

    /**
     * Handle focus on container - redirect to hidden PM.
     */
    const handleContainerFocus = useCallback(
      (e: React.FocusEvent) => {
        if (readOnly) return;
        // Don't steal focus from sidebar inputs (textareas, inputs, buttons)
        const target = e.target as HTMLElement;
        if (target.closest('.docx-comments-sidebar') || target.closest('.docx-unified-sidebar'))
          return;
        hiddenPMRef.current?.focus();
        setIsFocused(true);
      },
      [readOnly]
    );

    /**
     * Handle blur from container.
     */
    const handleContainerBlur = useCallback((e: React.FocusEvent) => {
      // Check if focus is moving to hidden PM or staying within container
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget && containerRef.current?.contains(relatedTarget)) {
        return; // Focus staying within editor
      }
      // Keep selection visible when focus moves to toolbar or dropdown portals
      if (
        relatedTarget?.closest(
          '[role="toolbar"], [data-radix-popper-content-wrapper], [data-radix-select-content], .docx-table-options-dropdown'
        )
      ) {
        return;
      }
      setIsFocused(false);
    }, []);

    /**
     * Handle image resize from the overlay.
     */
    const handleImageResize = useCallback((pmPos: number, newWidth: number, newHeight: number) => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return;

      try {
        const node = view.state.doc.nodeAt(pmPos);
        if (!node || node.type.name !== 'image') return;

        const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
          ...node.attrs,
          width: newWidth,
          height: newHeight,
        });
        view.dispatch(tr);

        // Re-select the image after resize
        hiddenPMRef.current?.setNodeSelection(pmPos);
      } catch {
        // Position may have changed during resize
      }
    }, []);

    /**
     * Handle image resize start - prevent text selection during resize.
     */
    const handleImageResizeStart = useCallback(() => {
      isImageInteractingRef.current = true;
    }, []);

    /**
     * Handle image resize end.
     */
    const handleImageResizeEnd = useCallback(() => {
      isImageInteractingRef.current = false;
    }, []);

    /**
     * Handle image drag-to-move: move image node from its current position
     * to the drop position determined by mouse coordinates.
     */
    const handleImageDragMove = useCallback(
      (pmPos: number, clientX: number, clientY: number) => {
        const view = hiddenPMRef.current?.getView();
        if (!view) return;

        try {
          const node = view.state.doc.nodeAt(pmPos);
          if (!node || node.type.name !== 'image') return;

          const isFloating =
            node.attrs.displayMode === 'float' ||
            (node.attrs.wrapType &&
              ['square', 'tight', 'through'].includes(node.attrs.wrapType as string));

          if (isFloating) {
            // For floating images: update position attributes so the image
            // moves to the drop point while staying floating.
            // Find the page under the drop point
            const pages = pagesContainerRef.current?.querySelectorAll('.layout-page');
            if (!pages || pages.length === 0) return;

            let contentEl: HTMLElement | null = null;
            for (const page of pages) {
              const rect = page.getBoundingClientRect();
              if (clientY >= rect.top && clientY <= rect.bottom) {
                contentEl = page.querySelector('.layout-page-content') as HTMLElement;
                break;
              }
            }
            if (!contentEl) {
              // Fallback to last page if below all pages
              contentEl = pages[pages.length - 1].querySelector(
                '.layout-page-content'
              ) as HTMLElement;
            }
            if (!contentEl) return;

            const contentRect = contentEl.getBoundingClientRect();
            // Convert drop coordinates to content-area-relative pixels
            const dropX = (clientX - contentRect.left) / zoom;
            const dropY = (clientY - contentRect.top) / zoom;
            const hOffsetEmu = pixelsToEmu(dropX);
            const vOffsetEmu = pixelsToEmu(dropY);

            const newPosition = {
              horizontal: { posOffset: hOffsetEmu, relativeTo: 'margin' },
              vertical: { posOffset: vOffsetEmu, relativeTo: 'margin' },
            };

            const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
              ...node.attrs,
              position: newPosition,
            });
            view.dispatch(tr);
            hiddenPMRef.current?.setNodeSelection(pmPos);
          } else {
            // For inline images: move to the drop text position
            const dropPos = getPositionFromMouse(clientX, clientY);
            if (dropPos === null) return;
            if (dropPos === pmPos || dropPos === pmPos + 1) return;

            let tr = view.state.tr;

            if (dropPos <= pmPos) {
              tr = tr.delete(pmPos, pmPos + node.nodeSize);
              tr = tr.insert(dropPos, node);
              hiddenPMRef.current?.setNodeSelection(dropPos);
            } else {
              tr = tr.delete(pmPos, pmPos + node.nodeSize);
              const adjusted = dropPos - node.nodeSize;
              tr = tr.insert(Math.min(adjusted, tr.doc.content.size), node);
              hiddenPMRef.current?.setNodeSelection(Math.min(adjusted, tr.doc.content.size - 1));
            }

            view.dispatch(tr);
          }
        } catch {
          // Position may be invalid
        }
      },
      [getPositionFromMouse, zoom]
    );

    const handleImageDragStart = useCallback(() => {
      isImageInteractingRef.current = true;
    }, []);

    const handleImageDragEnd = useCallback(() => {
      isImageInteractingRef.current = false;
    }, []);

    /**
     * Handle keyboard events on container.
     * Most keyboard handling is done by ProseMirror, but we intercept
     * specific keys for navigation and ensure focus stays on hidden PM.
     */
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (readOnly) return;
        // Ensure hidden PM is focused if user types
        if (!hiddenPMRef.current?.isFocused()) {
          hiddenPMRef.current?.focus();
          setIsFocused(true);
        }

        // Prevent space from scrolling the container - let PM handle it as text input.
        // During IME composition, let the browser handle space natively to avoid
        // duplicating the final composed character (e.g., Korean Hangul).
        if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          const view = hiddenPMRef.current?.getView();
          if (view) {
            // Route through handleTextInput so plugins (suggestion mode) can intercept
            const { from, to } = view.state.selection;
            const handled = view.someProp('handleTextInput', (f: Function) =>
              f(view, from, to, ' ')
            );
            if (!handled) {
              view.dispatch(view.state.tr.insertText(' '));
            }
          }
          return;
        }

        // PageUp/PageDown - let container handle scrolling
        if (['PageUp', 'PageDown'].includes(e.key) && !e.metaKey && !e.ctrlKey) {
          // Let PM handle the cursor movement first
          // If PM doesn't handle it (at bounds), the container will scroll
        }

        // Cmd/Ctrl+Home - scroll to top and move cursor to start
        if (e.key === 'Home' && (e.metaKey || e.ctrlKey)) {
          const sc = getScrollContainer();
          if (sc) sc.scrollTop = 0;
        }

        // Cmd/Ctrl+End - scroll to bottom and move cursor to end
        if (e.key === 'End' && (e.metaKey || e.ctrlKey)) {
          const sc = getScrollContainer();
          if (sc) sc.scrollTop = sc.scrollHeight;
        }
      },
      [readOnly, getScrollContainer]
    );

    /**
     * Handle mousedown on container (outside pages).
     */
    const handleContainerMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (readOnly) return;
        // Don't steal focus from sidebar inputs
        if (
          (e.target as HTMLElement).closest('.docx-comments-sidebar') ||
          (e.target as HTMLElement).closest('.docx-unified-sidebar')
        )
          return;
        // Focus hidden PM if clicking outside pages area
        if (!hiddenPMRef.current?.isFocused()) {
          hiddenPMRef.current?.focus();
          setIsFocused(true);
        }
      },
      [readOnly]
    );

    // =========================================================================
    // Initial Layout
    // =========================================================================

    /**
     * Run initial layout when document or view changes.
     */
    const handleEditorViewReady = useCallback(
      (view: EditorView) => {
        runLayoutPipeline(view.state);
        updateSelectionOverlay(view.state);

        // Auto-focus the editor so the user can start typing immediately
        if (!readOnly) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            view.focus();
            setIsFocused(true);
          });
        }
      },
      [runLayoutPipeline, updateSelectionOverlay, readOnly]
    );

    // Re-layout when web fonts finish loading to fix measurements that were
    // computed against fallback fonts during initial render.
    // Uses FontFaceSet.onloadingdone to detect when new fonts complete loading.
    useEffect(() => {
      const handleFontsLoaded = () => {
        const view = hiddenPMRef.current?.getView();
        if (view) {
          // Clear all cached measurements — font metrics have changed
          resetCanvasContext();
          clearAllCaches();
          runLayoutPipeline(view.state);
          updateSelectionOverlay(view.state);
        }
      };

      // Listen for font loading completion events
      window.document.fonts.addEventListener('loadingdone', handleFontsLoaded);
      return () => {
        window.document.fonts.removeEventListener('loadingdone', handleFontsLoaded);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-layout when header/footer content changes (e.g., after HF editor save).
    // runLayoutPipeline includes headerContent/footerContent in its deps, but it
    // only runs when explicitly called — this effect triggers it.
    const headerFooterEpochRef = useRef(0);
    useEffect(() => {
      // Skip the initial render — handleEditorViewReady already does the first layout
      if (headerFooterEpochRef.current === 0) {
        headerFooterEpochRef.current = 1;
        return;
      }
      const view = hiddenPMRef.current?.getView();
      if (view) {
        runLayoutPipeline(view.state);
      }
    }, [
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
      runLayoutPipeline,
    ]);

    // Re-compute selection overlay when the container resizes.
    // Page elements shift during window resize (centering, scrollbar changes),
    // causing caret/selection coordinates to become stale.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver(() => {
        const state = hiddenPMRef.current?.getState();
        if (state) {
          updateSelectionOverlay(state);
        }
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [updateSelectionOverlay]);

    // =========================================================================
    // Imperative Handle
    // =========================================================================

    useImperativeHandle(
      ref,
      () => ({
        getDocument() {
          return hiddenPMRef.current?.getDocument() ?? null;
        },
        getState() {
          return hiddenPMRef.current?.getState() ?? null;
        },
        getView() {
          return hiddenPMRef.current?.getView() ?? null;
        },
        focus() {
          hiddenPMRef.current?.focus();
          setIsFocused(true);
        },
        blur() {
          hiddenPMRef.current?.blur();
          setIsFocused(false);
        },
        isFocused() {
          return hiddenPMRef.current?.isFocused() ?? false;
        },
        dispatch(tr: Transaction) {
          hiddenPMRef.current?.dispatch(tr);
        },
        undo() {
          return hiddenPMRef.current?.undo() ?? false;
        },
        redo() {
          return hiddenPMRef.current?.redo() ?? false;
        },
        setSelection(anchor: number, head?: number) {
          hiddenPMRef.current?.setSelection(anchor, head);
        },
        getLayout() {
          return layout;
        },
        relayout() {
          const state = hiddenPMRef.current?.getState();
          if (state) {
            runLayoutPipeline(state);
          }
        },
        scrollToPosition: scrollToPositionImpl,
        scrollToParaId: scrollToParaIdImpl,
        scrollToPage: scrollToPageImpl,
      }),
      [layout, runLayoutPipeline, scrollToPositionImpl, scrollToParaIdImpl, scrollToPageImpl]
    );

    // Update selection overlay when layout changes
    // This is needed because handleEditorViewReady calls runLayoutPipeline which
    // sets layout asynchronously, so updateSelectionOverlay would return early
    // if layout is still null. This effect ensures we update once layout is ready.
    useEffect(() => {
      const state = hiddenPMRef.current?.getState();
      if (layout && state) {
        updateSelectionOverlay(state);
      }
    }, [layout, updateSelectionOverlay]);

    // Notify when ready
    // Notify when ready - use ref for callback to prevent infinite loops
    useEffect(() => {
      if (onReadyRef.current && hiddenPMRef.current) {
        onReadyRef.current({
          getDocument: () => hiddenPMRef.current?.getDocument() ?? null,
          getState: () => hiddenPMRef.current?.getState() ?? null,
          getView: () => hiddenPMRef.current?.getView() ?? null,
          focus: () => {
            hiddenPMRef.current?.focus();
            setIsFocused(true);
          },
          blur: () => {
            hiddenPMRef.current?.blur();
            setIsFocused(false);
          },
          isFocused: () => hiddenPMRef.current?.isFocused() ?? false,
          dispatch: (tr) => hiddenPMRef.current?.dispatch(tr),
          undo: () => hiddenPMRef.current?.undo() ?? false,
          redo: () => hiddenPMRef.current?.redo() ?? false,
          setSelection: (anchor, head) => hiddenPMRef.current?.setSelection(anchor, head),
          getLayout: () => layout,
          relayout: () => {
            const state = hiddenPMRef.current?.getState();
            if (state) {
              runLayoutPipeline(state);
            }
          },
          scrollToPosition: scrollToPositionImpl,
          scrollToParaId: scrollToParaIdImpl,
          scrollToPage: scrollToPageImpl,
        });
      }
    }, [layout, runLayoutPipeline, scrollToParaIdImpl, scrollToPageImpl]);
    // NOTE: onReady removed from dependencies - accessed via ref to prevent infinite loops

    // =========================================================================
    // Render
    // =========================================================================

    // Calculate total height for scroll
    const totalHeight = useMemo(() => {
      if (!layout) return DEFAULT_PAGE_HEIGHT_PX + 48;
      const numPages = layout.pages.length;
      const pagesHeight = layout.pages.reduce((sum, page) => sum + page.size.h, 0);
      return pagesHeight + (numPages - 1) * pageGap + 48;
    }, [layout, pageGap]);

    return (
      <div
        ref={containerRef}
        className={`ep-root paged-editor ${className ?? ''}`}
        style={{ ...containerStyles, ...style }}
        tabIndex={0}
        onFocus={handleContainerFocus}
        onBlur={handleContainerBlur}
        onKeyDown={handleKeyDown}
        onMouseDown={handleContainerMouseDown}
      >
        {/* Hidden ProseMirror for keyboard input */}
        <OffscreenEditorHost
          ref={hiddenPMRef}
          document={document}
          styles={styles}
          widthPx={contentWidth}
          readOnly={readOnly}
          onTransaction={handleTransaction}
          onSelectionChange={handleSelectionChange}
          externalPlugins={externalPlugins}
          extensionManager={extensionManager}
          onEditorViewReady={handleEditorViewReady}
          onKeyDown={handlePMKeyDown}
        />

        {/* Viewport for visible pages */}
        <div
          ref={viewportLayoutRef}
          style={{
            ...viewportStyles,
            minHeight: totalHeight,
            // Negative margin at zoom<1 shrinks scroll area to match visual height;
            // positive margin at zoom>1 grows it so content isn't clipped.
            marginBottom: zoom !== 1 ? totalHeight * (zoom - 1) : undefined,
            transform: (() => {
              const parts: string[] = [];
              if (commentsSidebarOpen) {
                // Center page + sidebar as a unit within the container
                parts.push(`translateX(-${SIDEBAR_DOCUMENT_SHIFT}px)`);
              }
              if (zoom !== 1) parts.push(`scale(${zoom})`);
              return parts.length > 0 ? parts.join(' ') : undefined;
            })(),
            transformOrigin: 'top center',
            transition: 'transform 0.2s ease',
          }}
        >
          {/* Pages container */}
          <div
            ref={pagesContainerRef}
            className={`paged-editor__pages${readOnly ? ' paged-editor--readonly' : ''}${hfEditMode ? ` paged-editor--hf-editing paged-editor--editing-${hfEditMode}` : ''}`}
            style={pagesContainerStyles}
            onMouseDown={handlePagesMouseDown}
            onMouseMove={handlePagesMouseMove}
            onClick={handlePagesClick}
            onContextMenu={handlePagesContextMenu}
            aria-hidden="true" // Visual only, PM provides semantic content
          />

          {/* Selection overlay */}
          <SelectionOverlay
            selectionGeometry={selectionGeometry}
            caretPosition={caretPosition}
            isFocused={isFocused}
            pageGap={pageGap}
            readOnly={readOnly}
          />

          {/* Image selection overlay */}
          <ImageSelectionOverlay
            imageInfo={selectedImageInfo}
            zoom={zoom}
            isFocused={isFocused}
            onResize={handleImageResize}
            onResizeStart={handleImageResizeStart}
            onResizeEnd={handleImageResizeEnd}
            onDragMove={handleImageDragMove}
            onDragStart={handleImageDragStart}
            onDragEnd={handleImageDragEnd}
            onContextMenu={handlePagesContextMenu}
          />

          {/* Table quick action insert button */}
          {tableInsertButton && (
            <button
              type="button"
              onMouseDown={handleTableInsertClick}
              onMouseEnter={clearTableInsertTimer}
              onMouseLeave={() => setTableInsertButton(null)}
              style={{
                position: 'absolute',
                left: tableInsertButton.x,
                top: tableInsertButton.y,
                width: 20,
                height: 20,
                borderRadius: '4px',
                border: '1px solid #dadce0',
                backgroundColor: '#f8f9fa',
                color: '#5f6368',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 200,
                padding: 0,
                boxShadow: 'none',
              }}
              title={
                tableInsertButton.type === 'row' ? 'Insert row below' : 'Insert column to the right'
              }
              aria-label={
                tableInsertButton.type === 'row' ? 'Insert row below' : 'Insert column to the right'
              }
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1v10M1 6h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          {/* Plugin overlays (highlights, annotations) */}
          {pluginOverlays && (
            <div className="paged-editor__plugin-overlays" style={pluginOverlaysStyles}>
              {pluginOverlays}
            </div>
          )}

          {/* Generic PM decoration forwarder — surfaces yCursorPlugin remote
              cursors, search-highlight plugins, etc. on the visible pages.
              No-op when no plugin emits decorations. */}
          <DecorationLayer
            getView={() => hiddenPMRef.current?.getView() ?? null}
            getPagesContainer={() => pagesContainerRef.current}
            zoom={zoom}
            transactionVersion={transactionVersion}
            syncCoordinator={syncCoordinator}
          />
        </div>

        {/* Sidebar overlay — positioned to match visual document height, visible overflow for sidebar items */}
        {sidebarOverlay && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: totalHeight * zoom,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <div style={{ pointerEvents: 'auto' }}>{sidebarOverlay}</div>
          </div>
        )}
      </div>
    );
  }
);

export const PagedEditor = memo(PagedEditorComponent);

export default PagedEditor;

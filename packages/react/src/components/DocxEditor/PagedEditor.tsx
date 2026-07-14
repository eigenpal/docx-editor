/** Bridges the off-screen ProseMirror editor with painted pages, pointer
 * routing, pagination, and visible selection overlays. */

import React, { useEffect, useRef, useState, useCallback, useMemo, forwardRef, memo } from 'react';
import type { CSSProperties } from 'react';
import { TextSelection, type EditorState, type Transaction, type Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

// Internal components
import { OffscreenEditorHost, type OffscreenEditorHostRef } from './OffscreenEditorHost';
import { HiddenHeaderFooterPMs, type HiddenHeaderFooterPMsRef } from './HiddenHeaderFooterPMs';
import { SelectionOverlay } from './overlays/SelectionOverlay';
import { ImageSelectionOverlay } from './overlays/ImageSelectionOverlay';
import { DecorationLayer } from './overlays/DecorationLayer';

import type { ScrollToParaIdOptions } from '@eigenpal/docx-editor-core/utils';

// Layout bridge
import {
  DEFAULT_PAGE_HEIGHT_PX,
  getVisualScrollHeight,
} from '@eigenpal/docx-editor-core/flow-model';

// Visual line navigation hook
import { useVisualLineNavigation } from '../../hooks/useVisualLineNavigation';
import { forwardNavKeysToPm } from './internals/forwardNavKeysToPm';
import { SIDEBAR_DOCUMENT_SHIFT } from '../sidebar/constants';

// Types
import type {
  Document,
  Theme,
  StyleDefinitions,
  SectionProperties,
  HeaderFooter,
} from '@eigenpal/docx-editor-core/types/document';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import type { RenderedDomContext } from '../../plugin-api/types';
import {
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_GAP,
  EMPTY_PLUGINS,
  VIEWPORT_PADDING_BOTTOM,
  VIEWPORT_PADDING_TOP,
  containerStyles,
  viewportStyles,
  pagesContainerStyles,
  pluginOverlaysStyles,
} from './internals/styles';
import { viewportMinHeightPx } from './internals/scrollUtils';
import { useLayoutPipeline } from './hooks/useLayoutPipeline';
import { transactionNeedsDirectOverlayRequest } from '@eigenpal/docx-editor-core/internal/paintedPagesGuard';
import { useSelectionOverlay } from './hooks/useSelectionOverlay';
import { useImageInteractions } from './hooks/useImageInteractions';
import { usePagedScrollApi } from './hooks/usePagedScrollApi';
import { usePagesPointer } from './hooks/usePagesPointer';
import type { HeaderFooterClickTarget } from './hooks/useHeaderFooterEditing';
import { usePagedEditorRefApi } from './hooks/usePagedEditorRefApi';
import { useLayoutTriggers } from './hooks/useLayoutTriggers';
import { TableInsertButton } from './overlays/TableInsertButton';
import { HyperlinkPopup, type HyperlinkPopupData } from '../ui/HyperlinkPopup';

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
  /** Relationship id of the exact painted header/footer story being edited. */
  activeHfRId?: string | null;
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
  onHeaderFooterDoubleClick?: (
    position: 'header' | 'footer',
    pageNumber?: number,
    target?: HeaderFooterClickTarget
  ) => void;
  /** Active header/footer editing mode (dims body, intercepts body clicks). */
  hfEditMode?: 'header' | 'footer' | null;
  /** Called when user clicks the body area while in HF editing mode. */
  onBodyClick?: () => void;
  /**
   * Called after every transaction lands on the persistent hidden HF PM
   * for any `rId`. Phase 5 of HF unification — the persistent PM is the
   * sole HF editor and its transactions must trigger relayout (so the
   * painter repaints) plus whatever caret / save state the parent owns.
   * Returns nothing.
   */
  onHfTransaction?: (rId: string, view: EditorView, docChanged: boolean) => void;
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
    position: { top: number; left: number };
  }) => void;
  /** Hyperlink popup state (null = hidden). */
  hyperlinkPopupData?: HyperlinkPopupData | null;
  /** Called when user wants to navigate to the link. */
  onHyperlinkPopupNavigate?: (href: string) => void;
  /** Called when user wants to copy the URL. */
  onHyperlinkPopupCopy?: (href: string) => void;
  /** Called when user saves hyperlink edits. */
  onHyperlinkPopupEdit?: (displayText: string, href: string) => void;
  /** Called when user removes the hyperlink. */
  onHyperlinkPopupRemove?: () => void;
  /** Called when the popup should close. */
  onHyperlinkPopupClose?: () => void;
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
  /** Suggestion mode active state */
  isSuggesting?: boolean;
  /** Active author for suggestion mode */
  author?: string;
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
  /** Get page geometry without exposing engine internals. */
  getLayout(): {
    readonly pages: readonly { readonly number: number; readonly size: { w: number; h: number } }[];
  } | null;
  /** Force re-layout. */
  relayout(): void;
  /** Scroll the visible pages to bring a PM position into view. */
  scrollToPosition(pmPos: number): void;
  /**
   * Scroll to the paragraph identified by Word `w14:paraId` / PM `paraId`.
   * Pass `options.highlight` to briefly flash rendered paragraph fragments.
   * @returns whether a matching paragraph was found
   */
  scrollToParaId(paraId: string, options?: ScrollToParaIdOptions): boolean;
  /**
   * Scroll the paginated view so `pageNumber` (1-indexed) is in view.
   * No-op if the layout isn't ready yet or pageNumber is out of range.
   */
  scrollToPage(pageNumber: number): void;
  /**
   * Scroll to the comment identified by `commentId` and select its range so
   * the selection overlay highlights it. Resolves the id → PM range via the
   * live comment marks; returns `false` (not a throw, not a silent no-op)
   * when the id no longer resolves so the caller can surface a "location no
   * longer exists" affordance.
   */
  scrollToCommentId(commentId: number): boolean;
  /**
   * Scroll to the tracked change identified by `revisionId` and select its
   * range so the selection overlay highlights it. Resolves the id → PM range
   * via the live tracked-change marks; returns `false` when the id no longer
   * resolves (the change was accepted/rejected/deleted).
   */
  scrollToChangeId(revisionId: number): boolean;
  /**
   * Select the PM position range `[from, to]` so the selection overlay
   * highlights it, and scroll its start into view. No-op for a malformed
   * range or a `from` past the document end; `to` is clamped to the document
   * size (raw caller positions, so out-of-range must not throw).
   */
  highlightRange(from: number, to: number): void;
  /**
   * Look up the persistent hidden HF PM EditorView for a given HeaderFooter
   * instance. Returns null when none is mounted (no document, or `hf` is not
   * present in `Document.package.headers/footers`). Phase 2 of the HF
   * unification: the inline overlay uses this to replicate edits into the
   * persistent PM so the painter — which reads from the persistent PM per
   * phase 1 — re-renders live during typing. Phase 5 deletes the inline
   * overlay's PM and this method's only remaining caller is the click /
   * focus router (phase 3).
   */
  getHfPmView(hf: HeaderFooter): EditorView | null;
  /** Get all active header/footer EditorViews mapped by rId. */
  getHfPmViews(): Map<string, EditorView>;
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
      activeHfRId,
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
      onHfTransaction,
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
      hyperlinkPopupData,
      onHyperlinkPopupNavigate,
      onHyperlinkPopupCopy,
      onHyperlinkPopupEdit,
      onHyperlinkPopupRemove,
      onHyperlinkPopupClose,
      isSuggesting = false,
      author = 'User',
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
    const hiddenPMRef = useRef<OffscreenEditorHostRef>(null);
    const paintedOverlayRefreshRef = useRef<() => void>(() => {});
    // Coalesce rapid caret moves onto one overlay refresh per frame.
    const selectionOverlayRafRef = useRef<number | null>(null);
    const scheduleSelectionOverlayRefresh = useCallback(() => {
      if (selectionOverlayRafRef.current != null) return;
      selectionOverlayRafRef.current = requestAnimationFrame(() => {
        selectionOverlayRafRef.current = null;
        paintedOverlayRefreshRef.current();
      });
    }, []);
    /**
     * Persistent hidden HF PM EditorViews for every distinct HF `rId` — phase 1
     * of the HF editing unification (see openspec/changes/unify-hf-editing/).
     */
    const hiddenHfPMsRef = useRef<HiddenHeaderFooterPMsRef>(null);
    /** Latest `document` prop — read by HF PM lookup on the PagedEditorRef. */
    const documentRef = useRef(document);
    documentRef.current = document;

    // Visual line navigation (ArrowUp/ArrowDown with sticky X)
    const { handlePMKeyDown } = useVisualLineNavigation({ pagesContainerRef });

    // Store callbacks in refs to avoid infinite re-render loops
    // when parent passes unstable callback references
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onDocumentChangeRef = useRef(onDocumentChange);
    const onReadyRef = useRef(onReady);
    const onRenderedDomContextReadyRef = useRef(onRenderedDomContextReady);
    // Keep refs in sync with latest props
    onSelectionChangeRef.current = onSelectionChange;
    onDocumentChangeRef.current = onDocumentChange;
    onReadyRef.current = onReady;
    onRenderedDomContextReadyRef.current = onRenderedDomContextReady;

    // State
    const [isFocused, setIsFocused] = useState(false);

    // When HF edit mode engages, the body PM must visually retire — collapse
    // its selection to a non-rendered cursor, drop `isFocused`, and blur the
    // PM. Otherwise the user sees TWO carets (one in the painted header, one
    // in the body) and keystrokes that briefly land on the body before the
    // HF view reclaims focus get inserted into the body doc. Symmetric cleanup
    // when HF edit mode exits — restore body focus so typing flows back.
    useEffect(() => {
      if (hfEditMode) {
        const view = hiddenPMRef.current?.getView();
        if (view) {
          try {
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 0));
            view.dispatch(tr);
          } catch {
            // Position may be invalid mid-transaction; SelectionOverlay
            // also gates on hfEditMode so the caret stays hidden anyway.
          }
          (view.dom as HTMLElement).blur?.();
        }
        setIsFocused(false);
      }
    }, [hfEditMode]);

    // Image selection state — `isImageInteractingRef` lives at the parent so
    // useSelectionOverlay can read it (to gate the deferred image-info clear)
    // while useImageInteractions writes it (during drag / resize).
    const isImageInteractingRef = useRef(false);

    // Persistent hidden HF PM lookup — phase 1 of HF editing unification.
    // Walks `document.package.headers`/`footers` to find the rId for this
    // HeaderFooter instance, then asks the HiddenHeaderFooterPMs ref for
    // its current PM doc. Returns null when no PM is mounted (cold boot
    // before the effect runs) so the pipeline falls back to the Document
    // model path. Stable identity per `document` so the layout pipeline
    // doesn't re-run on every render.
    const getHfPmDoc = useCallback(
      (hf: HeaderFooter): PMNode | null => {
        const ref = hiddenHfPMsRef.current;
        if (!ref) return null;
        const pkg = document?.package;
        if (!pkg) return null;
        const findRid = (bag?: Map<string, HeaderFooter>): string | null => {
          if (!bag) return null;
          for (const [rId, value] of bag) {
            if (value === hf) return rId;
          }
          return null;
        };
        const rId = findRid(pkg.headers) ?? findRid(pkg.footers);
        if (!rId) return null;
        return ref.getView(rId)?.state.doc ?? null;
      },
      [document]
    );

    // Layout pipeline — owns pageLayout/nodes/metrics state, the rAF-coalesced
    // scheduler, scroll-restore plumbing, the painter, and the page-count
    // notifier. Returns `notifyDecorationLayer` for the DecorationLayer
    // resync that handleTransaction triggers on every PM transaction.
    const {
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
    } = useLayoutPipeline({
      document,
      styles,
      theme: _theme,
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
      onPaintedPagesReady: () => paintedOverlayRefreshRef.current(),
    });

    // Selection overlay — caret, range rects, image overlay info, plus the
    // ResizeObserver + post-layout recompute that keep geometry fresh.
    const {
      selectionGeometry,
      caretPosition,
      selectedImageInfo,
      setSelectionGeometry,
      setCaretPosition,
      setSelectedImageInfo,
      buildImageSelectionInfo,
      handleSelectionChange,
    } = useSelectionOverlay({
      pageLayout,
      nodes,
      metrics,
      zoom,
      containerRef,
      pagesContainerRef,
      hiddenPMRef,
      isImageInteractingRef,
      onSelectionChangeRef,
      requestOverlayRefresh: requestPaintedOverlayRefresh,
    });

    /**
     * Handle PM transaction - re-layout on content/selection change.
     */
    const handleTransaction = useCallback(
      (transaction: Transaction, newState: EditorState) => {
        if (transaction.docChanged) {
          // From this point until a matching paint commits, no overlay may
          // resolve PM positions against the visible page DOM.
          markPaintedPagesStale();
          // Content changed - schedule layout (coalesced via rAF)
          scheduleLayout(newState);

          // Notify document change - use ref to avoid infinite loops
          const newDoc = hiddenPMRef.current?.getDocument();
          if (newDoc) {
            onDocumentChangeRef.current?.(newDoc);
          }
        }

        if (transaction.selectionSet || transaction.docChanged || transaction.storedMarksSet) {
          onSelectionChangeRef.current?.(newState.selection.from, newState.selection.to);
        }

        // Selection, caret, and decoration refreshes share one readiness gate.
        // Selection-only/meta transactions run now when pages are current;
        // document changes retain and coalesce this request until paint.
        if (transactionNeedsDirectOverlayRequest(transaction)) {
          requestPaintedOverlayRefresh();
        }
      },
      [markPaintedPagesStale, requestPaintedOverlayRefresh, scheduleLayout]
      // NOTE: onDocumentChange removed from dependencies - accessed via ref to prevent infinite loops
    );

    // Scroll API exposed via the PagedEditorRef. Owns the AbortController
    // chain that lets a fresh scroll supersede an in-flight paint-settle.
    const { scrollToPositionImpl, scrollToPageImpl, scrollToParaIdImpl } = usePagedScrollApi({
      pageLayout,
      nodes,
      metrics,
      pagesContainerRef,
      hiddenPMRef,
      getScrollContainer,
    });

    const getActiveHfView = useCallback(
      () => (activeHfRId ? (hiddenHfPMsRef.current?.getView(activeHfRId) ?? null) : null),
      [activeHfRId]
    );

    // Pointer routing — every mouse path on the visible pages: cursor
    // placement, drag-to-select (with cell-selection promotion), table
    // resize handles, the floating "+" insert button, hyperlink clicks,
    // header/footer double-clicks, word/paragraph multi-click, and
    // right-click → host context-menu.
    const {
      handlePagesMouseDown,
      handlePagesMouseMove,
      handlePagesClick,
      handlePagesContextMenu,
      handleTableInsertClick,
      tableInsertButton,
      clearTableInsertTimer,
      hideTableInsertButton,
      getPositionFromMouse,
      flushPendingImageSelection,
    } = usePagesPointer({
      pagesContainerRef,
      hiddenPMRef,
      // Resolve the active HF EditorView for the current `hfEditMode` slot
      // so usePagesPointer can route every gesture (single-click, drag,
      // multi-click, image-select, hyperlink, context menu) through the
      // HF PM instead of the body PM.
      getHfView: getActiveHfView,
      pageLayout,
      nodes,
      metrics,
      zoom,
      readOnly,
      hfEditMode,
      onBodyClick,
      onContextMenu,
      onHyperlinkClick,
      onHeaderFooterDoubleClick,
      setSelectedImageInfo,
      setSelectionGeometry,
      setCaretPosition,
      buildImageSelectionInfo,
      pagesAreCurrent: paintedPagesAreCurrent,
      requestOverlayRefresh: requestPaintedOverlayRefresh,
      setIsFocused,
      scrollToPositionImpl,
    });

    paintedOverlayRefreshRef.current = () => {
      if (flushPendingImageSelection()) return;
      const state = hiddenPMRef.current?.getState();
      if (state) handleSelectionChange(state);
      notifyDecorationLayer();
      pagesContainerRef.current?.dispatchEvent(
        new CustomEvent('docx-editor-react:painted-pages-ready')
      );
    };

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
        // Don't steal focus from the hyperlink popup's text/URL inputs —
        // the focus event bubbles up here and would bounce focus back to
        // the body PM, making the inputs impossible to edit.
        if (target.closest('.ep-hyperlink-popup')) return;
        // Phase 5 of HF editing unification: when focus lands on one of
        // the persistent hidden HF PMs (mounted off-screen as siblings of
        // `.layout-page-content`), don't redirect to the body PM — that
        // would steal focus from the HF editor the user just opened.
        // `data-hf-r-id` is set on the host div by HiddenHeaderFooterPMs.
        if (target.closest('[data-hf-r-id]')) return;
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

    // Image overlay interactions — resize + drag-to-move. Owns the writes
    // to `isImageInteractingRef` that gate the selection hook's deferred
    // image-info clear during drag/resize gestures.
    const {
      handleImageResize,
      handleImageResizeStart,
      handleImageResizeEnd,
      handleImageDragMove,
      handleImageDragStart,
      handleImageDragEnd,
    } = useImageInteractions({
      pagesContainerRef,
      hiddenPMRef,
      getActiveView: getActiveHfView,
      activeRegion: hfEditMode,
      zoom,
      isImageInteractingRef,
      getPositionFromMouse,
      pagesAreCurrent: paintedPagesAreCurrent,
      requestOverlayRefresh: requestPaintedOverlayRefresh,
    });

    /** Keyboard: focus hidden PM, space-as-text, nav-key forwarding. */
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (readOnly) return;
        // Don't steal focus from a persistent HF EditorView — body's
        // `isFocused()` check would return false while HF is focused,
        // causing the body PM to grab every keystroke after the first.
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-hf-r-id]')) return;
        // Don't hijack keystrokes typed into the hyperlink popup's inputs —
        // refocusing the body PM here would steal focus mid-type and route
        // keys (e.g. space) into the document instead of the input.
        if (target?.closest('.ep-hyperlink-popup')) return;
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

        if (e.key === 'Home' && (e.metaKey || e.ctrlKey)) {
          const sc = getScrollContainer();
          if (sc) sc.scrollTop = 0;
        }
        if (e.key === 'End' && (e.metaKey || e.ctrlKey)) {
          const sc = getScrollContainer();
          if (sc) sc.scrollTop = sc.scrollHeight;
        }
        if (forwardNavKeysToPm(e, hiddenPMRef.current?.getView())) return;
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
        requestPaintedOverlayRefresh();

        // Auto-focus the editor so the user can start typing immediately
        if (!readOnly) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            view.focus();
            setIsFocused(true);
          });
        }
      },
      [runLayoutPipeline, requestPaintedOverlayRefresh, readOnly]
    );

    // Re-layout triggers: web-font load complete + header/footer content changes.
    useLayoutTriggers({
      hiddenPMRef,
      runLayoutPipeline,
      requestOverlayRefresh: requestPaintedOverlayRefresh,
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
    });

    // Imperative-handle setup — exposes PagedEditorRef + mirrors via onReady.
    usePagedEditorRefApi({
      ref,
      hiddenPMRef,
      hiddenHfPMsRef,
      documentRef,
      pageLayout,
      runLayoutPipeline,
      requestOverlayRefresh: requestPaintedOverlayRefresh,
      scrollToPositionImpl,
      scrollToParaIdImpl,
      scrollToPageImpl,
      setIsFocused,
      onReadyRef,
    });

    // =========================================================================
    // Render
    // =========================================================================

    // Min-height of the viewport wrapper. Delegates to `viewportMinHeightPx`
    // so the same math runs in both the JSX commit and the imperative write
    // the layout pipeline does mid-pipeline (needed for scroll-restore math
    // before React commits).
    const totalHeight = useMemo(() => {
      if (!pageLayout)
        return DEFAULT_PAGE_HEIGHT_PX + VIEWPORT_PADDING_TOP + VIEWPORT_PADDING_BOTTOM;
      return viewportMinHeightPx(pageLayout, pageGap);
    }, [pageLayout, pageGap]);
    const visualHeight = useMemo(
      () => getVisualScrollHeight(totalHeight, zoom),
      [totalHeight, zoom]
    );

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
          // When HF mode is active, the body PM is functionally retired —
          // marking it readOnly stops keystrokes / input events from being
          // applied to the body doc even if focus briefly slips to it.
          readOnly={readOnly || !!hfEditMode}
          onTransaction={handleTransaction}
          onSelectionChange={scheduleSelectionOverlayRefresh}
          externalPlugins={externalPlugins}
          extensionManager={extensionManager}
          onEditorViewReady={handleEditorViewReady}
          onKeyDown={handlePMKeyDown}
        />

        {/* Persistent hidden HF PMs — one per distinct rId */}
        <HiddenHeaderFooterPMs
          ref={hiddenHfPMsRef}
          document={document}
          styles={styles}
          theme={_theme}
          isSuggesting={isSuggesting}
          author={author}
          defaultTabMarkTwips={document?.package?.settings?.defaultTabMark ?? null}
          onTransaction={(rId, view, docChanged) => {
            // Only re-layout when the HF doc actually changed — selection-only
            // transactions (arrow keys, click-to-position) don't move text, so
            // the painter has nothing new to paint.
            if (docChanged) {
              markPaintedPagesStale();
              const bodyState = hiddenPMRef.current?.getState();
              if (bodyState) runLayoutPipeline(bodyState);
            }
            onHfTransaction?.(rId, view, docChanged);
            requestPaintedOverlayRefresh();
          }}
        />

        {/* Viewport for visible pages */}
        <div
          ref={viewportLayoutRef}
          style={{
            position: 'relative',
            height: visualHeight,
            minHeight: visualHeight,
            overflow: 'hidden',
            overflowAnchor: 'none',
          }}
        >
          <div
            style={{
              ...viewportStyles,
              minHeight: totalHeight,
              transform: (() => {
                const parts: string[] = [];
                if (commentsSidebarOpen) {
                  parts.push(`translateX(-${SIDEBAR_DOCUMENT_SHIFT}px)`);
                }
                if (zoom !== 1) parts.push(`scale(${zoom})`);
                return parts.length > 0 ? parts.join(' ') : undefined;
              })(),
              transformOrigin: 'top center',
              transition: 'transform 0.2s ease',
            }}
          >
            <div
              ref={pagesContainerRef}
              className={`paged-editor__pages${readOnly ? ' paged-editor--readonly' : ''}${hfEditMode ? ` paged-editor--hf-editing paged-editor--editing-${hfEditMode}` : ''}`}
              style={pagesContainerStyles}
              onMouseDown={handlePagesMouseDown}
              onMouseMove={handlePagesMouseMove}
              onClick={handlePagesClick}
              onContextMenu={handlePagesContextMenu}
              aria-hidden="true"
            />
            <SelectionOverlay
              selectionGeometry={hfEditMode ? [] : selectionGeometry}
              caretPosition={hfEditMode ? null : caretPosition}
              isFocused={isFocused && !hfEditMode}
              pageGap={pageGap}
              readOnly={readOnly}
            />
            <ImageSelectionOverlay
              imageInfo={selectedImageInfo}
              zoom={zoom}
              isFocused={isFocused}
              pagesAreCurrent={paintedPagesAreCurrent}
              requestOverlayRefresh={requestPaintedOverlayRefresh}
              onResize={handleImageResize}
              onResizeStart={handleImageResizeStart}
              onResizeEnd={handleImageResizeEnd}
              onDragMove={handleImageDragMove}
              onDragStart={handleImageDragStart}
              onDragEnd={handleImageDragEnd}
              onContextMenu={handlePagesContextMenu}
            />
            {tableInsertButton && (
              <TableInsertButton
                type={tableInsertButton.type}
                x={tableInsertButton.x}
                y={tableInsertButton.y}
                onMouseDown={handleTableInsertClick}
                onMouseEnter={clearTableInsertTimer}
                onMouseLeave={hideTableInsertButton}
              />
            )}
            {pluginOverlays && (
              <div className="paged-editor__plugin-overlays" style={pluginOverlaysStyles}>
                {pluginOverlays}
              </div>
            )}
            <DecorationLayer
              getView={() => hiddenPMRef.current?.getView() ?? null}
              getPagesContainer={() => pagesContainerRef.current}
              zoom={zoom}
              decorationSyncToken={decorationSyncToken}
              pagesAreCurrent={paintedPagesAreCurrent}
            />
          </div>
        </div>

        {/* Sidebar overlay — positioned to match visual document height, visible overflow for sidebar items */}
        {sidebarOverlay && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: visualHeight,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <div style={{ pointerEvents: 'auto' }}>{sidebarOverlay}</div>
          </div>
        )}

        {/* Hyperlink popup — rendered inside containerRef so it shares a
            scroll context with the link. position: absolute + coords in
            container space mean the browser repositions on scroll for free. */}
        {hyperlinkPopupData &&
          onHyperlinkPopupNavigate &&
          onHyperlinkPopupCopy &&
          onHyperlinkPopupEdit &&
          onHyperlinkPopupRemove &&
          onHyperlinkPopupClose && (
            <HyperlinkPopup
              data={hyperlinkPopupData}
              onNavigate={onHyperlinkPopupNavigate}
              onCopy={onHyperlinkPopupCopy}
              onEdit={onHyperlinkPopupEdit}
              onRemove={onHyperlinkPopupRemove}
              onClose={onHyperlinkPopupClose}
              readOnly={readOnly}
            />
          )}
      </div>
    );
  }
);

export const PagedEditor = memo(PagedEditorComponent);

export default PagedEditor;

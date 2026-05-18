/**
 * Pages-area pointer composable — owns every mousedown / mousemove /
 * click / dblclick / scroll handler on the pages viewport, plus the
 * incidental state those handlers own: multi-click detection, drag
 * selection, the table quick-insert button, the header/footer
 * double-click editor state, and the page-indicator scroll tracker.
 * Reads `selectedImage` / `imageInteracting` from `useImageActions`
 * and the table-resize bridge from `useTableResize`. The
 * selection-overlay (caret + text-rect) primitive `clearOverlay`
 * still lives in the parent — passed in as a callback — until
 * `useSelectionSync` lands.
 */

import { onBeforeUnmount, onMounted, ref, type Ref, type ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import type { HeaderFooter, Paragraph, Table } from '@eigenpal/docx-editor-core/types/content';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { findImageElement } from '@eigenpal/docx-editor-core/layout-painter';
import {
  detectTableInsertHover,
  TABLE_INSERT_HIDE_DELAY_MS,
} from '@eigenpal/docx-editor-core/layout-bridge/tableInsertHover';
import {
  scrollVisiblePositionIntoView as scrollVisiblePositionIntoViewImpl,
  resolvePos as resolvePosImpl,
  selectWord as selectWordImpl,
  selectParagraph as selectParagraphImpl,
} from '../utils/domQueries';
import type { ImageSelectionInfo } from '../components/imageSelectionTypes';
import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';
import type { HyperlinkPopupData } from '../components/ui/hyperlinkPopupTypes';

type TableResizeApi = {
  tryStartResize: (e: MouseEvent, view: EditorView) => boolean;
  isResizing: Ref<boolean>;
};

type Commands = Record<string, ((...args: unknown[]) => unknown) | undefined>;

export interface TableInsertButton {
  type: 'row' | 'column';
  x: number;
  y: number;
  cellPmPos: number;
}

export interface HfEditState {
  position: 'header' | 'footer';
  rId: string | null;
  headerFooter: HeaderFooter | null;
  targetRect: { top: number; left: number; width: number; height: number } | null;
}

export interface ScrollPageInfo {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}

export interface UsePagesPointerOptions {
  editorView: Ref<EditorView | null>;
  pagesRef: Ref<HTMLElement | null>;
  pagesViewportRef: Ref<HTMLElement | null>;
  selectedImage: ShallowRef<ImageSelectionInfo | null>;
  imageInteracting: Ref<boolean>;
  hyperlinkPopupData: Ref<HyperlinkPopupData | null>;
  readOnly: Ref<boolean>;
  zoom: Ref<number>;
  layout: Ref<Layout | null>;
  tableResize: TableResizeApi;
  getCommands: () => Commands;
  getDocument: () => Document | null;
  reLayout: () => void;
  emit: (event: string, ...args: unknown[]) => void;
  clearOverlay: () => void;
}

const MULTI_CLICK_DELAY = 500;

export interface UsePagesPointerReturn {
  tableInsertButton: Ref<TableInsertButton | null>;
  hfEdit: Ref<HfEditState | null>;
  scrollPageInfo: Ref<ScrollPageInfo>;
  resolvePos: (clientX: number, clientY: number) => number | null;
  setPmSelection: (anchor: number, head?: number) => void;
  scrollVisiblePositionIntoView: (pmPos: number) => void;
  navigateToBookmark: (bookmarkName: string) => void;
  handlePagesMouseDown: (event: MouseEvent) => void;
  handlePagesMouseMove: (event: MouseEvent) => void;
  handlePagesClick: (event: MouseEvent) => void;
  handlePagesDoubleClick: (event: MouseEvent) => void;
  handleTableInsertClick: (event: MouseEvent) => void;
  clearTableInsertTimer: () => void;
  handleHfSave: (content: (Paragraph | Table)[]) => void;
  handleHfRemove: () => void;
}

export function usePagesPointer(opts: UsePagesPointerOptions): UsePagesPointerReturn {
  // ─── Table quick-action "+" button ──────────────────────────────────────
  const tableInsertButton = ref<TableInsertButton | null>(null);
  let tableInsertHideTimer: ReturnType<typeof setTimeout> | null = null;
  function clearTableInsertTimer() {
    if (tableInsertHideTimer !== null) {
      clearTimeout(tableInsertHideTimer);
      tableInsertHideTimer = null;
    }
  }

  // ─── Inline header/footer editor (#388 port) ────────────────────────────
  const hfEdit = ref<HfEditState | null>(null);

  // ─── Multi-click detection (double = word, triple = paragraph) ──────────
  let lastClickTime = 0;
  let lastClickPos: number | null = null;
  let clickCount = 0;

  // ─── Drag-to-select ─────────────────────────────────────────────────────
  let isDragging = false;
  let dragAnchor: number | null = null;

  // ─── Page-indicator overlay ─────────────────────────────────────────────
  const scrollPageInfo = ref<ScrollPageInfo>({ currentPage: 1, totalPages: 1, visible: false });
  let scrollFadeTimer: ReturnType<typeof setTimeout> | null = null;

  function resolvePos(clientX: number, clientY: number): number | null {
    return resolvePosImpl(opts.pagesRef.value, opts.editorView.value, clientX, clientY);
  }

  function setPmSelection(anchor: number, head?: number) {
    const view = opts.editorView.value;
    if (!view) return;
    const $anchor = view.state.doc.resolve(anchor);
    const $head = head !== undefined ? view.state.doc.resolve(head) : $anchor;
    const sel = TextSelection.between($anchor, $head);
    view.dispatch(view.state.tr.setSelection(sel));
  }

  function scrollVisiblePositionIntoView(pmPos: number) {
    scrollVisiblePositionIntoViewImpl(opts.pagesRef.value, opts.pagesViewportRef.value, pmPos);
  }

  function selectWord(pos: number) {
    selectWordImpl(opts.pagesRef.value, pos, setPmSelection);
  }

  function selectParagraph(pos: number) {
    selectParagraphImpl(opts.pagesRef.value, pos, setPmSelection);
  }

  function navigateToBookmark(bookmarkName: string) {
    const view = opts.editorView.value;
    if (!view) return;
    let targetPos: number | null = null;
    view.state.doc.descendants((node, pos) => {
      if (targetPos !== null) return false;
      const bookmarks = node.attrs?.bookmarks as Array<{ name?: string }> | undefined;
      if (bookmarks?.some((b) => b.name === bookmarkName)) {
        targetPos = pos;
        return false;
      }
      return true;
    });
    if (targetPos === null) return;
    scrollVisiblePositionIntoView(targetPos);
    try {
      setPmSelection(Math.min(targetPos + 1, view.state.doc.content.size));
    } catch {
      // Bookmark target may be a non-text selectable position; fall back to the
      // start position so the click still moves the editor near the target.
      setPmSelection(targetPos);
    }
  }

  /**
   * Show / hide the "+" insert button as the cursor moves near a
   * table's edges. Hide is debounced through `TABLE_INSERT_HIDE_DELAY_MS`
   * so transient gaps between cells don't make the button flicker.
   */
  function handlePagesMouseMove(event: MouseEvent) {
    if (opts.readOnly.value) return;
    // Skip the hit-test during text drag-selects so the (+) doesn't
    // pop in mid-selection when the drag path crosses a table edge.
    if (isDragging) return;
    const pagesEl = opts.pagesRef.value;
    if (!pagesEl) return;
    const viewportEl = opts.pagesViewportRef.value;
    if (!viewportEl) return;

    const hit = detectTableInsertHover({
      mouseX: event.clientX,
      mouseY: event.clientY,
      pagesContainer: pagesEl,
      target: event.target as HTMLElement,
      hfEditMode: hfEdit.value?.position ?? null,
    });

    if (!hit) {
      if (tableInsertHideTimer === null) {
        tableInsertHideTimer = setTimeout(() => {
          tableInsertButton.value = null;
          tableInsertHideTimer = null;
        }, TABLE_INSERT_HIDE_DELAY_MS);
      }
      return;
    }

    const viewportRect = viewportEl.getBoundingClientRect();
    tableInsertButton.value = {
      type: hit.type,
      x: hit.clientX - viewportRect.left,
      y: hit.clientY - viewportRect.top,
      cellPmPos: hit.cellPmPos,
    };
    clearTableInsertTimer();
  }

  /**
   * Insert a row below / column to the right of the target cell. The
   * core `addRowBelow` / `addColumnRight` commands read the current
   * PM selection to know which cell to extend, so we plant a caret
   * inside the hovered cell first.
   */
  function handleTableInsertClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const btn = tableInsertButton.value;
    const view = opts.editorView.value;
    if (!btn || !view) return;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, btn.cellPmPos + 1));
    view.dispatch(tr);
    const cmds = opts.getCommands();
    const cmd = btn.type === 'row' ? cmds.addRowBelow?.() : cmds.addColumnRight?.();
    if (!cmd) return;
    (
      cmd as (
        state: EditorView['state'],
        dispatch: EditorView['dispatch'],
        view: EditorView
      ) => boolean
    )(view.state, (tr) => view.dispatch(tr), view);
    tableInsertButton.value = null;
    view.focus();
  }

  /**
   * Single-click on a hyperlink → surface the popup or navigate internal
   * bookmarks. Browser default navigation stays suppressed so drag-selects
   * ending on links do not unexpectedly leave the document.
   */
  function handlePagesClick(event: MouseEvent) {
    const anchor = (event.target as HTMLElement | null)?.closest(
      'a[href]'
    ) as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || '';
    if (!href) return;
    if (href.startsWith('#')) {
      const bookmarkName = href.slice(1);
      if (bookmarkName) navigateToBookmark(bookmarkName);
      return;
    }
    const view = opts.editorView.value;
    const hasRangeSelection = view && view.state.selection.from !== view.state.selection.to;
    if (hasRangeSelection) return;
    opts.hyperlinkPopupData.value = {
      href,
      displayText: anchor.textContent || '',
      tooltip: anchor.getAttribute('title') || undefined,
      anchorRect: anchor.getBoundingClientRect(),
    };
  }

  function handlePagesDoubleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const headerEl = target.closest('.layout-page-header') as HTMLElement | null;
    const footerEl = target.closest('.layout-page-footer') as HTMLElement | null;
    const hfEl = headerEl ?? footerEl;
    if (!hfEl) return;

    const position: 'header' | 'footer' = headerEl ? 'header' : 'footer';
    const doc = opts.getDocument();
    if (!doc?.package) return;

    // Resolve the HF for the current section. Mirrors the lookup in
    // useDocxEditor.runLayoutPipeline so what the user sees on page is
    // what they get to edit.
    const sp =
      doc.package.document?.sections?.[0]?.properties ??
      doc.package.document?.finalSectionProperties ??
      null;
    const refs = position === 'header' ? sp?.headerReferences : sp?.footerReferences;
    const map = position === 'header' ? doc.package.headers : doc.package.footers;
    if (!refs || !map) return;
    // Default ref takes priority; fall back to `first` if the doc only ships first.
    const refEntry = refs.find((r) => r.type === 'default') ?? refs.find((r) => r.type === 'first');
    const rId = refEntry?.rId ?? null;
    const hf = rId ? (map.get(rId) ?? null) : null;

    // Bounding rect relative to the pages-viewport. zoom is applied via
    // CSS transform on the viewport, so use the unscaled element coords.
    const viewport = opts.pagesViewportRef.value;
    if (!viewport) return;
    const elRect = hfEl.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();
    const z = opts.zoom.value || 1;
    hfEdit.value = {
      position,
      rId,
      headerFooter: hf,
      targetRect: {
        top: (elRect.top - vpRect.top + viewport.scrollTop) / z,
        left: (elRect.left - vpRect.left + viewport.scrollLeft) / z,
        width: elRect.width / z,
        height: elRect.height / z,
      },
    };
  }

  function handleHfSave(content: (Paragraph | Table)[]) {
    const doc = opts.getDocument();
    const edit = hfEdit.value;
    if (!doc?.package || !edit) return;
    const map = edit.position === 'header' ? doc.package.headers : doc.package.footers;
    if (!map || !edit.rId) return;
    const existing = map.get(edit.rId);
    if (existing) {
      existing.content = content;
    }
    opts.reLayout();
    opts.emit('change', doc);
  }

  function handleHfRemove() {
    const doc = opts.getDocument();
    const edit = hfEdit.value;
    if (!doc?.package || !edit || !edit.rId) return;
    const map = edit.position === 'header' ? doc.package.headers : doc.package.footers;
    const existing = map?.get(edit.rId);
    if (existing) {
      existing.content = [];
    }
    hfEdit.value = null;
    opts.reLayout();
    opts.emit('change', doc);
  }

  function handlePagesMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    // An image resize / move / rotate is in progress — its own document-level
    // listeners own this gesture; don't let the pages handler interfere.
    if (opts.imageInteracting.value) return;
    const view = opts.editorView.value;
    if (!view) return;

    // Table resize: if the user clicked a column/row/right-edge handle,
    // start the resize drag and skip text selection.
    if (!opts.readOnly.value && opts.tableResize.tryStartResize(event, view)) {
      return;
    }

    // Check if user clicked on an image
    const target = event.target as HTMLElement;
    const imageEl = findImageElement(target);
    if (imageEl) {
      event.preventDefault();
      event.stopPropagation();
      const docFrom = Number(imageEl.dataset.docFrom);
      if (!isNaN(docFrom)) {
        try {
          const sel = NodeSelection.create(view.state.doc, docFrom);
          view.dispatch(view.state.tr.setSelection(sel));
        } catch {
          // Position may be invalid
        }
        opts.selectedImage.value = {
          element: imageEl,
          pmPos: docFrom,
          width: imageEl.offsetWidth,
          height: imageEl.offsetHeight,
        };
        // Clear text caret overlay so it doesn't show alongside the image selection
        opts.clearOverlay();
      }
      view.focus();
      return;
    }

    // Clicked outside image — deselect
    opts.selectedImage.value = null;

    // Prevent browser from moving focus to the pages div — PM must keep focus
    event.preventDefault();

    const pos = resolvePos(event.clientX, event.clientY);
    if (pos === null) {
      view.focus();
      return;
    }

    // Multi-click detection
    const now = Date.now();
    if (now - lastClickTime < MULTI_CLICK_DELAY && lastClickPos === pos) {
      clickCount++;
    } else {
      clickCount = 1;
    }
    lastClickTime = now;
    lastClickPos = pos;

    if (clickCount === 2) {
      selectWord(pos);
    } else if (clickCount >= 3) {
      selectParagraph(pos);
      clickCount = 0;
    } else {
      // Single click
      if (event.shiftKey) {
        const { from } = view.state.selection;
        setPmSelection(from, pos);
      } else {
        setPmSelection(pos);
      }
      dragAnchor = pos;
      isDragging = true;
    }

    view.focus();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging || dragAnchor === null) return;
    const pos = resolvePos(event.clientX, event.clientY);
    if (pos !== null && pos !== dragAnchor) {
      setPmSelection(dragAnchor, pos);
    }
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function handleViewportScroll() {
    const container = opts.pagesViewportRef.value;
    const lay = opts.layout.value;
    if (!container || !lay || lay.pages.length === 0) return;

    const scrollTop = container.scrollTop;
    const totalPages = lay.pages.length;
    const PAGE_GAP = 24; // matches DEFAULT_PAGE_GAP in useDocxEditor
    const PADDING_TOP = 24;

    const viewportCenter = scrollTop + container.clientHeight / 2;
    let accumulatedY = PADDING_TOP;
    let currentPage = 1;
    for (let i = 0; i < lay.pages.length; i++) {
      const pageHeight = lay.pages[i].size.h;
      const pageEnd = accumulatedY + pageHeight;
      if (viewportCenter < pageEnd) {
        currentPage = i + 1;
        break;
      }
      accumulatedY = pageEnd + PAGE_GAP;
      currentPage = i + 2;
    }
    currentPage = Math.min(currentPage, totalPages);

    scrollPageInfo.value = { currentPage, totalPages, visible: true };

    if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
    scrollFadeTimer = setTimeout(() => {
      scrollPageInfo.value = { ...scrollPageInfo.value, visible: false };
    }, 600);
  }

  onMounted(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    opts.pagesViewportRef.value?.addEventListener('scroll', handleViewportScroll, {
      passive: true,
    });
  });

  onBeforeUnmount(() => {
    clearTableInsertTimer();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    opts.pagesViewportRef.value?.removeEventListener('scroll', handleViewportScroll);
    if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
  });

  return {
    // State
    tableInsertButton,
    hfEdit,
    scrollPageInfo,
    // Selection primitives (consumed by useContextMenus, parent's onSelectionUpdate, ref-API helpers)
    resolvePos,
    setPmSelection,
    scrollVisiblePositionIntoView,
    navigateToBookmark,
    // Pointer handlers (bound to template @event listeners)
    handlePagesMouseDown,
    handlePagesMouseMove,
    handlePagesClick,
    handlePagesDoubleClick,
    handleTableInsertClick,
    clearTableInsertTimer,
    // HF editor save/remove (bound to InlineHeaderFooterEditor events)
    handleHfSave,
    handleHfRemove,
  };
}

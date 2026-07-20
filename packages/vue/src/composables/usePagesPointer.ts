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

import { onBeforeUnmount, onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import type { HeaderFooter, BlockContent } from '@docx-editor.dev/core/types/content';
import type { Document } from '@docx-editor.dev/core/types/document';
import { findImageElement } from '@docx-editor.dev/core/painter-model';
import {
  detectTableInsertHover,
  TABLE_INSERT_HIDE_DELAY_MS,
} from '@docx-editor.dev/core/flow-model/tableInsertHover';
import { resolveHfDomPosition } from '@docx-editor.dev/core/flow-model';
import {
  removeHeaderFooterForSection,
  updateSectionPropertiesAt,
} from '@docx-editor.dev/core/utils/removeHeaderFooterForSection';
import {
  scrollVisiblePositionIntoView as scrollVisiblePositionIntoViewImpl,
  resolvePos as resolvePosImpl,
  selectWord as selectWordImpl,
  selectParagraph as selectParagraphImpl,
} from '../utils/domQueries';
import type { ImageSelectionInfo } from '../components/imageSelectionTypes';
import type { PageLayout } from '@docx-editor.dev/core/pagination-model';
import type { HyperlinkPopupData } from '../components/ui/hyperlinkPopupTypes';
import { useDragAutoScroll } from './useDragAutoScroll';
import {
  createCellDragTracker,
  findCellPosFromPmPos,
} from '@docx-editor.dev/core/prosemirror/cellDragSelection';
import { readCurrentPaintedPages } from '@docx-editor.dev/core/internal/paintedPagesGuard';

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
  variant: 'default' | 'first' | 'even';
  sectionIndex: number;
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
  pageLayout: Ref<PageLayout | null>;
  tableResize: TableResizeApi;
  getCommands: () => Commands;
  getDocument: () => Document | null;
  reLayout: () => void;
  emit: (event: string, ...args: unknown[]) => void;
  clearOverlay: () => void;
  pagesAreCurrent: () => boolean;
  requestOverlayRefresh: () => void;
  /**
   * Vue parity for the HF editing unification (openspec/changes/unify-hf-editing).
   * Re-mount HF EditorViews when `package.headers/footers` content
   * changes — exposed by `useDocxEditor.syncHfPMs`. Called after every
   * save so the persistent PM points at the new HeaderFooter object.
   * Optional so existing consumers can no-op until they wire it through.
   */
  syncHfPMs?: () => void;
  /** Resolve the persistent EditorView for an HF instance (for click routing). */
  getHfPmView?: (
    hf: import('@docx-editor.dev/core/types/content').HeaderFooter
  ) => import('prosemirror-view').EditorView | null;
  /**
   * Replace the loaded Document — used by HF materialisation to publish a
   * fresh Document object instead of mutating in place. Optional; if absent,
   * callers fall back to in-place mutation + `syncHfPMs()`.
   */
  setDocument?: (doc: Document) => void;
}

const MULTI_CLICK_DELAY = 500;

export interface UsePagesPointerReturn {
  tableInsertButton: Ref<TableInsertButton | null>;
  hfEdit: ShallowRef<HfEditState | null>;
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
  handleHfSave: (content: BlockContent[]) => void;
  handleHfRemove: () => void;
  flushPendingImageSelection: () => boolean;
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
  // shallowRef so the nested `headerFooter` reference stays identity-equal
  // to the instance in `Document.package.headers/footers`. Plain `ref` deeply
  // proxies the value, which breaks the IDENTITY-based lookup in
  // `useDocxEditor.findHfRid` (proxy !== raw → click never finds the HF view).
  const hfEdit = shallowRef<HfEditState | null>(null);

  // ─── Multi-click detection (double = word, triple = paragraph) ──────────
  let lastClickTime = 0;
  let lastClickPos: number | null = null;
  let clickCount = 0;

  // ─── Drag-to-select ─────────────────────────────────────────────────────
  let isDragging = false;
  let dragAnchor: number | null = null;
  let pendingImageSelection: { clientX: number; clientY: number } | null = null;
  // Promote a drag that crosses table-cell boundaries into a CellSelection
  // (shared with React via core), so multi-cell ops are reachable by dragging.
  const cellDrag = createCellDragTracker();

  // Auto-scroll when a drag-select reaches the top/bottom edge of the scroll
  // container, extending the selection as it scrolls (parity with React).
  const dragAutoScroll = useDragAutoScroll({
    pagesContainer: opts.pagesRef,
    onScrollExtendSelection: (clientX, clientY) => {
      if (!isDragging || dragAnchor === null) return;
      const pos = resolvePos(clientX, clientY);
      if (pos !== null && pos !== dragAnchor) setPmSelection(dragAnchor, pos);
    },
  });

  // ─── Page-indicator overlay ─────────────────────────────────────────────
  const scrollPageInfo = ref<ScrollPageInfo>({ currentPage: 1, totalPages: 1, visible: false });
  let scrollFadeTimer: ReturnType<typeof setTimeout> | null = null;

  function resolvePos(clientX: number, clientY: number): number | null {
    const edit = hfEdit.value;
    if (edit) {
      const selector = edit.position === 'header' ? '.layout-page-header' : '.layout-page-footer';
      const host = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => (element as HTMLElement).closest<HTMLElement>(selector))
        .find(
          (element): element is HTMLElement =>
            element != null && (!edit.rId || element.dataset.hfRId === edit.rId)
        );
      return host ? resolveHfDomPosition(host, clientX, clientY) : null;
    }
    return resolvePosImpl(opts.pagesRef.value, opts.editorView.value, clientX, clientY);
  }

  /**
   * The PM EditorView every pointer gesture flows through. When HF edit
   * mode is active and the matching persistent HF view exists, that's the
   * "active" view — drag, multi-click, image-select, hyperlink, context
   * menu all dispatch on it. Otherwise (or as a fallback) it's the body PM.
   * Routing through a single helper keeps `handlePagesMouseDown` free of
   * if/else "which PM?" branches.
   */
  function activeView(): EditorView | null {
    const hf = hfEdit.value;
    if (hf?.headerFooter && opts.getHfPmView) {
      const v = opts.getHfPmView(hf.headerFooter);
      if (v) return v;
    }
    return opts.editorView.value;
  }

  function selectCurrentImageElement(imageEl: HTMLElement): boolean {
    const docFrom = readCurrentPaintedPages(opts.pagesAreCurrent, () => {
      const parsed = Number(imageEl.dataset.docFrom);
      return Number.isFinite(parsed) ? parsed : null;
    });
    if (docFrom === null) return false;

    const view = activeView();
    if (!view) return false;
    try {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, docFrom)));
    } catch {
      return false;
    }
    const imageInfo = readCurrentPaintedPages(opts.pagesAreCurrent, () => ({
      element: imageEl,
      pmPos: docFrom,
      width: imageEl.offsetWidth,
      height: imageEl.offsetHeight,
    }));
    if (imageInfo) opts.selectedImage.value = imageInfo;
    opts.clearOverlay();
    view.focus();
    return true;
  }

  function flushPendingImageSelection(): boolean {
    const pending = pendingImageSelection;
    if (!pending || !opts.pagesAreCurrent()) return false;
    pendingImageSelection = null;

    const pages = opts.pagesRef.value;
    if (!pages) return false;
    const stack = pages.ownerDocument.elementsFromPoint(pending.clientX, pending.clientY);
    const target = stack.find((candidate) => pages.contains(candidate));
    if (!(target instanceof HTMLElement)) return false;
    const imageEl = findImageElement(target);
    return imageEl ? selectCurrentImageElement(imageEl) : false;
  }

  function setPmSelection(anchor: number, head?: number) {
    const view = activeView();
    if (!view) return;
    try {
      const $anchor = view.state.doc.resolve(anchor);
      const $head = head !== undefined ? view.state.doc.resolve(head) : $anchor;
      const sel = TextSelection.between($anchor, $head);
      view.dispatch(view.state.tr.setSelection(sel));
    } catch {
      // Position invalid for this doc (e.g. body pos passed to HF view).
    }
  }

  function scrollVisiblePositionIntoView(pmPos: number) {
    scrollVisiblePositionIntoViewImpl(opts.pagesRef.value, opts.pagesViewportRef.value, pmPos);
  }

  function selectWord(pos: number) {
    // Scope the span lookup to the active HF host when editing a header/footer,
    // so word bounds resolve against the HF text and not a coincidental body
    // span at the same PM position (#691).
    selectWordImpl(opts.pagesRef.value, pos, setPmSelection, hfEdit.value?.position, activeView());
  }

  function selectParagraph(pos: number) {
    selectParagraphImpl(opts.pagesRef.value, pos, setPmSelection, hfEdit.value?.position);
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

    // viewportEl carries `transform: scale(zoom)`; its rect is screen-space.
    // The button is an absolutely-positioned child of that scaled element, so
    // its left/top live in the element's own (unscaled) coords. Divide the
    // screen-space offset by zoom or it gets re-scaled and drifts (#928).
    const zoom = opts.zoom.value || 1;
    const viewportRect = viewportEl.getBoundingClientRect();
    tableInsertButton.value = {
      type: hit.type,
      x: (hit.clientX - viewportRect.left) / zoom,
      y: (hit.clientY - viewportRect.top) / zoom,
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
    if (href.startsWith('#')) {
      const bookmarkName = href.slice(1);
      if (bookmarkName) navigateToBookmark(bookmarkName);
      return;
    }
    // Route through the active view (the header/footer PM when editing one),
    // not the body PM. A link in a painted header/footer resolves against the
    // HF doc, so checking the body's selection here suppressed the popup for
    // HF links. Mirrors React's `activeSurface()`. Empty hrefs still surface
    // the popup (so the user can add/edit a URL), matching React.
    const view = activeView();
    const hasRangeSelection = view && view.state.selection.from !== view.state.selection.to;
    if (hasRangeSelection) return;
    // Compute popup position relative to the pages viewport so the popup
    // can render inside the scroll context — the browser then repositions
    // it on scroll via CSS alone, no JS listener needed.
    const viewport = opts.pagesViewportRef.value;
    if (!viewport) return;
    const vpRect = viewport.getBoundingClientRect();
    const linkRect = anchor.getBoundingClientRect();
    opts.hyperlinkPopupData.value = {
      href,
      displayText: anchor.textContent || '',
      tooltip: anchor.getAttribute('title') || undefined,
      position: {
        top: linkRect.bottom - vpRect.top + viewport.scrollTop + 4,
        left: linkRect.left - vpRect.left + viewport.scrollLeft,
      },
    };
  }

  function handlePagesDoubleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const headerEl = target.closest('.layout-page-header') as HTMLElement | null;
    const footerEl = target.closest('.layout-page-footer') as HTMLElement | null;
    const hfEl = headerEl ?? footerEl;
    if (!hfEl) return;

    const position: 'header' | 'footer' = headerEl ? 'header' : 'footer';

    // No scroll-to-page-1 — HF content is shared across pages by `r:id`,
    // so edits propagate to every painted instance automatically. The
    // chrome bar floats over whichever page the user actually clicked.
    const doc = opts.getDocument();
    if (!doc?.package) return;

    // The painter stamps the exact section/variant/rId used for this page.
    // Route editing through those values instead of re-resolving from section 0.
    const sectionIndex = Number(hfEl.dataset.sectionIndex ?? 0);
    const variant =
      hfEl.dataset.hfVariant === 'first' || hfEl.dataset.hfVariant === 'even'
        ? hfEl.dataset.hfVariant
        : 'default';
    const sp =
      doc.package.document?.sections?.[sectionIndex]?.properties ??
      doc.package.document?.finalSectionProperties ??
      null;
    const map = position === 'header' ? doc.package.headers : doc.package.footers;
    let rId: string | null = hfEl.dataset.hfRId ?? null;
    let hf: HeaderFooter | null = rId ? (map?.get(rId) ?? null) : null;

    // Materialise an empty HF part if none exists for this section yet
    // (mirrors React's `handleHeaderFooterDoubleClick` in
    // useHeaderFooterEditing.ts). Without this, double-clicking an empty
    // header is a no-op — the user has no way to add one.
    if (!hf) {
      if (!sp) return;
      const hdrFtrType = variant;
      let suffix = 1;
      let newRId = `rId_new_${position}_${hdrFtrType}_${suffix}`;
      while (
        doc.package.headers?.has(newRId) ||
        doc.package.footers?.has(newRId) ||
        doc.package.relationships?.has(newRId)
      ) {
        newRId = `rId_new_${position}_${hdrFtrType}_${++suffix}`;
      }
      const emptyHf: HeaderFooter = {
        type: position,
        hdrFtrType,
        content: [{ type: 'paragraph', content: [] }],
      };
      const mapKey = position === 'header' ? 'headers' : 'footers';
      const refKey = position === 'header' ? 'headerReferences' : 'footerReferences';
      const newMap = new Map(doc.package[mapKey] ?? []);
      newMap.set(newRId, emptyHf);

      // Register a relationship so the serializer emits content types + doc rels.
      const existingRels = doc.package.relationships;
      const usedTargets = new Set<string>();
      for (const rel of existingRels?.values() ?? []) {
        if (rel.target) usedTargets.add(rel.target);
      }
      let targetNum = 1;
      while (usedTargets.has(`${position}${targetNum}.xml`)) targetNum++;
      const relType =
        position === 'header'
          ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
      const newRels = new Map(existingRels);
      newRels.set(newRId, {
        id: newRId,
        type: relType,
        target: `${position}${targetNum}.xml`,
      });

      // Create a fresh Document with the new HF wired in (mirror of React's
      // pushDocument path) so any computeds watching document identity
      // refire and undo/redo can track the materialization event.
      const newRef = { type: hdrFtrType, rId: newRId };
      const newBody = updateSectionPropertiesAt(
        doc.package.document,
        sectionIndex,
        (properties) => ({
          ...properties,
          [refKey]: [
            ...(properties[refKey] ?? []).filter((entry) => entry.type !== hdrFtrType),
            newRef,
          ],
        })
      );
      const newDoc: Document = {
        ...doc,
        package: {
          ...doc.package,
          [mapKey]: newMap,
          relationships: newRels,
          document: newBody,
        },
      };
      rId = newRId;
      hf = emptyHf;
      opts.setDocument?.(newDoc);
      opts.syncHfPMs?.();
      opts.reLayout();
      opts.emit('change', newDoc);
    }

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
      variant,
      sectionIndex,
      headerFooter: hf,
      targetRect: {
        top: (elRect.top - vpRect.top + viewport.scrollTop) / z,
        left: (elRect.left - vpRect.left + viewport.scrollLeft) / z,
        width: elRect.width / z,
        height: elRect.height / z,
      },
    };
  }

  function handleHfSave(content: BlockContent[]) {
    const doc = opts.getDocument();
    const edit = hfEdit.value;
    if (!doc?.package || !edit) return;
    const map = edit.position === 'header' ? doc.package.headers : doc.package.footers;
    if (!map || !edit.rId) return;
    const existing = map.get(edit.rId);
    if (existing) {
      existing.content = content;
      existing.verbatimXml = undefined;
    }
    // Vue parity for the HF unification: after the inline overlay writes
    // back into `pkg.headers/footers[rId].content`, the persistent
    // EditorView for that rId still holds the pre-save doc. Re-syncing
    // re-mounts it from the new content so the painter — which reads
    // `view.state.doc` via `convertHeaderFooterPmDocToContent` — sees
    // the saved version. Hosts that haven't wired the new surface yet
    // (`syncHfPMs` is optional) still get the old behavior.
    opts.syncHfPMs?.();
    opts.reLayout();
    opts.emit('change', doc);
  }

  function handleHfRemove() {
    const doc = opts.getDocument();
    const edit = hfEdit.value;
    if (!doc?.package || !edit || !edit.rId) {
      hfEdit.value = null;
      return;
    }
    const newDoc = removeHeaderFooterForSection(doc, edit.position, edit.sectionIndex, edit.rId);

    hfEdit.value = null;
    opts.setDocument?.(newDoc);
    opts.syncHfPMs?.();
    opts.reLayout();
    opts.emit('change', newDoc);
  }

  function handlePagesMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    if (opts.imageInteracting.value) return;
    const body = opts.editorView.value;
    if (!body) return;

    const target = event.target as HTMLElement;

    // HF mode: clicks OUTSIDE the painted HF area close edit mode and refocus
    // the body PM. The body-PM-selection branch below also falls through, so
    // the next keystroke lands at the click site in the body.
    if (hfEdit.value) {
      const isInHfArea =
        target.closest('.layout-page-header') ||
        target.closest('.layout-page-footer') ||
        target.closest('.hf-editor');
      if (!isInHfArea) {
        hfEdit.value = null;
        body.focus();
        // Fall through — body-selection path resolves cursor at click coord.
      }
    }

    // Resolve the PM the user is currently editing (HF when active, body
    // otherwise). Every gesture below dispatches on this view.
    const view = activeView() ?? body;

    // Table resize: column / row / right-edge handles claim the gesture
    // regardless of which doc the cells belong to.
    if (!opts.readOnly.value && opts.tableResize.tryStartResize(event, view)) {
      return;
    }

    // Image click → NodeSelection on the active doc.
    const imageEl = findImageElement(target);
    if (imageEl) {
      event.preventDefault();
      event.stopPropagation();
      if (!opts.pagesAreCurrent()) {
        pendingImageSelection = { clientX: event.clientX, clientY: event.clientY };
        opts.requestOverlayRefresh();
        view.focus();
        return;
      }
      selectCurrentImageElement(imageEl);
      return;
    }

    // Click outside an image clears the image selection.
    pendingImageSelection = null;
    opts.selectedImage.value = null;

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
      // Single click — shift-click extends, plain click collapses.
      if (event.shiftKey) {
        const { from } = view.state.selection;
        setPmSelection(from, pos);
      } else {
        setPmSelection(pos);
      }
      dragAnchor = pos;
      isDragging = true;
      // Record the cell under the press so a drag across cells promotes to a
      // CellSelection (null when the press isn't inside a table).
      cellDrag.begin(findCellPosFromPmPos(view, pos));
    }

    view.focus();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging || dragAnchor === null) return;
    const pos = resolvePos(event.clientX, event.clientY);
    if (pos !== null) {
      const view = activeView();
      // A drag that crosses cell boundaries becomes a CellSelection; when it
      // does, skip the text-selection update for this move.
      if (view && cellDrag.update(view, pos, event.clientX)) {
        dragAutoScroll.updateMousePosition(event.clientX, event.clientY);
        return;
      }
      if (pos !== dragAnchor) {
        setPmSelection(dragAnchor, pos);
      }
    }
    // Drive edge auto-scroll while dragging.
    dragAutoScroll.updateMousePosition(event.clientX, event.clientY);
  }

  function handleMouseUp() {
    isDragging = false;
    cellDrag.end();
    dragAutoScroll.stopAutoScroll();
  }

  function handleViewportScroll() {
    const container = opts.pagesViewportRef.value;
    const pageLayout = opts.pageLayout.value;
    if (!container || !pageLayout || pageLayout.pages.length === 0) return;

    const scrollTop = container.scrollTop;
    const totalPages = pageLayout.pages.length;
    const PAGE_GAP = 24; // matches DEFAULT_PAGE_GAP in useDocxEditor
    const PADDING_TOP = 24;

    const viewportCenter = scrollTop + container.clientHeight / 2;
    let accumulatedY = PADDING_TOP;
    let currentPage = 1;
    for (let i = 0; i < pageLayout.pages.length; i++) {
      const pageHeight = pageLayout.pages[i].size.h;
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
    flushPendingImageSelection,
    // HF editor save/remove (bound to InlineHeaderFooterEditor events)
    handleHfSave,
    handleHfRemove,
  };
}

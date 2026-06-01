import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type {
  Document,
  Theme,
  SectionProperties,
  HeaderFooter,
  BlockContent,
} from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { Plugin } from 'prosemirror-state';
import {
  computeHfCaretRectFromView,
  readHfSelectionGeometry,
  invalidateHfDomCache,
} from '@eigenpal/docx-editor-core/layout-bridge';
import { applyCellSelectionHighlight } from './internals/domSelection';
import { extractSelectionState } from '@eigenpal/docx-editor-core/prosemirror';
import type { ExtensionManager } from '@eigenpal/docx-editor-core/prosemirror/extensions';
import type { SelectionState } from '@eigenpal/docx-editor-core/prosemirror';
import { PagedEditor, type PagedEditorRef } from './PagedEditor';
import {
  InlineHeaderFooterEditor,
  type InlineHeaderFooterEditorRef,
} from '../InlineHeaderFooterEditor';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { CommentMarginMarkers } from '../CommentMarginMarkers';
import { Tooltip } from '../ui/Tooltip';
import { MaterialSymbol } from '../ui/Icons';
import { PENDING_COMMENT_ID } from './commentFactories';
import type { HyperlinkPopupData } from '../ui/HyperlinkPopup';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import type { ReactSidebarItem } from '../../plugin-api/types';
import type { RenderedDomContext } from '../../plugin-api/types';

/**
 * Body of the editor: the paged ProseMirror host, its sidebar overlay
 * (UnifiedSidebar + comment margin markers), the floating "Add comment"
 * button anchored to a non-empty selection, and the inline header/footer
 * editor that appears when a user double-clicks an H/F slot.
 *
 * The floating button dispatches a pending comment mark inline rather
 * than going through onAddComment — same shape as the right-click menu's
 * addComment branch.
 */
export function DocxEditorPagedArea({
  // PagedEditor refs + state
  pagedEditorRef,
  hfEditorRef,
  scrollContainerRef,
  editorContentRef,
  // Document + section
  document,
  theme,
  initialSectionProperties,
  finalSectionProperties,
  // Header/footer
  headerContent,
  footerContent,
  firstPageHeaderContent,
  firstPageFooterContent,
  hfEditPosition,
  setHfEditPosition,
  hfEditIsFirstPage,
  onHeaderFooterDoubleClick,
  onHeaderFooterSave,
  onRemoveHeaderFooter,
  onBodyClick,
  getHfTargetElement,
  // Editor
  zoom,
  readOnly,
  extensionManager,
  externalPlugins,
  onDocumentChange,
  onSelectionChange,
  onPagedSelectionChange,
  onReady,
  onEditorViewReady,
  onRenderedDomContextReady,
  pluginOverlays,
  onHyperlinkClick,
  hyperlinkPopupData,
  onHyperlinkPopupNavigate,
  onHyperlinkPopupCopy,
  onHyperlinkPopupEdit,
  onHyperlinkPopupRemove,
  onHyperlinkPopupClose,
  onContextMenu,
  // Sidebar
  sidebarOpen,
  sidebarItems,
  anchorPositions,
  onAnchorPositionsChange,
  pluginRenderedDomContext,
  pageWidthPx,
  expandedSidebarItem,
  setExpandedSidebarItem,
  comments,
  resolvedCommentIds,
  resolvedIdsForRender,
  setShowCommentsSidebar,
  // Scroll page indicator
  onTotalPagesChange,
  // Floating comment button
  floatingCommentBtn,
  isAddingComment,
  setCommentSelectionRange,
  setAddCommentYPosition,
  setIsAddingComment,
  setFloatingCommentBtn,
}: {
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  hfEditorRef: React.RefObject<InlineHeaderFooterEditorRef | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  editorContentRef: React.RefObject<HTMLDivElement | null>;
  document: Document | null;
  theme: Theme | null | undefined;
  initialSectionProperties: SectionProperties | undefined;
  finalSectionProperties: SectionProperties | undefined;
  headerContent: HeaderFooter | null | undefined;
  footerContent: HeaderFooter | null | undefined;
  firstPageHeaderContent: HeaderFooter | null | undefined;
  firstPageFooterContent: HeaderFooter | null | undefined;
  hfEditPosition: 'header' | 'footer' | null;
  setHfEditPosition: React.Dispatch<React.SetStateAction<'header' | 'footer' | null>>;
  hfEditIsFirstPage: boolean;
  onHeaderFooterDoubleClick: (position: 'header' | 'footer', pageNumber?: number) => void;
  onHeaderFooterSave: (content: BlockContent[]) => void;
  onRemoveHeaderFooter: () => void;
  onBodyClick: () => void;
  getHfTargetElement: (pos: 'header' | 'footer') => HTMLElement | null;
  zoom: number;
  readOnly: boolean;
  extensionManager: ExtensionManager;
  externalPlugins: Plugin[];
  onDocumentChange: (doc: Document) => void;
  onSelectionChange: (state: SelectionState | null) => void;
  onPagedSelectionChange: () => void;
  onReady: (ref: PagedEditorRef) => void;
  onEditorViewReady: ((view: EditorView) => void) | undefined;
  onRenderedDomContextReady: ((ctx: RenderedDomContext) => void) | undefined;
  pluginOverlays: ReactNode;
  onHyperlinkClick: (data: HyperlinkPopupData) => void;
  hyperlinkPopupData: HyperlinkPopupData | null;
  onHyperlinkPopupNavigate: (href: string) => void;
  onHyperlinkPopupCopy: (href: string) => void;
  onHyperlinkPopupEdit: (displayText: string, href: string) => void;
  onHyperlinkPopupRemove: () => void;
  onHyperlinkPopupClose: () => void;
  onContextMenu: (data: {
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
  sidebarOpen: boolean;
  sidebarItems: ReactSidebarItem[];
  anchorPositions: Map<string, number>;
  onAnchorPositionsChange: (positions: Map<string, number>) => void;
  pluginRenderedDomContext: RenderedDomContext | null | undefined;
  pageWidthPx: number;
  expandedSidebarItem: string | null;
  setExpandedSidebarItem: React.Dispatch<React.SetStateAction<string | null>>;
  comments: Comment[];
  resolvedCommentIds: Set<number>;
  resolvedIdsForRender: Set<number>;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  onTotalPagesChange: (totalPages: number) => void;
  floatingCommentBtn: { top: number; left: number } | null;
  isAddingComment: boolean;
  setCommentSelectionRange: React.Dispatch<
    React.SetStateAction<{ from: number; to: number } | null>
  >;
  setAddCommentYPosition: React.Dispatch<React.SetStateAction<number | null>>;
  setIsAddingComment: React.Dispatch<React.SetStateAction<boolean>>;
  setFloatingCommentBtn: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>;
}) {
  // Resolve the active HF block for the inline editor — first-page variant
  // wins when `titlePg` is set and the user double-clicked page 1.
  const activeHf = hfEditPosition
    ? hfEditIsFirstPage
      ? hfEditPosition === 'header'
        ? firstPageHeaderContent
        : firstPageFooterContent
      : hfEditPosition === 'header'
        ? headerContent
        : footerContent
    : null;

  // Phase 4 of HF editing unification: the painter is the visible HF
  // renderer (phase 2) and the inline overlay's PM is off-screen — so the
  // user has no visible caret in the painted region. We compute one here
  // on every HF transaction (doc OR selection-only) by mapping the HF
  // EditorView's selection head to the painter's `data-doc-from` markers
  // and render a fixed-positioned blinking div over the painted HF.
  const [hfCaretRect, setHfCaretRect] = useState<{
    top: number;
    left: number;
    height: number;
  } | null>(null);

  // HF selection rects — drawn when the user drag-selects a range inside
  // the painted header/footer. Body's SelectionOverlay is gated off in HF
  // mode (see PagedEditor) so the body rects don't render alongside.
  const [hfSelectionGeometry, setHfSelectionGeometry] = useState<
    Array<{ top: number; left: number; width: number; height: number }>
  >([]);

  const computeHfCaretRect = useCallback(
    (view: EditorView): typeof hfCaretRect => computeHfCaretRectFromView(view),
    []
  );

  // Initial-caret-on-engage: when the user double-clicks into HF mode the
  // persistent PM's selection sits at position 0 with no transaction fired,
  // so `onHfTransaction` never gets a chance to paint the caret. Wait for
  // the painter to finish its repaint (rAF × 2 — one for React commit,
  // one for the painter pass `runLayoutPipeline` schedules), then measure
  // against the freshly painted spans.
  useEffect(() => {
    if (!hfEditPosition) {
      setHfCaretRect(null);
      setHfSelectionGeometry([]);
      invalidateHfDomCache();
      return;
    }
    const measure = () => {
      const view = hfEditorRef.current?.getView();
      if (view) {
        setHfCaretRect(computeHfCaretRect(view));
        setHfSelectionGeometry(readHfSelectionGeometry(view));
        const pagesEl = window.document.querySelector('.paged-editor__pages') as HTMLElement | null;
        if (pagesEl) applyCellSelectionHighlight(pagesEl, view.state, { scope: 'hf' });
      }
    };

    // Deterministic "painter is done" signal — `useLayoutPipeline` dispatches
    // `painter:painted` after `paintPages` writes the page DOM. Listen for
    // it instead of the rAF chain so the measurement always sees the fresh
    // `data-doc-from` spans. Also invalidate the cached HF DOM snapshot so
    // the next caret compute re-walks the host.
    const pagesEl = window.document.querySelector('.paged-editor__pages') as HTMLElement | null;
    const onPainted = () => {
      invalidateHfDomCache();
      measure();
    };
    pagesEl?.addEventListener('painter:painted', onPainted);

    // Safety: if the painter doesn't fire for the initial engage (no doc
    // change → no layout pass), still measure on the next frame so the
    // caret shows up at all.
    const raf = requestAnimationFrame(measure);

    // Resize still needs a recompute because the painter re-runs after a
    // viewport resize and the span layout shifts. The painter dispatches
    // `painter:painted` after its rerun, but the listener may have been
    // re-registered between the two — wire resize as a belt-and-braces.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      pagesEl?.removeEventListener('painter:painted', onPainted);
      window.removeEventListener('resize', onResize);
      invalidateHfDomCache();
    };
  }, [hfEditPosition, hfEditorRef, computeHfCaretRect]);

  return (
    <>
      <PagedEditor
        ref={pagedEditorRef}
        document={document}
        styles={document?.package.styles}
        theme={document?.package.theme || theme}
        sectionProperties={initialSectionProperties}
        finalSectionProperties={finalSectionProperties}
        headerContent={headerContent}
        footerContent={footerContent}
        firstPageHeaderContent={firstPageHeaderContent}
        firstPageFooterContent={firstPageFooterContent}
        onHeaderFooterDoubleClick={onHeaderFooterDoubleClick}
        hfEditMode={hfEditPosition}
        onBodyClick={onBodyClick}
        onHfTransaction={(_rId, view, _docChanged) => {
          // Phase 5: the persistent HF PM is the sole editor. On every
          // transaction (typing, click → setSelection, undo/redo) we need
          // the caret to follow — deferred to rAF so the painter's repaint
          // (triggered by `runLayoutPipeline` inside PagedEditor) lands
          // before we measure against `data-doc-from` spans. Toolbar
          // selection state still rides through `onSelectionChange` on
          // the inline overlay's old wiring path, which now reads from
          // the persistent view via `hfEditorRef.getView()`.
          // Painter dispatches `painter:painted` after `paintPages`.
          // Wait for it so the cache invalidation + caret measurement sees
          // the fresh span layout. Selection-only transactions skip the
          // painter, so use a one-shot rAF as a fallback.
          const pagesEl = window.document.querySelector(
            '.paged-editor__pages'
          ) as HTMLElement | null;
          let painted = false;
          const apply = () => {
            if (painted) return;
            painted = true;
            invalidateHfDomCache();
            setHfCaretRect(computeHfCaretRect(view));
            setHfSelectionGeometry(readHfSelectionGeometry(view));
            // Multi-cell selection renders via `.layout-table-cell-selected`.
            // Mirror the body call here so HF drag-select highlights work.
            if (pagesEl) applyCellSelectionHighlight(pagesEl, view.state, { scope: 'hf' });
          };
          pagesEl?.addEventListener('painter:painted', apply, { once: true });
          requestAnimationFrame(() => {
            if (!painted) {
              pagesEl?.removeEventListener('painter:painted', apply);
              apply();
            }
          });
          onSelectionChange(extractSelectionState(view.state));
        }}
        // Click routing through `onHfPagesMouseDown` was retired; usePagesPointer
        // now routes every HF gesture (click, drag, dblclick, image, hyperlink,
        // context menu) through the active-surface helper directly.
        zoom={zoom}
        readOnly={readOnly}
        extensionManager={extensionManager}
        onDocumentChange={onDocumentChange}
        onSelectionChange={onPagedSelectionChange}
        externalPlugins={externalPlugins}
        onReady={(ref) => {
          onReady(ref);
          const view = ref.getView();
          if (view) onEditorViewReady?.(view);
        }}
        onRenderedDomContextReady={onRenderedDomContextReady}
        pluginOverlays={pluginOverlays}
        onHyperlinkClick={onHyperlinkClick}
        hyperlinkPopupData={hyperlinkPopupData}
        onHyperlinkPopupNavigate={onHyperlinkPopupNavigate}
        onHyperlinkPopupCopy={onHyperlinkPopupCopy}
        onHyperlinkPopupEdit={onHyperlinkPopupEdit}
        onHyperlinkPopupRemove={onHyperlinkPopupRemove}
        onHyperlinkPopupClose={onHyperlinkPopupClose}
        onContextMenu={onContextMenu}
        commentsSidebarOpen={sidebarOpen}
        onAnchorPositionsChange={onAnchorPositionsChange}
        onTotalPagesChange={onTotalPagesChange}
        resolvedCommentIds={resolvedIdsForRender}
        scrollContainerRef={scrollContainerRef}
        sidebarOverlay={
          <>
            {sidebarItems.length > 0 && (
              <UnifiedSidebar
                items={sidebarItems}
                anchorPositions={anchorPositions}
                renderedDomContext={pluginRenderedDomContext ?? null}
                pageWidth={pageWidthPx}
                zoom={zoom}
                editorContainerRef={scrollContainerRef}
                onExpandedItemChange={setExpandedSidebarItem}
                activeItemId={expandedSidebarItem}
              />
            )}
            <CommentMarginMarkers
              comments={comments}
              anchorPositions={anchorPositions}
              zoom={zoom}
              pageWidth={pageWidthPx}
              sidebarOpen={sidebarOpen}
              resolvedCommentIds={resolvedCommentIds}
              onMarkerClick={() => setShowCommentsSidebar(true)}
            />
          </>
        }
      />

      {floatingCommentBtn != null && !isAddingComment && !readOnly && (
        <Tooltip content="Add comment" side="bottom" delayMs={300}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const view = pagedEditorRef.current?.getView();
              if (view) {
                const { from, to } = view.state.selection;
                if (from !== to) {
                  setCommentSelectionRange({ from, to });
                  const pendingMark = view.state.schema.marks.comment.create({
                    commentId: PENDING_COMMENT_ID,
                  });
                  const tr = view.state.tr.addMark(from, to, pendingMark);
                  tr.setSelection(TextSelection.create(tr.doc, to));
                  view.dispatch(tr);
                }
              }
              setAddCommentYPosition(floatingCommentBtn.top);
              setShowCommentsSidebar(true);
              setIsAddingComment(true);
              setFloatingCommentBtn(null);
            }}
            style={{
              position: 'absolute',
              top: floatingCommentBtn.top,
              left: floatingCommentBtn.left,
              transform: 'translate(-50%, -50%)',
              zIndex: 50,
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid rgba(26, 115, 232, 0.3)',
              backgroundColor: '#fff',
              color: '#1a73e8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(60,64,67,0.2)',
              transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                'rgba(26, 115, 232, 0.08)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                '0 1px 4px rgba(26, 115, 232, 0.3)';
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff';
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                '0 1px 3px rgba(60,64,67,0.2)';
            }}
          >
            <MaterialSymbol name="add_comment" size={16} />
          </button>
        </Tooltip>
      )}

      {/* HF caret + selection rects portalled into the SIBLING parent of
          `.paged-editor__pages` (same scroll container the body's
          `SelectionOverlay` uses). `position: absolute` + container-relative
          coords means the browser moves them with the painter on scroll —
          zero JS per wheel tick. Crisper than `position: fixed` + scroll
          listener. The painter never touches this layer (siblings, not
          children of `.paged-editor__pages`), so the wipe-on-rebuild
          regression that bit the previous portal attempt is avoided. */}
      {hfEditPosition &&
        (hfCaretRect || hfSelectionGeometry.length > 0) &&
        (() => {
          const pagesEl = window.document.querySelector(
            '.paged-editor__pages'
          ) as HTMLElement | null;
          const host = pagesEl?.parentElement as HTMLElement | null;
          if (!pagesEl || !host) return null;
          const c = host.getBoundingClientRect();
          const toLocal = (top: number, left: number) => ({
            top: top - c.top + host.scrollTop,
            left: left - c.left + host.scrollLeft,
          });
          return createPortal(
            <>
              {hfCaretRect && hfSelectionGeometry.length === 0 && (
                <>
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      ...toLocal(hfCaretRect.top, hfCaretRect.left),
                      width: 2,
                      height: hfCaretRect.height,
                      background: '#4285f4',
                      pointerEvents: 'none',
                      zIndex: 11,
                      animation: 'hf-caret-blink 1.06s steps(1) infinite',
                    }}
                  />
                  <style>{`@keyframes hf-caret-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }`}</style>
                </>
              )}
              {hfSelectionGeometry.map((r, i) => {
                const local = toLocal(r.top, r.left);
                return (
                  <div
                    key={`hf-sel-${i}-${r.top}-${r.left}`}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: local.top,
                      left: local.left,
                      width: r.width,
                      height: r.height,
                      background: 'rgba(66, 133, 244, 0.25)',
                      pointerEvents: 'none',
                      zIndex: 10,
                    }}
                  />
                );
              })}
            </>,
            host
          );
        })()}

      {hfEditPosition &&
        activeHf &&
        (() => {
          const targetEl = getHfTargetElement(hfEditPosition);
          const parentEl = editorContentRef.current;
          if (!targetEl || !parentEl) return null;
          // Phase 5: the inline overlay is now UI chrome only — it takes
          // the persistent HF EditorView as a prop and never creates its
          // own PM. Toolbar / save / undo all route through the persistent
          // view via `hfEditorRef`.
          const persistentView = pagedEditorRef.current?.getHfPmView(activeHf) ?? null;
          return (
            <InlineHeaderFooterEditor
              ref={hfEditorRef}
              headerFooter={activeHf}
              position={hfEditPosition}
              view={persistentView}
              targetElement={targetEl}
              parentElement={parentEl}
              onSave={onHeaderFooterSave}
              onClose={() => {
                setHfEditPosition(null);
                setHfCaretRect(null);
              }}
              onRemove={onRemoveHeaderFooter}
            />
          );
        })()}
    </>
  );
}

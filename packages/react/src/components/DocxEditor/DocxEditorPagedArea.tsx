import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ReactNode } from 'react';
import type {
  Document,
  Theme,
  SectionProperties,
  HeaderFooter,
  Paragraph,
  Table,
} from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { Plugin } from 'prosemirror-state';
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
  onHeaderFooterSave: (content: (Paragraph | Table)[]) => void;
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

      {hfEditPosition &&
        activeHf &&
        (() => {
          const targetEl = getHfTargetElement(hfEditPosition);
          const parentEl = editorContentRef.current;
          if (!targetEl || !parentEl) return null;
          return (
            <InlineHeaderFooterEditor
              ref={hfEditorRef}
              headerFooter={activeHf}
              position={hfEditPosition}
              styles={document?.package.styles}
              targetElement={targetEl}
              parentElement={parentEl}
              onSave={onHeaderFooterSave}
              onClose={() => setHfEditPosition(null)}
              onSelectionChange={onSelectionChange}
              onRemove={onRemoveHeaderFooter}
            />
          );
        })()}
    </>
  );
}

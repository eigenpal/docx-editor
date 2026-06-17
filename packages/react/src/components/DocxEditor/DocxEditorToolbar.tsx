import type { CSSProperties, ReactNode } from 'react';
import type { EditorState as PMEditorState } from 'prosemirror-state';
import { undoDepth, redoDepth } from 'prosemirror-history';
import type { Theme, Document } from '@eigenpal/docx-editor-core/types/document';
import { EditorToolbar } from '../EditorToolbar';
import { ToolbarSeparator, type SelectionFormatting, type FormattingAction } from '../Toolbar';
import type { FontOption } from '../ui/FontPicker';
import type { TableAction } from '../ui/TableToolbar';
import type { TableContextInfo } from '@eigenpal/docx-editor-core/prosemirror';
import { CommentsSidebarToggle } from './CommentsSidebarToggle';
import { EditingModeDropdown } from './EditingModeDropdown';
import { AgentPanelToggle } from './AgentPanelToggle';
import type { EditorMode } from './internals/editing-modes';
import type { AgentPanelOptions } from './types';

interface ImageContext {
  pos: number;
  wrapType: string;
  displayMode: string;
  cssFloat: string | null;
  transform: string | null;
  alt: string | null;
  borderWidth: number | null;
  borderColor: string | null;
  borderKind: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Top-of-editor toolbar — the EditorToolbar compound component wired up
 * with the document state (selection formatting, table/image context,
 * undo/redo depth), plus the title bar slots (logo, document name,
 * right-side actions, menu bar) and the trailing toolbar extras
 * (comments sidebar toggle, editing mode dropdown, agent-panel toggle).
 *
 * Rounded bottom-right corner mirrors the agent panel's top-left when
 * the panel is open; the radius transition smooths the open/close.
 *
 * `pmState` drives `canUndo` / `canRedo` via `undoDepth` / `redoDepth`
 * computed inside the toolbar rather than the orchestrator so the deps
 * stay local.
 */
export function DocxEditorToolbar({
  toolbarRefCallback,
  agentPanelOpen,
  setAgentPanelOpen,
  // Doc state
  document,
  theme,
  pmState,
  selectionFormatting,
  tableContext,
  imageContext,
  // Editor modes + flags
  readOnly,
  editingMode,
  setEditingMode,
  setShowCommentsSidebar,
  setExpandedSidebarItem,
  showCommentsSidebar,
  agentPanel,
  // Customisation slots
  renderLogo,
  documentName,
  onDocumentNameChange,
  documentNameEditable,
  renderTitleBarRight,
  toolbarExtra,
  fontFamilies,
  zoom,
  showZoomControl,
  // Handlers
  onFormat,
  onUndo,
  onRedo,
  onPrint,
  showFileOpen,
  onOpen,
  onSave,
  onZoomChange,
  onRefocusEditor,
  onInsertTable,
  onInsertImage,
  onInsertPageBreak,
  onInsertSectionBreakNextPage,
  onInsertSectionBreakContinuous,
  onInsertTOC,
  onImageWrapType,
  onImageTransform,
  onOpenImageProperties,
  onPageSetup,
  onWatermark,
  onTableAction,
}: {
  toolbarRefCallback: (el: HTMLDivElement | null) => void;
  agentPanelOpen: boolean;
  setAgentPanelOpen: (next: boolean) => void;
  document: Document | null;
  theme: Theme | null | undefined;
  pmState: PMEditorState | null;
  selectionFormatting: SelectionFormatting;
  tableContext: TableContextInfo | null;
  imageContext: ImageContext | null;
  readOnly: boolean;
  editingMode: EditorMode;
  setEditingMode: (mode: EditorMode) => void;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandedSidebarItem: React.Dispatch<React.SetStateAction<string | null>>;
  showCommentsSidebar: boolean;
  agentPanel: AgentPanelOptions | undefined;
  renderLogo: (() => ReactNode) | undefined;
  documentName: string | undefined;
  onDocumentNameChange: ((name: string) => void) | undefined;
  documentNameEditable: boolean | undefined;
  renderTitleBarRight: (() => ReactNode) | undefined;
  toolbarExtra: ReactNode;
  fontFamilies: ReadonlyArray<string | FontOption> | undefined;
  zoom: number;
  showZoomControl: boolean;
  onFormat: (action: FormattingAction) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPrint: () => void;
  showFileOpen: boolean;
  onOpen: () => void;
  onSave: () => void | Promise<void>;
  onZoomChange: (zoom: number) => void;
  onRefocusEditor: () => void;
  onInsertTable: (rows: number, columns: number) => void;
  onInsertImage: () => void;
  onInsertPageBreak: () => void;
  onInsertSectionBreakNextPage: () => void;
  onInsertSectionBreakContinuous: () => void;
  onInsertTOC: () => void;
  onImageWrapType: (value: string) => void;
  onImageTransform: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
  onOpenImageProperties: () => void;
  onPageSetup: () => void;
  onWatermark: () => void;
  onTableAction: (action: TableAction) => void;
}) {
  // Radius transition matches the agent panel's open/close so the seam
  // between toolbar bottom-right and panel top-left is smooth.
  const toolbarStyle: CSSProperties = {
    transition: 'border-radius 220ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div ref={toolbarRefCallback} className="z-50 flex flex-col gap-0 flex-shrink-0">
      <EditorToolbar
        className={agentPanelOpen ? 'rounded-br-2xl' : undefined}
        style={toolbarStyle}
        currentFormatting={selectionFormatting}
        onFormat={onFormat}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={pmState ? undoDepth(pmState) > 0 : false}
        canRedo={pmState ? redoDepth(pmState) > 0 : false}
        disabled={readOnly}
        documentStyles={document?.package.styles?.styles}
        theme={document?.package.theme || theme}
        fontFamilies={fontFamilies}
        onPrint={onPrint}
        onOpen={showFileOpen ? onOpen : undefined}
        onSave={onSave}
        showZoomControl={showZoomControl}
        zoom={zoom}
        onZoomChange={onZoomChange}
        onRefocusEditor={onRefocusEditor}
        onInsertTable={onInsertTable}
        showTableInsert={true}
        onInsertImage={onInsertImage}
        onInsertPageBreak={onInsertPageBreak}
        onInsertSectionBreakNextPage={onInsertSectionBreakNextPage}
        onInsertSectionBreakContinuous={onInsertSectionBreakContinuous}
        onInsertTOC={onInsertTOC}
        imageContext={imageContext}
        onImageWrapType={onImageWrapType}
        onImageTransform={onImageTransform}
        onOpenImageProperties={onOpenImageProperties}
        onPageSetup={onPageSetup}
        onWatermark={onWatermark}
        tableContext={tableContext}
        onTableAction={onTableAction}
      >
        <EditorToolbar.TitleBar>
          {renderLogo && <EditorToolbar.Logo>{renderLogo()}</EditorToolbar.Logo>}
          {documentName !== undefined && (
            <EditorToolbar.DocumentName
              value={documentName}
              onChange={onDocumentNameChange}
              editable={documentNameEditable}
            />
          )}
          {renderTitleBarRight && (
            <EditorToolbar.TitleBarRight>{renderTitleBarRight()}</EditorToolbar.TitleBarRight>
          )}
          <EditorToolbar.MenuBar />
        </EditorToolbar.TitleBar>
        <EditorToolbar.Toolbar>
          <ToolbarSeparator />
          <CommentsSidebarToggle
            active={showCommentsSidebar}
            onClick={() => {
              // Reset expansion so reshowing the sidebar lands on the default
              // collapsed state — resolved threads stay as checkmarks, not opened.
              setShowCommentsSidebar((v) => !v);
              setExpandedSidebarItem(null);
            }}
          />
          <ToolbarSeparator />
          <EditingModeDropdown
            mode={editingMode}
            onModeChange={(mode) => {
              setEditingMode(mode);
              if (mode === 'suggesting') setShowCommentsSidebar(true);
            }}
          />
          {agentPanel && agentPanel.showToolbarButton !== false && (
            <>
              <ToolbarSeparator />
              <AgentPanelToggle
                active={agentPanelOpen}
                badge={agentPanel.toolbarBadge}
                onClick={() => setAgentPanelOpen(!agentPanelOpen)}
              />
            </>
          )}
          {toolbarExtra}
        </EditorToolbar.Toolbar>
      </EditorToolbar>
    </div>
  );
}

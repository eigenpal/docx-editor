/**
 * @docx-editor.dev/react
 *
 * React adapter for the DOCX editor. A thin renderer over the `Editor`
 * contract from `@docx-editor.dev/core-contract`: it supplies DOM and paints
 * the engine's positioned display list, and holds no editing-engine state.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

export { DocxEditor } from './components/DocxEditor';
export type { DocxEditorProps, DocxEditorRef, EditorMode } from './types';

// Re-export the contract types a consumer needs to drive the editor.
export type {
  Editor,
  EditorHost,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
} from '@docx-editor.dev/core-contract/editor';
export type { DisplayPage, DisplayItem, DocPoint } from '@docx-editor.dev/core-contract/geometry';
export type { DocxDocument } from '@docx-editor.dev/core-contract/types';
export {
  runSave,
  runToolbarCommand,
  toolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
  type ToolbarCommandId,
  type ToolbarCommandState,
} from './toolbarCommands';
export { DocxEditorShell, type DocxEditorShellProps } from './components/DocxEditor/DocxEditorShell';
export { DocxEditorTitleBar, type DocxEditorTitleBarProps } from './components/DocxEditor/DocxEditorTitleBar';
export { DocxEditorToolbar, type DocxEditorToolbarProps } from './components/DocxEditor/DocxEditorToolbar';
export { DocxEditorMenuBar, type DocxEditorMenuBarProps } from './components/DocxEditor/DocxEditorMenuBar';
export { DocxEditorSidebar, DEFERRED_DIALOGS, type DocxEditorSidebarProps, type SidebarPanel, type DeferredDialogId } from './components/DocxEditor/DocxEditorSidebar';
export { PageIndicator, type PageIndicatorProps } from './components/DocxEditor/PageIndicator';
export { HorizontalRuler, type HorizontalRulerProps } from './components/ui/HorizontalRuler';
export { VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './components/ui/VerticalRuler';
export { generateRulerTicks, rulerPageBox, PX_PER_INCH, PX_PER_CM, type RulerTick, type RulerUnit } from './rulerTicks';
export { useEditorSnapshot } from './useEditorSnapshot';

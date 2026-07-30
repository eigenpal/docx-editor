/**
 * @docx-editor.dev/vue
 *
 * Vue 3 adapter for the DOCX editor. A thin renderer over the `Editor`
 * contract from `@docx-editor.dev/core-contract`: it supplies DOM and paints
 * the engine's positioned display list, and holds no editing-engine state.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

export { default as DocxEditor } from './DocxEditor';
export { PaginatedDocxEditor } from './components/PaginatedDocxEditor';
export type {
  PaginatedDocxEditorExpose,
  PaginatedDocxEditorHandle,
  PaginatedDocxEditorProps,
} from './components/PaginatedDocxEditor';
export { EditorFontError } from './types';
export type {
  DocxEditorProps,
  DocxEditorRef,
  EditorMode,
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from './types';

// Re-export the contract types a consumer needs to drive the editor.
export type {
  Editor,
  EditorHost,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
} from '@docx-editor.dev/core-contract/contracts/editor';
export type {
  DisplayPage,
  DisplayItem,
  DocPoint,
} from '@docx-editor.dev/core-contract/contracts/geometry';
export type { DocxDocument } from '@docx-editor.dev/core-contract/contracts/types';
export { default as DocxEditorShell, type DocxEditorShellProps } from './DocxEditorShell';
export { default as DocxEditorTitleBar, type DocxEditorTitleBarProps } from './DocxEditorTitleBar';
export { default as DocxEditorToolbar, type DocxEditorToolbarProps } from './DocxEditorToolbar';
export { default as PageIndicator, type PageIndicatorProps } from './PageIndicator';
export { default as HorizontalRuler, type HorizontalRulerProps } from './HorizontalRuler';
export { default as VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './VerticalRuler';
export {
  default as DocxEditorSidebar,
  DEFERRED_DIALOGS,
  type DocxEditorSidebarProps,
  type SidebarPanel,
  type DeferredDialogId,
} from './DocxEditorSidebar';
export { useEditorSnapshot } from './useEditorSnapshot';
// The shared engine helpers both adapters expose, so the two package surfaces
// match (enforced by `bun run check:export-parity`).
export {
  commandForSlot,
  runSave,
  runToolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
  type ChromeSlotId,
  type ToolbarCommandState,
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from '@docx-editor.dev/core-contract/editor';

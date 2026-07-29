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
export { PaginatedDocxEditor } from './components/PaginatedDocxEditor';
export type {
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
} from '@docx-editor.dev/core-contract/editor';
export type { DisplayPage, DisplayItem, DocPoint } from '@docx-editor.dev/core-contract/geometry';
export type { DocxDocument } from '@docx-editor.dev/core-contract/types';
export { DocxEditorShell } from './components/DocxEditor/DocxEditorShell';
// The legacy components replace the interim ones that used to be exported here.
export { Toolbar, ToolbarButton, ToolbarGroup, type ToolbarProps } from './components/Toolbar';
export { TitleBar, MenuBar, DocumentName, Logo, TitleBarRight } from './components/TitleBar';
export { PageIndicator } from './components/DocxEditor/PageIndicator';
export { HorizontalRuler, type HorizontalRulerProps } from './components/ui/HorizontalRuler';
export { VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './components/ui/VerticalRuler';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './rulerTicks';
export { useEditorSnapshot } from './useEditorSnapshot';

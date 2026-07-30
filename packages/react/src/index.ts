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

export { DocxEditor, type DocxEditorNamespace } from './components/DocxEditor';

// Provider-first composition layer: the primitives behind `DocxEditor` (also reachable
// as `DocxEditor.Root` / `.Viewport` / `.Content`) and the hooks a custom chrome is
// built from.
export { DocxEditorRoot, type DocxEditorRootProps } from './editor/DocxEditorRoot';
export { DocxEditorViewport, type DocxEditorViewportProps } from './editor/DocxEditorViewport';
export { DocxEditorContent, type DocxEditorContentProps } from './editor/DocxEditorContent';
export { useDocxEditor } from './editor/context';
export { useEditorState } from './editor/useEditorState';
export { useEditorCommand, type EditorCommandState } from './editor/useEditorCommand';
export { useEditorEvent } from './editor/useEditorEvent';

// The compound toolbar (also reachable as `DocxEditor.Toolbar`): default set with
// in-place slot overrides, generic Button, and the font-family compound + hook. The
// concrete part components live on the namespace statics; the index exports the
// namespace, the hook, and the part prop types (the existing `Toolbar`/`ToolbarButton`
// exports below keep their names, so the new parts are not re-exported bare).
export {
  DocxEditorToolbar,
  useFontFamily,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type ToolbarButtonProps,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
  type ToolbarTranslate,
  type UseFontFamilyResult,
} from './editor/toolbar';

// The shared engine helpers both adapters expose, so the two package surfaces
// match (enforced by `bun run check:export-parity`).
export {
  CHROME_GROUPS,
  commandForSlot,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core-contract/editor';
export { PaginatedDocxEditor } from './components/PaginatedDocxEditor';
export { PaginatedDocxEditorShell } from './components/PaginatedDocxEditorShell';
export type { PaginatedDocxEditorShellProps } from './components/PaginatedDocxEditorShell';
export type {
  PaginatedDocxEditorHandle,
  // The Vue name for the same contract, exported so the two adapters pair by name.
  PaginatedDocxEditorHandle as PaginatedDocxEditorExpose,
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
export { DocxEditorShell } from './components/DocxEditor/DocxEditorShell';
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

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

export { DocxEditor } from './DocxEditor';
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
export type {
  DisplayPage,
  DisplayItem,
  DocPoint,
} from '@docx-editor.dev/core-contract/geometry';
export type { DocxDocument } from '@docx-editor.dev/core-contract/types';

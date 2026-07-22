import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { DocxDocument } from '@docx-editor.dev/core-contract/types';

export type EditorMode = 'edit' | 'view';

/**
 * Props for the Vue `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own.
 */
export interface DocxEditorProps {
  document?: DocxDocument;
  mode?: EditorMode;
  zoom?: number;
  locale?: string;
}

/** Exposed instance handle. Advanced callers reach the facade via `getEditor`. */
export interface DocxEditorRef {
  exec: Editor['exec'];
  snapshot: Editor['snapshot'];
  save: Editor['save'];
  focus: Editor['focus'];
  getEditor(): Editor | null;
}

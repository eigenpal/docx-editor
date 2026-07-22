import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { DocxDocument } from '@docx-editor.dev/core-contract/types';

export type EditorMode = 'edit' | 'view';

/**
 * Props for the React `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own.
 */
export interface DocxEditorProps {
  /** A parsed document to load. */
  document?: DocxDocument;
  mode?: EditorMode;
  zoom?: number;
  locale?: string;
  className?: string;
  /** Fired after the underlying `Editor` is created. */
  onReady?: (editor: Editor) => void;
  /** Fired when the document changes. */
  onChange?: (document: DocxDocument) => void;
}

/** Imperative handle. Advanced callers reach the full facade via `getEditor`. */
export interface DocxEditorRef {
  exec: Editor['exec'];
  snapshot: Editor['snapshot'];
  save: Editor['save'];
  focus: Editor['focus'];
  getEditor(): Editor | null;
}

import type { Editor, DocumentSource, DocumentChange } from '@docx-editor.dev/core-contract/editor';

export type EditorMode = 'edit' | 'view';

/**
 * Props for the React `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own and never
 * imports ProseMirror or OOXML feature logic.
 */
export interface DocxEditorProps {
  /** A document to load: DOCX bytes or an existing handle. */
  document?: DocumentSource;
  /** 'edit' (default) or 'view' (read-only). Applied at mount only — not reactive; remount to change. */
  mode?: EditorMode;
  zoom?: number;
  locale?: string;
  author?: string;
  className?: string;
  /** Fired after the underlying `Editor` is created. */
  onReady?: (editor: Editor) => void;
  /** Fired when the document changes (revision + identity deltas, not bytes). */
  onChange?: (change: DocumentChange) => void;
}

/** Imperative handle. Advanced callers reach the full facade via `getEditor`. */
export interface DocxEditorRef {
  load: Editor['load'];
  save: Editor['save'];
  focus: Editor['focus'];
  exec: Editor['exec'];
  snapshot: Editor['snapshot'];
  getDocumentHandle: Editor['getDocumentHandle'];
  getEditor(): Editor | null;
}

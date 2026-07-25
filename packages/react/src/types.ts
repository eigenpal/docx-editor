import type { ReactNode } from 'react';
import type { Editor, DocumentSource, DocumentChange } from '@docx-editor.dev/core-contract/editor';

export type EditorMode = 'edit' | 'view';

/**
 * Props for the React `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own and never
 * imports ProseMirror or OOXML feature logic.
 */
export interface DocxEditorProps {
  /**
   * Title-bar slots, as the legacy editor took them.
   *
   * The demo owns what goes here — brand lockup, adapter/example switchers, theme
   * toggle, Open/New/Save — and passes them in (see `App.tsx:835-865` in the legacy
   * repo). the interim implementation had those regions inside this component instead, which is why
   * they kept drifting from the product: `AdapterSwitcher` and `ExampleSwitcher` already
   * existed in `examples/shared` and those regions had drifted from the product.
   */
  readonly renderTitleBarLeft?: () => ReactNode;
  readonly renderTitleBarRight?: () => ReactNode;
  /**
   * Resolves i18n keys for the legacy chrome (task M6V.1).
   *
   * Supplying it renders the full application chrome — title, menu region, toolbar,
   * rulers, page indicator, and sidebar — around the painted surface. Omitting it
   * renders the bare surface, which is what every existing consumer gets today.
   *
   * Required for chrome rather than defaulted, because `packages/i18n/en.json` is the
   * repo's single source of truth for user-facing strings and the adapter must ship no
   * English of its own.
   */
  t?: (key: string) => string;
  /** Document title shown in the chrome's title bar. */
  title?: string;
  /** Called when the title is edited. Omitting it makes the title read-only. */
  onTitleChange?: (title: string) => void;
  /** Save handler for the chrome's save control. Runs `Editor.save()` at the host. */
  onSave?: () => void;
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

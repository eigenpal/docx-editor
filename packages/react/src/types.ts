import type { ReactNode } from 'react';
import type {
  DocumentChange,
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorFontError,
  FontConfiguration,
  TextMatch,
} from '@docx-editor.dev/core-contract/contracts/editor';
export { EditorFontError } from '@docx-editor.dev/core-contract/contracts/editor';
export type {
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core-contract/contracts/editor';

export type EditorMode = 'edit' | 'view';

/**
 * Props for the React `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own and never
 * imports ProseMirror or OOXML feature logic.
 */
export interface DocxEditorProps {
  /**
   * Immutable byte-backed font sources sampled at mount. Remount to replace this
   * configuration atomically.
   */
  fonts: FontConfiguration;
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
   * Chrome colour mode. `'system'` follows the OS and re-resolves when it changes.
   * Only the editor CHROME is themed — the document canvas stays Word-faithful.
   */
  readonly colorMode?: 'light' | 'dark' | 'system';
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
  /** Fired with the same typed font failure shown by the accessible alert UI. */
  onFontError?: (error: EditorFontError) => void;
  /** Fired when the document changes (revision + identity deltas, not bytes). */
  onChange?: (change: DocumentChange) => void;
}

/** Imperative handle. Advanced callers reach the full facade via `getEditor`. */
/**
 * The imperative handle, in legacy's shape so a host that held a ref keeps calling what
 * it called. Three of legacy's methods are deliberately absent — `getAgent`,
 * `getDocument` and `getEditorRef` — because they exposed the legacy document tree and a
 * ProseMirror view; `getDocumentHandle` and `getEditor` replace them.
 *
 * Methods whose capability is still a stub return the honest empty answer (`false`,
 * `null`, `0`) rather than pretending, so a caller can tell "not supported yet" from
 * "did nothing".
 */
export interface DocxEditorRef {
  load(document: DocumentSource): void;
  loadDocumentBuffer(buffer: DocumentSource): Promise<void>;
  save(): Promise<ArrayBuffer | null>;
  getDocumentHandle(): DocumentHandle | null;
  getEditor(): Editor | null;

  focus(): void;
  getZoom(): number;
  setZoom(zoom: number): void;
  getCurrentPage(): number;
  getTotalPages(): number;
  scrollToPage(pageNumber: number): boolean;
  scrollToParaId(paraId: string): boolean;
  print(): void;

  updateTableOfContents(): boolean;
  findInDocument(
    query: string,
    options?: { caseSensitive?: boolean; limit?: number }
  ): readonly TextMatch[];

  addComment(options: { paraId: string; text: string; author: string }): number | null;
  replyToComment(commentId: number, text: string, author: string): number | null;
  resolveComment(commentId: number): boolean;
  proposeChange(options: {
    paraId: string;
    search: string;
    replaceWith: string;
    author: string;
  }): number | null;
}

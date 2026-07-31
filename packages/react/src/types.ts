import type { ReactNode } from 'react';
import type {
  DocumentChange,
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorCommand,
  EditorFontError,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  FontConfiguration,
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
   * Title-bar slots. The host owns what goes here — brand lockup, switchers, theme
   * toggle, Open/New/Save controls — and passes them in; the editor renders them
   * verbatim on either side of the document title.
   */
  readonly renderTitleBarLeft?: () => ReactNode;
  readonly renderTitleBarRight?: () => ReactNode;
  /**
   * Chrome colour mode. `'system'` follows the OS and re-resolves when it changes.
   * Only the editor CHROME is themed — the document canvas stays Word-faithful.
   */
  readonly colorMode?: 'light' | 'dark' | 'system';
  /**
   * Resolves i18n keys for the editor chrome.
   *
   * Supplying it renders the chrome around the painted surface; omitting it renders
   * the bare surface. Required for chrome rather than defaulted, because the i18n
   * catalogue is the single source of truth for user-facing strings and the adapter
   * ships no English of its own.
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

/**
 * The imperative handle, identical on both adapters (enforced by
 * `bun run check:parity-contract`). Every member forwards to the `Editor` facade and is
 * safe to call before the editor has mounted — mutations no-op, reads return the honest
 * empty answer (`null`, a `notFound` refusal, a loading snapshot) — so a host can hold
 * the ref from first render without guarding it.
 *
 * The ref deliberately stays small: everything else (zoom, paging, formatting queries,
 * document state) is reachable through the full facade via `getEditor`, so the ref never
 * mirrors capabilities the `Editor` contract already names.
 */
export interface DocxEditorRef {
  /** Load a document: DOCX bytes or an existing handle. No-op before mount. */
  load(document: DocumentSource): void;
  /** Serialize the current document; `null` when no editor is mounted. */
  save(): Promise<ArrayBuffer | null>;
  /** Identity and revision of the loaded document; `null` before mount. */
  getDocumentHandle(): DocumentHandle | null;
  /** The full `Editor` facade for advanced callers; `null` before mount. */
  getEditor(): Editor | null;
  focus(): void;
  /** Run a typed command through the facade; refused with `notFound` before mount. */
  exec(command: EditorCommand, options?: { scope?: EditorScope }): ExecResult;
  /** The current read model; a loading, non-editable snapshot before mount. */
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;
}

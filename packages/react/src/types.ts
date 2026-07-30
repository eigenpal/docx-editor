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

/**
 * The imperative handle: the greenfield seven-member shape, identical on both adapters
 * (enforced by `bun run check:parity-contract`). Every member forwards to the `Editor`
 * facade and is safe to call before the editor has mounted — mutations no-op, reads
 * return the honest empty answer (`null`, a `notFound` refusal, a loading snapshot) —
 * so a host can hold the ref from first render without guarding it.
 *
 * Everything the legacy handle carried beyond these (zoom, paging, print, find,
 * comments, tracked changes) is reachable through the facade via `getEditor`; the ref
 * itself no longer mirrors capabilities the contract already names.
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

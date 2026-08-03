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
import type { FontConfigurationFragment } from '@docx-editor.dev/core-contract/editor';
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
   *
   * Optional, but it decides layout FIDELITY. With it, the engine shapes text through
   * HarfBuzz and measures line and page breaks from real font metrics. Without it, layout
   * runs on a fixed monospace approximation: glyphs still paint in their true faces, so the
   * page looks right, but wrap points and pagination are estimated rather than
   * Word-accurate. Omit it to mount in one line; supply it when breaks must match Word.
   */
  fonts?: FontConfiguration | FontConfigurationFragment;
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
   * Defaults to the bundled English catalogue, so the chrome is legible with no setup.
   * Strings still come from `packages/i18n/en.json` rather than literals in components;
   * this only chooses who resolves the key. For another language, pass
   * `createT(locale)` from `@docx-editor.dev/i18n`.
   */
  t?: (key: string) => string;
  /**
   * Renders the packaged chrome — title bar and toolbar — around the document.
   * Default `true`. Set `false` for the painted surface alone when the host supplies
   * its own chrome; the composition primitives (`Root` / `Viewport` / `Content`) are
   * the better starting point if you are replacing more than the frame.
   */
  chrome?: boolean;
  /** Document title shown in the chrome's title bar. */
  title?: string;
  /** Called when the title is edited. Omitting it makes the title read-only. */
  onTitleChange?: (title: string) => void;
  /**
   * Save handler for the chrome's save control and the menu's File › Save row. Runs
   * `Editor.save()` at the host.
   *
   * Without it the title-bar button is absent and File › Save falls back to the packaged
   * behaviour: `Editor.save()` and a download named after `title`.
   */
  onSave?: () => void;
  /**
   * Open handler for the menu's File › Open row.
   *
   * Without it the row falls back to the packaged behaviour: a file picker whose bytes go
   * to `Editor.load`. Supply this to drive the load from your own storage — the row is
   * still a user-initiated file READ either way, never a fetch the document can trigger.
   */
  onOpen?: () => void;
  /**
   * Render the packaged menu bar — File · Format · Insert · Help — under the document
   * title (`false` removes it).
   *
   * Every actionable row is a chrome slot, so it shares its label, icon, command and
   * enabled state with the toolbar control for the same capability; rows the engine cannot
   * honour yet render present and disabled with the engine's own reason. Compose
   * `DocxEditor.Menu` yourself for a different arrangement.
   */
  menu?: boolean;
  /**
   * Render the packaged hyperlink popover (`false` removes it).
   *
   * The engine's link GESTURES stay wired either way — a click on a link and Ctrl/Cmd+K
   * still reach `useHyperlinkPopup()` — so a host that turns this off to render its own
   * panel loses the packaged UI and nothing else.
   */
  hyperlinkPopup?: boolean;
  /**
   * Render the packaged navigation pane — headings and find — over the document's left
   * gutter (`false` removes it and its toggle).
   *
   * On by default because an open pane costs the document nothing: it floats over gutter
   * space that is already empty, and only moves the page when the window is genuinely too
   * narrow to hold both. Compose `DocxEditor.Navigation` yourself, or build on
   * `useNavigationPane` / `useDocumentOutline` / `useDocumentSearch`, for a different one.
   */
  navigation?: boolean;
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

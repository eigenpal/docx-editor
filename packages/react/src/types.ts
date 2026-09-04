import type { DocxEditorChildren } from './docx-editor-children';
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
  ZoomMode,
} from '@docx-editor.dev/core/contracts/editor';
import type {
  EditorModule,
  FontConfigurationFragment,
  FontResolver,
} from '@docx-editor.dev/core/editor';
import type { Translations } from '@docx-editor.dev/i18n';
import type { DocxEditorMenuProps } from './editor/menu';
import type { DocxEditorContextMenuProps } from './editor/contextmenu';
export { EditorFontError } from '@docx-editor.dev/core/contracts/editor';
export type {
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';

export type EditorMode = 'edit' | 'view' | 'suggesting';

export type {
  ReviewAuthorInfo,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
} from '@docx-editor.dev/core/editor';

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
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  /**
   * Title-bar slots. The host owns what goes here — brand lockup, switchers, theme
   * toggle, Open/New/Save controls — and passes them in; the editor renders them
   * verbatim on either side of the document title.
   */
  readonly renderTitleBarLeft?: () => DocxEditorChildren;
  readonly renderTitleBarRight?: () => DocxEditorChildren;
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
   *
   * `params` carries interpolation values for parameterized keys (for example the
   * navigation pane's `{current} of {total}` match counter) — a resolver that ignores
   * them renders the raw placeholders for those labels.
   */
  t?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * The chrome's language: a locale from `@docx-editor.dev/i18n` (or your own partial
   * over English). Keys the locale leaves out fall back to English rather than showing
   * the key.
   *
   * ```tsx
   * import { de } from '@docx-editor.dev/i18n';
   * <DocxEditor i18n={de} />
   * ```
   *
   * Equivalent to wrapping this editor in `<LocaleProvider i18n={de}>`, which is still
   * the way to set one language for several editors at once — this prop overrides such a
   * provider for this editor only. Unlike `locale`, which tells the ENGINE what language
   * the document is in, this decides what the buttons say.
   *
   * Hold it at a stable identity: a catalogue written inline (`i18n={{ toolbar: … }}`) is
   * a new object every render, and the merged catalogue behind it is what the chrome
   * memoizes its labels on — so an inline one re-renders every toolbar control on each
   * render of the host. Put your overrides in a module constant, or memoize them.
   */
  i18n?: Translations;
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
   * The packaged menu bar — File · Format · Insert · Help — under the document title.
   *
   * `false` removes it. An OBJECT is `DocxEditorMenuProps`, passed straight through, so a
   * host can redirect one row without giving up the bar: `menu={{ reportIssue: false }}`
   * drops the report-an-issue row, `menu={{ onPageSetup: openMine }}` swaps the dialog,
   * and `menu={{ children: <DocxEditor.Menu.File>…</DocxEditor.Menu.File> }}` replaces a
   * whole menu in place. Before this took an object the only way to change any of that was
   * `menu={false}` plus rebuilding the entire title block.
   *
   * Every actionable row is a chrome slot, so it shares its label, icon, command and
   * enabled state with the toolbar control for the same capability.
   */
  menu?: boolean | DocxEditorMenuProps;
  /**
   * Render the packaged hyperlink popover (`false` removes it).
   *
   * The engine's link GESTURES stay wired either way — a click on a link and Ctrl/Cmd+K
   * still reach `useHyperlinkPopup()` — so a host that turns this off to render its own
   * panel loses the packaged UI and nothing else.
   */
  hyperlinkPopup?: boolean;
  /**
   * Render the packaged right-click menu (`false` removes it, restoring the browser's own).
   *
   * An object is passed through to `DocxEditor.ContextMenu` as props, so a host can compose
   * its own rows — `{ children: <DocxEditor.ContextMenu.Item … /> }` — without dropping to
   * the primitives. The engine's selection behavior is the same either way: a right-click
   * never moves the caret, so the menu always acts on the selection the user already had.
   */
  contextMenu?: boolean | DocxEditorContextMenuProps;
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
  /**
   * Horizontal and vertical rulers, on by default with the packaged chrome.
   *
   * They are part of the frame rather than an extra: every editor this
   * component is modelled on shows them, and the placement is not something a
   * host can get right from outside. The horizontal ruler applies the
   * navigation shift and the review gutter itself, so it has to sit ABOVE the
   * scroll container — mounted inside it, the gutter is counted twice and the
   * ticks drift off the page. Set `false` for a bare page, or compose
   * `DocxEditor.HorizontalRuler` / `DocxEditor.VerticalRuler` yourself.
   */
  rulers?: boolean;
  /** A document to load: DOCX bytes, `'blank'` for an empty one, or an existing handle.
   * Omitting it mounts NO document, which is not the same as an empty one. */
  document?: DocumentSource;
  /**
   * The host mode, matching the toolbar's three-state pill. Changes apply without a remount.
   *
   * Defaults to `'edit'`: the packaged editor opens every document ready to type, even
   * one whose `w:trackRevisions` asks for tracked changes. Pass `'suggesting'` (needs
   * `modules` with a review module and an `author`) to open in suggesting, or `'view'`
   * for read-only. To let the DOCUMENT decide — Word's behavior, where
   * `w:trackRevisions` opens in suggesting — compose `DocxEditor.Root`, which follows
   * the file's request when `mode` is omitted.
   */
  mode?: EditorMode;
  /** A fixed scale. Supplying one also makes the mode fixed unless `zoomMode` says otherwise. */
  zoom?: number;
  /**
   * Where the scale comes from. Defaults to `'auto'`: fit the page width, between 50% and
   * 100%. A fit tracks the room beside the page, so opening comments shrinks the document
   * instead of pushing it off screen; past the floor it scrolls sideways instead.
   * `{ type: 'fixed' }` opts out.
   */
  zoomMode?: ZoomMode | 'auto';
  /**
   * Engine locale for engine-generated content, such as the table of contents title.
   * Changes apply without a remount.
   */
  locale?: string;
  author?: string;
  /**
   * Capability modules to register (`@docx-editor.dev/pro`'s review module, custom nodes).
   * Applied at mount only.
   */
  modules?: readonly EditorModule[];
  /**
   * Extra chrome rendered INSIDE the viewport, after the painted pages — the
   * slot pro or host chrome mounts into without leaving the sugar (e.g.
   * `DocxEditorReview` from `@docx-editor.dev/pro/react`). For more control,
   * compose `DocxEditor.Root`/`Viewport`/`Content` directly.
   */
  children?: DocxEditorChildren;
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
  /** Load a document: DOCX bytes, `'blank'` for an empty one, or an existing handle.
   * No-op before mount. */
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

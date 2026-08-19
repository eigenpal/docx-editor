import type {
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorCommand,
  EditorFontError,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  FontConfiguration,
} from '@docx-editor.dev/core/contracts/editor';
import type {
  EditorModule,
  FontConfigurationFragment,
  FontResolver,
  RevisionStyles,
} from '@docx-editor.dev/core/editor';
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
 * Props for the Vue `DocxEditor`. The adapter is a thin renderer over the
 * `Editor` contract; it holds no editing-engine state of its own and never
 * imports ProseMirror or OOXML feature logic.
 */
export interface DocxEditorProps {
  /**
   * Font bytes for Word-accurate wrap and pagination, sampled at mount; remount to
   * replace atomically. Omitted, layout estimates widths; fonts embedded in the document
   * wire in automatically either way. Accepts a full configuration or a bare
   * `{ sources, substitutions }` fragment (what `loadDefaultFonts()` returns).
   */
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  /** A document to load: DOCX bytes, `'blank'` for an empty one, or an existing handle.
   * Omitting it mounts NO document, which is not the same as an empty one. */
  document?: DocumentSource;
  /**
   * The mode the editor opens in: 'edit' (default), 'suggesting' (needs a review module
   * and an `author`), or 'view' (read-only). Applied at mount only — not reactive;
   * remount to change.
   */
  mode?: EditorMode;
  /**
   * How painted tracked changes are coloured — the opening value; replace it live with
   * `editor.setRevisionStyles` on the instance, and read the document's resolved roster
   * with `editor.getReviewAuthors`.
   *
   * `'author'` (the default) colours every change by who proposed it, through the
   * `--doc-review-author-N` ramp, as Word does; `'kind'` opts out and colours by what
   * happened; `RevisionAuthorAssignments` styles the named authors, with `others`
   * deciding whether the rest take the ramp or the kind colours. The full all-markup view
   * needs a review module registered.
   */
  revisionStyles?: RevisionStyles;
  zoom?: number;
  locale?: string;
  author?: string;
  /**
   * Capability modules to register (`@docx-editor.dev/pro`'s review module,
   * custom nodes — the framework-neutral entry works under Vue). Applied at
   * mount only, like `mode`. Vue has no review pane chrome yet, so a review
   * module enables markup rendering and suggesting without a sidebar.
   */
  modules?: readonly EditorModule[];
  /** Fired with the same typed font failure shown by the accessible alert UI. */
  onFontError?: (error: EditorFontError) => void;
}

/**
 * The exposed instance handle, identical on both adapters (enforced by
 * `bun run check:parity-contract`). Every member forwards to the `Editor` facade and is
 * safe to call before the editor has mounted — mutations no-op, reads return the honest
 * empty answer (`null`, a `notFound` refusal, a loading snapshot) — so a host can hold
 * the template ref from first render without guarding it.
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

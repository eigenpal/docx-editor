/**
 * `@docx-editor.dev/core` — the engine.
 *
 * THIS ENTRY IS THE 80% PATH. Everything needed to stand up an editor over DOCX bytes,
 * measure it with real fonts, and drive it from chrome is here, so the common case is one
 * import. The subpaths (`./store`, `./layout`, `./output`, `./automation`, and the
 * `./contracts/*` declarations) stay available for the deeper work — walking the canonical
 * tree, running layout by hand, painting — and nothing here hides them.
 *
 * If you want the editor already wired to a UI, use `@docx-editor.dev/react`.
 */

// ─── Create an editor ────────────────────────────────────────────────────────
export {
  createDocxEditor,
  blankDocumentBytes,
  type DocxEditorInstance,
  type DocxEditorConfig,
} from './editor/index.ts';

// ─── The contract it implements ──────────────────────────────────────────────
export type {
  Editor,
  EditorHost,
  EditorConfig,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  ViewScope,
  DocumentSource,
  DocumentHandle,
  DocumentChange,
  DocumentEditingMode,
  PageSetup,
} from './contracts/editor.ts';

// ─── Fonts: the reason pagination matches Word ───────────────────────────────
export {
  WORD_DEFAULT_FONT,
  loadFonts,
  createFontSource,
  composeFontConfiguration,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type LoadFontsRequest,
  type LoadFontsResult,
  type FontLoadFailure,
} from './editor/index.ts';
export type { FontConfiguration, FontSource, FontFaceRequest } from './contracts/editor.ts';

// ─── Chrome registry: what a toolbar is built from ───────────────────────────
export {
  CHROME_GROUPS,
  CHROME_MENUS,
  chromeMenuSlots,
  commandForSlot,
  commandForSlotValue,
  toolbarCommandState,
  runToolbarCommand,
  type ChromeSlotId,
  type ToolbarCommandState,
} from './editor/index.ts';

// ─── Capability modules (what `@docx-editor.dev/pro` implements) ─────────────
export type { EditorModule } from './contracts/modules.ts';

import type {
  ContainerRef,
  ContentControlFilter,
  ContentControlType,
  DocComment,
  DocRange,
  Revision,
  StyleDefinitions,
  DocTarget,
  DocxDocument,
  ExecResult,
  Extent,
  RunFormatting,
} from './contracts/types';

export type * from './contracts/types';

// ─── Edits ───────────────────────────────────────────────────────────────────

/**
 * The document-executable edit vocabulary.
 *
 * An interface rather than a closed union so extensions can widen it by
 * declaration merging. A sealed union cannot be extended by a plugin, and the
 * runtime dispatch is already registry-backed.
 */
export interface DocEdits {
  insertText: { target: DocTarget; text: string };
  replaceText: { target: DocTarget; text: string };
  deleteText: { target: DocTarget };
  applyFormatting: { target: DocTarget; marks: RunFormatting };
  setParagraphStyle: { target: DocTarget; styleId: string };
  insertTable: { target: DocTarget; rows: number; cols: number };
  insertImage: { target: DocTarget; data: Uint8Array; extent?: Extent };
  insertHyperlink: { target: DocTarget; href: string; text?: string };
  removeHyperlink: { target: DocTarget };
  insertBreak: { target: DocTarget; kind: 'page' | 'column' | 'line' | 'section' };
  /**
   * Word's Increase/Decrease Indent.
   *
   * A numbered or bulleted paragraph changes LEVEL, so its marker re-resolves from the
   * numbering definition — a bullet becomes a hollow circle, a `1.` becomes an `a.`.
   * Every other paragraph moves its left indent by one default tab stop.
   */
  adjustIndent: { target: DocTarget; direction: 'increase' | 'decrease' };
  /**
   * Word's Bullets and Numbering.
   *
   * Turns the selection into a list, or takes it out of one when it already is. The
   * definition is created on first use, `numbering.xml` included.
   */
  toggleList: { target: DocTarget; kind: 'bullet' | 'ordered' };
  splitParagraph: { target: DocTarget };
  mergeParagraphs: { target: DocTarget };
  setVariable: { name: string; value: string };
  applyVariables: { values: Record<string, string> };

  /**
   * Authored family. `author` is required: tracked-ness is verb identity, not a
   * boolean flag, so there is no global trackChanges toggle to forget.
   */
  proposeReplacement: { target: DocTarget; replaceWith: string; author: string };
  proposeInsertion: { target: DocTarget; text: string; author: string };
  proposeDeletion: { target: DocTarget; author: string };
  addComment: { target: DocTarget; text: string; author: string };
  replyComment: { commentId: string; text: string; author: string };
  resolveComment: { commentId: string };

  acceptRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  rejectRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  acceptAllRevisions: Record<never, never>;
  rejectAllRevisions: Record<never, never>;

  setContentControlValue: { target: DocTarget; value: string };
  removeContentControl: { target: DocTarget };
  addRepeatingSectionItem: { target: DocTarget; index?: number };
  removeRepeatingSectionItem: { target: DocTarget; index: number };
}

export type DocEdit = { [K in keyof DocEdits]: { type: K } & DocEdits[K] }[keyof DocEdits];

export interface ApplyResult {
  doc: DocxDocument;
  /** One per edit, positionally aligned with the input. */
  results: ExecResult[];
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export interface DocQueries {
  paragraphs: { container?: ContainerRef };
  findText: { text: string; container?: ContainerRef };
  contentControls: { filter?: ContentControlFilter };
  revisions: { part?: 'body' | 'footnote' | 'endnote' };
  comments: { resolved?: boolean };
  styles: Record<never, never>;
  variables: Record<never, never>;
}

export type DocQuery = { [K in keyof DocQueries]: { type: K } & DocQueries[K] }[keyof DocQueries];

/** What each query returns. Keyed identically to `DocQueries`. */
export interface DocQueryResults {
  paragraphs: readonly ParagraphSummary[];
  findText: readonly DocRange[];
  contentControls: readonly ContentControlSummary[];
  revisions: readonly Revision[];
  comments: readonly DocComment[];
  styles: StyleDefinitions;
  variables: Readonly<Record<string, string>>;
}

export interface ParagraphSummary {
  readonly paraId?: string;
  readonly text: string;
  readonly styleId?: string;
}

export interface ContentControlSummary {
  readonly id: string;
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType: ContentControlType;
  readonly locked?: boolean;
}

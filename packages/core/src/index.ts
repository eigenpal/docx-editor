/**
 * `@docx-editor.dev/core` — the document layer.
 *
 * No DOM, no framework, no editor. Parse a .docx, query it, edit it, write it
 * back. This is the entry `packages/agents` uses and the entry any headless or
 * server-side consumer needs.
 *
 * CONTRACT ONLY. Every function here throws.
 */

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
  DocxDocumentJSON,
  ExecResult,
  Extent,
  ColorValue,
  FontDefinition,
  JSONSchema,
  Run,
  RunFormatting,
  Theme,
  ThemeColorScheme,
  Watermark,
} from './contracts/types';

export type * from './contracts/types';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

// ─── Parse / serialize ───────────────────────────────────────────────────────

export function parseDocx(_input: ArrayBuffer | Uint8Array): Promise<DocxDocument> {
  return Promise.reject(new Error(NOT_IMPLEMENTED));
}

export function serializeDocx(_doc: DocxDocument): Promise<ArrayBuffer> {
  return Promise.reject(new Error(NOT_IMPLEMENTED));
}

/**
 * `DocxDocument` holds Maps, Dates, and a verbatim-XML side table, so it is not
 * JSON-round-trippable. Project it before crossing a JSON boundary.
 */
export function toJSON(_doc: DocxDocument): DocxDocumentJSON {
  throw new Error(NOT_IMPLEMENTED);
}

export function fromJSON(_json: DocxDocumentJSON): DocxDocument {
  throw new Error(NOT_IMPLEMENTED);
}

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

/** Pure: `doc` is never mutated, which is what lets agents diff before committing. */
export function applyEdits(_doc: DocxDocument, _edits: readonly DocEdit[]): ApplyResult {
  throw new Error(NOT_IMPLEMENTED);
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

export function queryDoc<K extends keyof DocQueries>(
  _doc: DocxDocument,
  _query: { type: K } & DocQueries[K]
): DocQueryResults[K] {
  throw new Error(NOT_IMPLEMENTED);
}

// ─── Runtime schemas ─────────────────────────────────────────────────────────

/**
 * Runtime JSON Schema per edit and query. A TypeScript union vanishes at
 * compile time, and MCP `tools/list` needs real schemas at runtime.
 */
export declare const docEditSchemas: Readonly<Record<keyof DocEdits, JSONSchema>>;
export declare const docQuerySchemas: Readonly<Record<keyof DocQueries, JSONSchema>>;

// ─── OOXML semantics that cannot move out of core ────────────────────────────

export function resolveColor(_color: ColorValue, _theme?: Theme): ColorValue {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveColorToHex(_color: ColorValue, _theme?: Theme): string {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveHighlightColor(_name: string): string {
  throw new Error(NOT_IMPLEMENTED);
}
export function generateThemeTintShadeMatrix(_scheme: ThemeColorScheme): string[][] {
  throw new Error(NOT_IMPLEMENTED);
}
export function loadDocumentFonts(_doc: DocxDocument): Promise<void> {
  return Promise.reject(new Error(NOT_IMPLEMENTED));
}
export function getEmbeddedFontFamilies(_doc: DocxDocument): string[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function getRenderableDocumentFonts(_doc: DocxDocument): FontDefinition[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function parseClipboardHtml(_html: string, _theme?: Theme): Run[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function setDocumentWatermark(
  _doc: DocxDocument,
  _watermark: Watermark | null
): DocxDocument {
  throw new Error(NOT_IMPLEMENTED);
}

export declare const TWIPS_PER_INCH: number;
export declare const PIXELS_PER_INCH: number;

export function twipsToPixels(_twips: number): number {
  throw new Error(NOT_IMPLEMENTED);
}
export function pixelsToTwips(_px: number): number {
  throw new Error(NOT_IMPLEMENTED);
}
export function emuToPixels(_emu: number): number {
  throw new Error(NOT_IMPLEMENTED);
}
export function pixelsToEmu(_px: number): number {
  throw new Error(NOT_IMPLEMENTED);
}

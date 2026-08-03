// Typed footnote/endnote vocabulary helpers.
//
// Canonical nodes cover note-part roots (`w:footnotes` / `w:endnotes`), note bodies
// (`w:footnote` / `w:endnote`), body references (`w:footnoteReference` /
// `w:endnoteReference`), and run-inner marks (`w:footnoteRef` / `w:endnoteRef`,
// `w:separator`, `w:continuationSeparator`). Field/macro content inside notes stays
// inert — never executed.
//
// Each of noteReference / noteRef / separator / continuationSeparator contributes exactly
// one UTF-16 unit ({@link NOTE_ATOM_CHAR}) to paragraph addressing. Display digits are
// derived elsewhere and never stored as model text. Whole-atom delete only.
//
// EditorScope note ids encode kind + signed id: `footnote:<id>` / `endnote:<id>`.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type {
  OoxmlEndnotesNode,
  OoxmlFootnotesNode,
  OoxmlNode,
  OoxmlNoteNode,
  OoxmlNoteRefNode,
  OoxmlNoteReferenceNode,
  OoxmlParagraphNode,
  OoxmlSeparatorNode,
  OoxmlContinuationSeparatorNode,
} from './ooxml-tree.ts';

/** UTF-16 placeholder for one atomic note unit in `paragraphTextOf` / segments. */
export const NOTE_ATOM_CHAR = '\uFFFC';

/** Signed 32-bit Word-compatible note id range (positive allocation only). */
export const NOTE_ID_MIN = 1;
export const NOTE_ID_MAX = 0x7fffffff;

/** Reserved separator / continuation ids — never allocated for normal notes. */
export const NOTE_SEPARATOR_ID = -1;
export const NOTE_CONTINUATION_SEPARATOR_ID = 0;

export type NoteKind = 'footnote' | 'endnote';

/** Authored `ST_FtnEdn` including explicit `normal`. Absent means Word default (normal). */
export type NoteType = 'normal' | 'separator' | 'continuationSeparator' | 'continuationNotice';

const NOTE_TYPES: ReadonlySet<string> = new Set([
  'normal',
  'separator',
  'continuationSeparator',
  'continuationNotice',
]);

const NOTE_SCOPE_RE = /^(footnote|endnote):(-?\d{1,10})$/;

function attributeValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === localName) {
      return entry.value;
    }
    if (entry.namespaceUri === '' && entry.localName === localName) return entry.value;
  }
  return undefined;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/** Parse a signed decimal note id; reject non-integers and out-of-int32 values. */
export function parseNoteId(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  if (!/^-?\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < -0x80000000 || value > 0x7fffffff) return null;
  return value;
}

/**
 * Canonical `EditorScope { kind: 'note'; id }` encoding.
 *
 * Footnote id `1` and endnote id `1` coexist, so the kind is part of the string:
 * `footnote:2` / `endnote:-1`. Do not invent a parallel scope union arm.
 */
export function formatNoteScopeId(noteKind: NoteKind, noteId: number): string {
  return `${noteKind}:${noteId}`;
}

/**
 * Parse {@link formatNoteScopeId}. Returns `null` for malformed / out-of-range ids.
 */
export function parseNoteScopeId(
  id: string
): { readonly noteKind: NoteKind; readonly noteId: number } | null {
  const match = NOTE_SCOPE_RE.exec(id);
  if (!match) return null;
  const noteId = parseNoteId(match[2]);
  if (noteId === null) return null;
  return { noteKind: match[1] as NoteKind, noteId };
}

export function isFootnotesNode(node: OoxmlNode): node is OoxmlFootnotesNode {
  return node.kind === 'footnotes';
}

export function isEndnotesNode(node: OoxmlNode): node is OoxmlEndnotesNode {
  return node.kind === 'endnotes';
}

export function isNoteNode(node: OoxmlNode): node is OoxmlNoteNode {
  return node.kind === 'note';
}

export function isNoteReferenceNode(node: OoxmlNode): node is OoxmlNoteReferenceNode {
  return node.kind === 'noteReference';
}

export function isNoteRefNode(node: OoxmlNode): node is OoxmlNoteRefNode {
  return node.kind === 'noteRef';
}

export function isSeparatorNode(node: OoxmlNode): node is OoxmlSeparatorNode {
  return node.kind === 'separator';
}

export function isContinuationSeparatorNode(
  node: OoxmlNode
): node is OoxmlContinuationSeparatorNode {
  return node.kind === 'continuationSeparator';
}

/** Typed or generic `w:footnote` / `w:endnote`. */
export function noteKindOf(node: OoxmlNode): NoteKind | null {
  if (node.kind === 'note') {
    return node.localName === 'footnote'
      ? 'footnote'
      : node.localName === 'endnote'
        ? 'endnote'
        : null;
  }
  if (node.kind === 'generic') {
    if (isWml(node, 'footnote')) return 'footnote';
    if (isWml(node, 'endnote')) return 'endnote';
  }
  return null;
}

/** Authored `@w:id` on a note or noteReference when parseable. */
export function noteIdOf(node: OoxmlNode): number | null {
  return parseNoteId(attributeValue(node, 'id'));
}

/** Authored `@w:type` (`ST_FtnEdn`) when present and schema-legal; else `undefined`. */
export function noteTypeOf(node: OoxmlNode): NoteType | undefined {
  const raw = attributeValue(node, 'type');
  if (raw === undefined) return undefined;
  return NOTE_TYPES.has(raw) ? (raw as NoteType) : undefined;
}

/** Whether a note is a normal (body) note — absent type and explicit `normal` both count. */
export function isNormalNote(node: OoxmlNode): boolean {
  const type = noteTypeOf(node);
  return type === undefined || type === 'normal';
}

/** Typed or generic footnote/endnote reference kind. */
export function noteReferenceKindOf(node: OoxmlNode): NoteKind | null {
  if (node.kind === 'noteReference') {
    return node.localName === 'footnoteReference'
      ? 'footnote'
      : node.localName === 'endnoteReference'
        ? 'endnote'
        : null;
  }
  if (node.kind === 'generic') {
    if (isWml(node, 'footnoteReference')) return 'footnote';
    if (isWml(node, 'endnoteReference')) return 'endnote';
  }
  return null;
}

/** Typed or generic `w:footnoteRef` / `w:endnoteRef`. */
export function noteRefKindOf(node: OoxmlNode): NoteKind | null {
  if (node.kind === 'noteRef') {
    return node.localName === 'footnoteRef'
      ? 'footnote'
      : node.localName === 'endnoteRef'
        ? 'endnote'
        : null;
  }
  if (node.kind === 'generic') {
    if (isWml(node, 'footnoteRef')) return 'footnote';
    if (isWml(node, 'endnoteRef')) return 'endnote';
  }
  return null;
}

/**
 * Read `@w:customMarkFollows` on a note reference.
 * Returns `undefined` when absent; otherwise the OOXML on/off interpretation.
 */
export function customMarkFollows(node: OoxmlNode): boolean | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  const raw = attributeValue(node, 'customMarkFollows');
  if (raw === undefined) {
    const present = node.attributes.some(
      (entry) =>
        entry.localName === 'customMarkFollows' &&
        (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '')
    );
    return present ? true : undefined;
  }
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Model text contributed by one atomic note unit. */
export function noteAtomText(): typeof NOTE_ATOM_CHAR {
  return NOTE_ATOM_CHAR;
}

/**
 * True when a run-inner node is a typed note atom that contributes one UTF-16 unit.
 * Demoted/malformed known locals stay generic and contribute nothing.
 */
export function isNoteAtomNode(node: OoxmlNode): boolean {
  return (
    node.kind === 'noteReference' ||
    node.kind === 'noteRef' ||
    node.kind === 'separator' ||
    node.kind === 'continuationSeparator'
  );
}

/**
 * One atomic note span inside a paragraph for caret / delete / selection.
 *
 * Each typed note atom is a single-node span (`removeNodeIds` = that node).
 */
export interface AtomicNoteSpan {
  readonly kind: 'noteReference' | 'noteRef' | 'separator' | 'continuationSeparator';
  readonly node: OoxmlNode;
  readonly runId: string;
  readonly removeNodeIds: readonly string[];
}

/** Collect typed note atoms in document order (one segment each). */
export function atomicNoteSpansOf(paragraph: OoxmlParagraphNode): readonly AtomicNoteSpan[] {
  const spans: AtomicNoteSpan[] = [];
  const visitInline = (child: OoxmlNode): void => {
    if (child.kind === 'run') {
      for (const grand of child.children) {
        if (!isNoteAtomNode(grand)) continue;
        spans.push({
          kind: grand.kind as AtomicNoteSpan['kind'],
          node: grand,
          runId: child.id,
          removeNodeIds: [grand.id],
        });
      }
      return;
    }
    // Note refs inside a link are still paragraph atoms (same as field spans).
    if (child.kind === 'hyperlink') {
      for (const inner of child.children) visitInline(inner);
    }
  };
  for (const child of paragraph.children) visitInline(child);
  return spans;
}

/** Cap on notes scanned when allocating / indexing a notes part. */
export const MAX_NOTES_PER_PART = 10_000;

/**
 * Allocate the next positive signed 32-bit note id for a notes-part root.
 * Seeds from `max(existing)+1`; never returns ≤0; `null` on exhaustion.
 */
export function allocateNoteId(notesRoot: OoxmlNode): number | null {
  if (notesRoot.kind === 'textValue') return null;
  let max = 0;
  let scanned = 0;
  for (const child of notesRoot.children) {
    if (scanned >= MAX_NOTES_PER_PART) break;
    scanned += 1;
    if (noteKindOf(child) === null) continue;
    const id = noteIdOf(child);
    if (id === null) continue;
    if (id > max) max = id;
  }
  if (max >= NOTE_ID_MAX) return null;
  const next = Math.max(max + 1, NOTE_ID_MIN);
  if (next > NOTE_ID_MAX) return null;
  return next;
}

/** Collect note bodies from a footnotes/endnotes root, bounded. */
export function notesOf(root: OoxmlNode): readonly OoxmlNoteNode[] {
  if (root.kind !== 'footnotes' && root.kind !== 'endnotes') return [];
  const notes: OoxmlNoteNode[] = [];
  for (const child of root.children) {
    if (notes.length >= MAX_NOTES_PER_PART) break;
    if (child.kind === 'note') notes.push(child);
  }
  return notes;
}

/** Find a typed note by id inside a notes-part root. */
export function findNoteById(root: OoxmlNode, noteId: number): OoxmlNoteNode | undefined {
  for (const note of notesOf(root)) {
    if (noteIdOf(note) === noteId) return note;
  }
  return undefined;
}

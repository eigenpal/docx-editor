// Derived footnote/endnote mark projection into measurable paragraph pieces.
//
// Note references and noteRef atoms contribute one UTF-16 model unit (U+FFFC) but paint
// derived display digits (or a custom mark). Projection mirrors PAGE fields: model range
// stays length 1 while display text replaces the atom. `eachPage` restart reserves a
// stable mark width so 9→10 digit growth cannot itself re-paginate unboundedly.

import {
  customMarkFollows,
  formatNoteScopeId,
  isContinuationSeparatorNode,
  isNoteAtomNode,
  isNoteRefNode,
  isNoteReferenceNode,
  isSeparatorNode,
  noteIdOf,
  noteKindOf,
  noteRefKindOf,
  noteReferenceKindOf,
  NOTE_ATOM_CHAR,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';

/**
 * Lookup of derived display marks keyed by {@link formatNoteScopeId}.
 *
 * `null` mark = customMarkFollows (no automatic digits). Absent key = dangling / unknown
 * — fail-open with an empty display (model atom preserved).
 */
export interface NoteMarkContext {
  /** scopeId → formatted mark (or null when suppressed). */
  readonly marks: ReadonlyMap<string, string | null>;
  /**
   * When set, every automatic mark measures at least this string's width (eachPage
   * reservation). The string is the widest-measuring candidate under the effective mark
   * style (actual marks plus a bounded per-section value window) — not merely the longest
   * by codepoint count. Display text may still be the real mark; measurement uses the wider
   * of the two so digit-width / proportional-glyph feedback cannot oscillate.
   */
  readonly reservedMarkText?: string;
  /**
   * Scope id of the note story currently being laid out (`footnote:N` / `endnote:N`).
   *
   * Body `noteReference` atoms carry `@w:id`; note-body `noteRef` atoms do not — they
   * inherit identity from the enclosing note via this key.
   */
  readonly activeNoteKey?: string;
}

/** Empty context — note atoms contribute no visible glyphs. */
export const EMPTY_NOTE_MARK_CONTEXT: NoteMarkContext = Object.freeze({
  marks: Object.freeze(new Map()) as ReadonlyMap<string, string | null>,
});

export function noteMarkKey(noteKind: NoteKind, noteId: number): string {
  return formatNoteScopeId(noteKind, noteId);
}

/**
 * Navigation role for a projected note atom:
 * - `to-note` — body `noteReference` jumps into the note story
 * - `to-body` — note-body `noteRef` jumps back to the body citation
 */
export type NoteNavDirection = 'to-note' | 'to-body';

export interface ProjectedNoteMark {
  readonly text: string;
  readonly measureText?: string;
  readonly projected: boolean;
  readonly kind: NoteKind | null;
  readonly noteId: number | null;
  readonly nav?: NoteNavDirection;
  readonly scopeId?: string;
}

/** Resolve display text for a noteReference / noteRef node under a mark context. */
export function projectedNoteMarkText(
  node: OoxmlNode,
  context: NoteMarkContext | undefined
): ProjectedNoteMark | null {
  if (!isNoteAtomNode(node)) return null;

  if (isSeparatorNode(node) || isContinuationSeparatorNode(node)) {
    return { text: '', projected: true, kind: null, noteId: null };
  }

  const isBodyRef = isNoteReferenceNode(node);
  const refKind = noteReferenceKindOf(node) ?? noteRefKindOf(node);
  if (!refKind) return null;
  const authoredId = noteIdOf(node);
  // noteRef has no @w:id — resolve against the enclosing note story when projecting.
  const key =
    authoredId !== null
      ? noteMarkKey(refKind, authoredId)
      : !isBodyRef
        ? context?.activeNoteKey
        : undefined;
  const noteId =
    authoredId !== null ? authoredId : key ? (parseScopeNoteId(key, refKind) ?? null) : null;
  const scopeId = key;
  const nav: NoteNavDirection | undefined =
    scopeId !== undefined ? (isBodyRef ? 'to-note' : 'to-body') : undefined;
  const base = {
    projected: true as const,
    kind: refKind,
    noteId,
    ...(nav ? { nav } : {}),
    ...(scopeId ? { scopeId } : {}),
  };

  if (isBodyRef && authoredId !== null && customMarkFollows(node)) {
    return { text: '', ...base };
  }

  if (!context || !key) {
    return { text: '', ...base };
  }

  const mark = context.marks.get(key);
  if (mark === null || mark === undefined) return { text: '', ...base };

  // eachPage: paint the real mark, measure at least the reserved width so 9→10 cannot
  // itself re-paginate.
  if (context.reservedMarkText && context.reservedMarkText.length > 0) {
    return {
      text: mark,
      measureText: context.reservedMarkText,
      ...base,
    };
  }
  return { text: mark, ...base };
}

/** Parse `footnote:N` / `endnote:N` when it matches `expectedKind`. */
function parseScopeNoteId(scopeId: string, expectedKind: NoteKind): number | null {
  const prefix = `${expectedKind}:`;
  if (!scopeId.startsWith(prefix)) return null;
  const raw = scopeId.slice(prefix.length);
  if (!/^-?\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** True when a run child is a typed note atom that piecesOfParagraph must project. */
export function isProjectableNoteAtom(node: OoxmlNode): boolean {
  return (
    isNoteReferenceNode(node) ||
    isNoteRefNode(node) ||
    isSeparatorNode(node) ||
    isContinuationSeparatorNode(node)
  );
}

/** Model text for a note atom (always one UTF-16 unit). */
export function noteAtomModelText(): typeof NOTE_ATOM_CHAR {
  return NOTE_ATOM_CHAR;
}

/** Compact cache token for note-mark identity (bounded; not a full serialization). */
export function noteMarksCacheToken(context: NoteMarkContext | undefined): string {
  if (!context || context.marks.size === 0) {
    return context?.reservedMarkText ? `r:${context.reservedMarkText}` : '';
  }
  const parts: string[] = [];
  let n = 0;
  for (const [key, mark] of context.marks) {
    if (n >= 64) {
      parts.push('…');
      break;
    }
    parts.push(`${key}=${mark ?? ''}`);
    n += 1;
  }
  if (context.reservedMarkText) parts.push(`r:${context.reservedMarkText}`);
  return parts.join(',');
}

/** Re-export for callers that already have a note node. */
export function noteKindAndIdOf(
  node: OoxmlNode
): { readonly noteKind: NoteKind; readonly noteId: number } | null {
  const noteKind = noteKindOf(node);
  const noteId = noteIdOf(node);
  if (!noteKind || noteId === null) return null;
  return { noteKind, noteId };
}

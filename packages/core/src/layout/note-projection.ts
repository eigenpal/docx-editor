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

/**
 * The key one note's mark is stored under — `footnote:N` / `endnote:N`.
 *
 * The same encoding `EditorScope` uses for note ids, so a mark context and a scope address name
 * the same note without a translation step.
 */
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

/**
 * Cache token for note-mark identity — EVERY mark, not a sample of them.
 *
 * The session context this feeds decides whether an incremental pass may resume. A note's
 * displayed mark is DERIVED (`w:footnotePr/w:numFmt`, `w:numStart`, `w:numRestart`, and the
 * section overrides of each), so it moves without any paragraph subtree moving with it: no
 * block key changes, and the pass resumes onto pages measured for the old marks. Body
 * reprojection then rewrites the display text and deliberately keeps the reserved width, so
 * the digits update and the geometry stays where the old digits put it — `1` becoming `ii`
 * kept a one-glyph slot, and every span after it on that line kept its old x.
 *
 * Bounding this by count was the same mistake one level down: two documents whose marks
 * agree for the first N notes and differ after are not the same document. It is memoized on
 * the context object, so a multi-section pass pays for the walk once rather than per section.
 */
const markTokens = new WeakMap<object, string>();

export function noteMarksCacheToken(context: NoteMarkContext | undefined): string {
  if (!context) return '';
  const cached = markTokens.get(context);
  if (cached !== undefined) return cached;
  // Serialized rather than joined with separators: a custom mark (`w:footnoteRef` text) is
  // author-supplied and may hold any character, and `null` — `customMarkFollows` — is not the
  // empty mark. Two contexts that differ must not be able to spell the same token.
  const token = JSON.stringify([
    [...context.marks],
    context.reservedMarkText ?? null,
    context.activeNoteKey ?? null,
  ]);
  markTokens.set(context, token);
  return token;
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

// Derived footnote/endnote display numbers.
//
// Numbers are never stored on note or reference nodes. Callers pass document-order
// references plus resolved numbering properties; this module returns stable id → mark
// maps using the shared `formatNumFmt` (no forked ST_NumberFormat).

import { formatNumFmt } from './numbering-format.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import type {
  ResolvedEndnoteProperties,
  ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';

/**
 * Where one note is referenced from — what per-page and per-section restart rules are computed
 * against.
 */
export interface NoteReferenceSite {
  /** Stable note id (`w:id`). */
  readonly noteId: number;
  /** Section index of the reference (0-based). */
  readonly sectionIndex: number;
  /**
   * Page index of the reference when known (0-based). Required for `eachPage` restart;
   * when omitted, `eachPage` behaves like `continuous` for that site.
   */
  readonly pageIndex?: number;
  /** When true, consumes no automatic number (`customMarkFollows`). */
  readonly customMarkFollows?: boolean;
}

/**
 * The mark a note reference paints.
 *
 * `null` where `w:customMarkFollows` suppresses it: the document supplies its own glyph, and
 * painting an automatic number too would show the note twice.
 */
export interface NoteDisplayMark {
  readonly noteId: number;
  /** Formatted mark, or `null` when suppressed by customMarkFollows. */
  readonly mark: string | null;
  /** 1-based automatic sequence number when assigned; absent when suppressed. */
  readonly displayNumber?: number;
}

type ResolvedNoteProperties = ResolvedFootnoteProperties | ResolvedEndnoteProperties;

/**
 * Derive display marks for references of one note kind in document order.
 *
 * Restart rules:
 * - `continuous` — single sequence across the document from `numStart`
 * - `eachSect` — restart at `numStart` when `sectionIndex` changes
 * - `eachPage` — restart when `pageIndex` changes (falls back to continuous if unknown)
 *
 * IDs are stable; only display numbers change. Non-mutating.
 */
export function deriveNoteDisplayMarks(
  noteKind: NoteKind,
  references: readonly NoteReferenceSite[],
  properties: ResolvedNoteProperties
): readonly NoteDisplayMark[] {
  return deriveNoteDisplayMarksResolved(noteKind, references, () => properties);
}

/**
 * Derive marks using per-reference-section resolved properties (`numFmt` / `numStart` /
 * `numRestart`). Restart rules consult each site's own section props.
 */
export function deriveNoteDisplayMarksResolved(
  _noteKind: NoteKind,
  references: readonly NoteReferenceSite[],
  resolveProps: (sectionIndex: number) => ResolvedNoteProperties
): readonly NoteDisplayMark[] {
  const marks: NoteDisplayMark[] = [];
  let next: number | null = null;
  let lastSection = -1;
  let lastPage = -1;

  for (const site of references) {
    const properties = resolveProps(site.sectionIndex);
    if (site.customMarkFollows) {
      marks.push({ noteId: site.noteId, mark: null });
      continue;
    }

    if (next === null) {
      next = properties.numStart;
      lastSection = site.sectionIndex;
      lastPage = site.pageIndex ?? -1;
    } else if (properties.numRestart === 'eachSect' && site.sectionIndex !== lastSection) {
      next = properties.numStart;
      lastSection = site.sectionIndex;
    } else if (
      properties.numRestart === 'eachPage' &&
      site.pageIndex !== undefined &&
      site.pageIndex !== lastPage
    ) {
      next = properties.numStart;
      lastPage = site.pageIndex;
    } else if (properties.numRestart === 'eachSect') {
      lastSection = site.sectionIndex;
    } else if (properties.numRestart === 'eachPage' && site.pageIndex !== undefined) {
      lastPage = site.pageIndex;
    }

    const displayNumber = next;
    next += 1;
    marks.push({
      noteId: site.noteId,
      mark: formatNumFmt(properties.numFmt, displayNumber),
      displayNumber,
    });
  }

  return marks;
}

/** Map noteId → formatted mark for quick lookup (last site wins if duplicated). */
export function noteDisplayMarkMap(
  marks: readonly NoteDisplayMark[]
): ReadonlyMap<number, string | null> {
  const map = new Map<number, string | null>();
  for (const entry of marks) map.set(entry.noteId, entry.mark);
  return map;
}

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
  _noteKind: NoteKind,
  references: readonly NoteReferenceSite[],
  properties: ResolvedNoteProperties
): readonly NoteDisplayMark[] {
  const marks: NoteDisplayMark[] = [];
  let next = properties.numStart;
  let lastSection = -1;
  let lastPage = -1;

  for (const site of references) {
    if (site.customMarkFollows) {
      marks.push({ noteId: site.noteId, mark: null });
      continue;
    }

    if (properties.numRestart === 'eachSect' && site.sectionIndex !== lastSection) {
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

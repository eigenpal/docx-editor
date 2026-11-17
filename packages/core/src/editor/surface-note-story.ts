// One footnote or endnote story for selection, as in Word.
//
// The editor opens ONE note for editing, so the frame, the label and the caret host have a
// note to name. Word's notes part is one story, though: a selection that starts in footnote 1
// extends across footnotes 2 to 5 by drag, Shift+click and Shift+arrow. These helpers widen
// the selection lanes from the open note to every note of its kind. Edits that would join two
// notes are refused (`crossNoteWriteRefusal`), the way Word refuses them.

import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { TextMeasurer } from '@docx-editor.dev/core/layout';
import { hitTestFragments, pageAtY, type SemanticHit } from '../layout/semantic-hit-test.ts';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import type { NoteOps } from './surface-note-ops.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** Refusal reason when an edit would remove the boundary between two notes. */
export const CROSS_NOTE_EDIT_REFUSAL = 'this is not a valid action for a selection across notes';

/** Whether two note scope ids name notes of the same kind, which form one story. */
export function sameNoteStory(a: string, b: string): boolean {
  if (a === b) return true;
  const left = parseNoteScopeId(a);
  const right = parseNoteScopeId(b);
  return left !== null && right !== null && left.noteKind === right.noteKind;
}

type NoteRecord = NonNullable<SemanticLayout['pages'][number]['footnotes']>['notes'][number];

export type NoteStoryHit = {
  readonly pageIndex: number;
  readonly scopeId: string;
  readonly local: { readonly x: number; readonly y: number };
  readonly fragments: readonly BlockFragmentRecord[];
};

/**
 * The note of the open story under a sheet point, for a selection gesture.
 *
 * A drag keeps extending when the pointer leaves the notes: past the last note, over the gap
 * between two notes or over the body above them, the point clamps to the nearest note of the
 * story on that page, like Word. Null when the page shows no note of the story.
 */
export function noteStoryHitAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number,
  scopeId: string
): NoteStoryHit | null {
  const page = layout.pages[pageAtY(layout, sheet.y)];
  if (!page) return null;
  const ox = pageOffsetX(page.index);
  let best: { note: NoteRecord; distance: number } | null = null;
  for (const area of [page.footnotes, page.endnotes]) {
    for (const note of area?.notes ?? []) {
      if (!sameNoteStory(note.scopeId, scopeId)) continue;
      const top = note.box.y;
      const bottom = top + note.box.height;
      const distance = sheet.y < top ? top - sheet.y : sheet.y >= bottom ? sheet.y - bottom : 0;
      if (!best || distance < best.distance) best = { note, distance };
    }
  }
  if (!best) return null;
  const { box } = best.note;
  const clamp = (value: number, size: number): number => Math.min(Math.max(value, 0), size);
  return {
    pageIndex: page.index,
    scopeId: best.note.scopeId,
    local: { x: clamp(sheet.x - box.x - ox, box.width), y: clamp(sheet.y - box.y, box.height) },
    fragments: best.note.fragments,
  };
}

/** The text position a selection gesture reaches in the open note story, or null. */
export function hitNoteStoryAtSheetPoint(
  host: {
    layout(): SemanticLayout;
    pageOffsetX(pageIndex: number): number;
    measurer(): TextMeasurer | undefined;
  },
  sheet: { readonly x: number; readonly y: number },
  scopeId: string
): SemanticHit | null {
  const layout = host.layout();
  const note = noteStoryHitAtSheetPoint(layout, sheet, (index) => host.pageOffsetX(index), scopeId);
  if (!note) return null;
  const measurer = host.measurer();
  return hitTestFragments(layout, note.pageIndex, note.fragments, note.local, {
    ...(measurer ? { measurer } : {}),
  });
}

/** The painted note of the open story that holds a paragraph, and its first page. */
export function noteOfParagraphInStory(
  layout: SemanticLayout,
  scopeId: string,
  paragraphId: string,
  preferredPageIndex?: number | null
): { readonly scopeId: string; readonly pageIndex: number } | null {
  let found: { scopeId: string; pageIndex: number } | null = null;
  for (const page of layout.pages) {
    for (const area of [page.footnotes, page.endnotes]) {
      for (const note of area?.notes ?? []) {
        if (!sameNoteStory(note.scopeId, scopeId)) continue;
        const holds = paragraphFragmentsOfBlocks(note.fragments).some(
          (fragment) => fragment.paragraphId === paragraphId
        );
        if (!holds) continue;
        if (page.index === preferredPageIndex)
          return { scopeId: note.scopeId, pageIndex: page.index };
        found ??= { scopeId: note.scopeId, pageIndex: page.index };
      }
    }
  }
  return found;
}

/**
 * Follow the selection head into the note that holds it.
 *
 * The open note names the frame, the label and the caret host, so it has to be the note the
 * caret is in. A selection that leaves the story, or stays in the open note, changes nothing.
 */
export function followNoteOfHead(
  layout: SemanticLayout,
  active: { readonly scopeId: string; readonly pageIndex: number | null },
  selection: SemanticSelection,
  retarget: (scopeId: string, pageIndex: number) => void
): void {
  const next = noteOfParagraphInStory(
    layout,
    active.scopeId,
    selection.head.paragraphId,
    active.pageIndex
  );
  if (!next) return;
  // The same note keeps its page: entry reveals it, and arrows retarget continuations.
  if (next.scopeId === active.scopeId) return;
  retarget(next.scopeId, next.pageIndex);
}

/** {@link followNoteOfHead} for the surface's note ops, when a note is open. */
export function followOpenNoteToHead(
  notes: Pick<NoteOps, 'activeNoteScope' | 'activeNotePageIndex' | 'followNote'> | null,
  layout: SemanticLayout,
  selection: SemanticSelection
): void {
  const open = notes?.activeNoteScope();
  if (!notes || !open) return;
  const active = { scopeId: open.id, pageIndex: notes.activeNotePageIndex() };
  followNoteOfHead(layout, active, selection, (scopeId, pageIndex) =>
    notes.followNote(scopeId, pageIndex)
  );
}

/**
 * The refusal for an edit over a selection that spans two notes, or null.
 *
 * Word refuses typing, deletion and paste over such a range ("This is not a valid action for
 * footnotes"). Deleting it would merge the notes or strand a reference mark. Formatting and
 * copy still work across notes, and do not ask this.
 */
export function crossNoteEditRefusal(
  layout: SemanticLayout,
  scopeId: string | null,
  selection: SemanticSelection
): string | null {
  if (!scopeId || selection.anchor.paragraphId === selection.head.paragraphId) return null;
  const anchor = noteOfParagraphInStory(layout, scopeId, selection.anchor.paragraphId);
  const head = noteOfParagraphInStory(layout, scopeId, selection.head.paragraphId);
  if (!anchor || !head) return null;
  return anchor.scopeId === head.scopeId ? null : CROSS_NOTE_EDIT_REFUSAL;
}

/** Ops that take content out of the story: the part of a replacing edit that would join notes. */
function removesContent(op: TreeDocOp): boolean {
  switch (op.op) {
    case 'deleteText':
    case 'joinParagraphs':
    case 'deleteBlock':
    case 'deleteDrawing':
    case 'removeMathEquation':
    case 'proposeParagraphMerge':
    case 'replaceStoryBlocks':
      return true;
    case 'setParagraphMarkRevision':
      return op.kind === 'del';
    default:
      return false;
  }
}

/**
 * {@link crossNoteEditRefusal} for a write about to apply at the selection. Only writes that
 * remove content refuse: typing, deletion, paste and cut each start with one. Formatting does
 * not, so bold or a style still applies across notes, as in Word.
 */
export function crossNoteWriteRefusal(
  layout: SemanticLayout,
  scopeId: string | null,
  selection: SemanticSelection,
  ops: readonly TreeDocOp[]
): string | null {
  if (!scopeId || !ops.some(removesContent)) return null;
  return crossNoteEditRefusal(layout, scopeId, selection);
}

/** {@link crossNoteEditRefusal} for the surface's own selection, for gates that run before a write. */
export function surfaceCrossNoteRefusal(
  surface: Pick<PaginatedSurface, 'activeScope' | 'layout' | 'state'>
): string | null {
  const scope = surface.activeScope();
  if (scope.kind !== 'note') return null;
  return crossNoteEditRefusal(surface.layout(), scope.id, surface.state().selection);
}

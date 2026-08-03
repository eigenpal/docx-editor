// How a tracked change LOOKS.
//
// OOXML says nothing about this. A revision carries `@w:author` and no colour: Word assigns
// colours per author, in the application, and the choice never reaches the file. So this is
// presentation policy, and it belongs where a host can replace it — the colours resolve through
// `--doc-review-author-N` tokens rather than literals, and the author-to-slot mapping is one
// pure function.
//
// The decorations follow Word: an insertion is underlined, a deletion struck through, and the
// two halves of a MOVE are drawn distinguishably from an ordinary delete/insert pair, because
// they are one decision and a reviewer resolving one half resolves both.

import type { RevisionAttribution } from '../layout/revision-projection.ts';
import { linesOf, type SemanticLayout } from '../layout/semantic-records.ts';

/** How many author slots the token ramp defines. */
export const REVIEW_AUTHOR_SLOTS = 8;

/**
 * The presentation one span's revision stack resolves to.
 *
 * Both a decoration and a colour, because either alone is ambiguous: colour alone cannot say
 * whether text was added or removed, and a decoration alone cannot say by whom.
 */
export interface RevisionPresentation {
  /** The innermost attribution — whose pending decision this text is. */
  readonly attribution: RevisionAttribution;
  /** `text-decoration-line`, or null when the kind carries none. */
  readonly line: 'underline' | 'line-through' | null;
  /** `text-decoration-style`; double marks a MOVE, so it reads apart from a plain edit. */
  readonly decorationStyle: 'solid' | 'double';
  /** CSS custom-property reference for the author's colour. */
  readonly color: string;
  /** True when the content is struck from the live document, by any enclosing revision. */
  readonly deleted: boolean;
}

/**
 * Which colour slot each author gets, by ORDER OF FIRST APPEARANCE in the document.
 *
 * Word's model, and the reason it is worth the walk: a hash of the name is stable but collides,
 * and two reviewers drawn in one colour is not a cosmetic defect — it tells the reader the wrong
 * thing about who proposed what. Two ordinary names collide in an eight-slot hash often enough
 * to hit on the first document you try.
 *
 * Derived from the whole layout on every paint, so it does not drift between pages or between
 * an incremental repaint and a full one. Authors past the ramp's length wrap, which is a real
 * collision — a host with more reviewers than slots supplies its own mapping.
 */
export function authorSlotsOf(layout: SemanticLayout): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  // `linesOf` already walks pages, paragraph fragments and table cells in document order, so
  // the order here is the order a reader meets the authors — including inside tables, which a
  // hand-rolled walk over page records would have missed.
  for (const line of linesOf(layout)) {
    for (const span of line.spans) {
      for (const revision of span.revisions ?? []) {
        if (!slots.has(revision.author)) slots.set(revision.author, slots.size);
      }
    }
  }
  return slots;
}

/**
 * The presentation for a span's revision stack, or null when the text is untracked.
 *
 * The INNERMOST attribution names the colour and the decoration, because it is the pending
 * decision about this text. Deletion is asked of the WHOLE stack: an insertion inside a
 * deletion is text that is on its way out, and drawing it as a plain insertion would tell the
 * reader the opposite.
 */
export function revisionPresentationOf(
  revisions: readonly RevisionAttribution[] | undefined,
  authorSlots?: ReadonlyMap<string, number>
): RevisionPresentation | null {
  if (revisions === undefined || revisions.length === 0) return null;
  const attribution = revisions[revisions.length - 1]!;
  const deleted = revisions.some(
    (revision) => revision.kind === 'delete' || revision.kind === 'moveFrom'
  );
  const kind = attribution.kind;
  const line =
    kind === 'delete' || kind === 'moveFrom'
      ? 'line-through'
      : kind === 'insert' || kind === 'moveTo'
        ? 'underline'
        : null;
  return {
    attribution,
    // A deletion nested in an insertion still reads as removed: the strike wins over the
    // underline its container would have drawn.
    line: deleted && line === 'underline' ? 'line-through' : line,
    decorationStyle: kind === 'moveFrom' || kind === 'moveTo' ? 'double' : 'solid',
    color: `var(--doc-review-author-${(authorSlots?.get(attribution.author) ?? 0) % REVIEW_AUTHOR_SLOTS})`,
    deleted,
  };
}

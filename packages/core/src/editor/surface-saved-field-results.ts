// Caret and selection rules at the edges of saved field results (`fieldResults: 'editable'`).
//
// In that mode a field that shows its saved result (DATE, MERGEFIELD, HYPERLINK display text)
// addresses its result as ordinary text, and the offsets just before and just after the result
// are OUTSIDE the field: typing there lands before or after it. Three rules keep the field whole:
//
// - Backspace with the caret just after a field, and Delete with the caret just before one,
//   select the whole field. The next press removes it. Inside the result both keys edit text.
// - A word deletion from outside stops at the field's edge first, then takes the whole field.
// - A selection with one end inside a result and the other outside it grows to cover the whole
//   field, so a deletion never removes one marker of a field without the others.
//
// These rules wrap the legacy text-form rules, which already treat a FORMTEXT input this way;
// a position that is not at a saved result falls through to them unchanged.

import { findNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
import { savedResultRanges, type SavedResultRange } from '../store/store/field-result-edits.ts';
import type { FieldResultsScope } from './field-results-scope.ts';

/** The rules this module adds to; the legacy text-form interaction supplies them. */
interface FieldEdgeRules {
  selectForDeletion(direction: 'backward' | 'forward'): boolean;
  wordDeletionBoundary(
    text: string,
    offset: number,
    direction: -1 | 1,
    stops: ReadonlySet<number>
  ): number;
  beforeSelect(next: SemanticSelection): SemanticSelection | null;
}

export interface SavedFieldResultHost {
  readonly part: (paragraphId: string) => OoxmlPart | null | undefined;
  readonly selection: () => SemanticSelection;
  readonly select: (next: SemanticSelection) => void;
  /** Whether the document accepts edits now (editing or suggesting). */
  readonly writable: () => boolean;
  /** Document-order comparison of two positions: negative, zero, or positive. */
  readonly compare: (a: SemanticPosition, b: SemanticPosition) => number;
}

/** Saved results with text, in document order. Empty results are one unit and take no rule. */
function rangesAt(host: SavedFieldResultHost, paragraphId: string): readonly SavedResultRange[] {
  const part = host.part(paragraphId);
  const paragraph = part ? findNode(part, paragraphId) : null;
  if (paragraph?.kind !== 'paragraph') return [];
  return savedResultRanges(paragraph).filter((range) => range.start < range.end);
}

/** The saved result `position` is strictly inside, if any. */
function rangeAround(
  host: SavedFieldResultHost,
  position: SemanticPosition
): SavedResultRange | undefined {
  return rangesAt(host, position.paragraphId).find(
    (range) => position.offset > range.start && position.offset < range.end
  );
}

/**
 * Grow `next` so that no end sits inside a saved result unless the other end is inside the same
 * result (edges included). The inside end moves to the result edge away from the other end.
 */
export function grownSavedResultSelection(
  host: SavedFieldResultHost,
  next: SemanticSelection
): SemanticSelection {
  const grow = (end: SemanticPosition, other: SemanticPosition): SemanticPosition => {
    const range = rangeAround(host, end);
    if (!range) return end;
    if (
      other.paragraphId === end.paragraphId &&
      other.offset >= range.start &&
      other.offset <= range.end
    )
      return end;
    const offset = host.compare(other, end) < 0 ? range.end : range.start;
    return { paragraphId: end.paragraphId, offset };
  };
  const anchor = grow(next.anchor, next.head);
  const head = grow(next.head, next.anchor);
  return anchor === next.anchor && head === next.head ? next : { anchor, head };
}

/** `rules` with the saved-result edge rules in front. Identity in the `atomic` mode. */
export function withSavedFieldResults<T extends FieldEdgeRules>(
  rules: T,
  host: SavedFieldResultHost,
  scope: FieldResultsScope
): T {
  if (scope.mode === 'atomic') return rules;
  const { selectForDeletion, wordDeletionBoundary, beforeSelect } = rules;
  /**
   * The whole field a deletion gesture selected. Its offsets are those of the result text, so
   * the editor remembers that the FIELD is selected: deleting it then removes the field and its
   * markers, where deleting the same offsets selected by hand keeps an empty field.
   */
  let selectedField: SemanticSelection | null = null;
  const isSelectedField = (selection: SemanticSelection): boolean =>
    selectedField !== null &&
    selection.anchor.paragraphId === selectedField.anchor.paragraphId &&
    selection.head.paragraphId === selectedField.head.paragraphId &&
    selection.anchor.offset === selectedField.anchor.offset &&
    selection.head.offset === selectedField.head.offset;
  scope.selectsWholeFieldWhen(() => isSelectedField(host.selection()));
  /** The saved result whose outer edge the collapsed caret is at, on the deletion side. */
  const beside = (direction: -1 | 1): SavedResultRange | undefined => {
    const { anchor, head } = host.selection();
    if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return;
    return rangesAt(host, head.paragraphId).find((range) =>
      direction === -1 ? range.end === head.offset : range.start === head.offset
    );
  };
  return Object.assign(rules, {
    selectForDeletion: scope.wrap((direction: 'backward' | 'forward'): boolean => {
      const range = host.writable() ? beside(direction === 'backward' ? -1 : 1) : undefined;
      if (!range) return selectForDeletion.call(rules, direction);
      const { paragraphId } = host.selection().head;
      selectedField = {
        anchor: { paragraphId, offset: range.start },
        head: { paragraphId, offset: range.end },
      };
      host.select(selectedField);
      return true;
    }),
    wordDeletionBoundary: scope.wrap(
      (text: string, offset: number, direction: -1 | 1, stops: ReadonlySet<number>): number => {
        const target = wordDeletionBoundary.call(rules, text, offset, direction, stops);
        const ranges = rangesAt(host, host.selection().head.paragraphId);
        const edge = ranges.find((range) =>
          direction === -1 ? range.end === offset : range.start === offset
        );
        // From outside, a word deletion at the field's edge takes the whole field.
        if (edge) return direction === -1 ? edge.start : edge.end;
        // Otherwise it stops at the nearest field edge it would cross.
        let boundary = target;
        for (const range of ranges) {
          for (const at of [range.start, range.end]) {
            if (direction === -1 && at < offset && at > boundary) boundary = at;
            if (direction === 1 && at > offset && at < boundary) boundary = at;
          }
        }
        return boundary;
      }
    ),
    beforeSelect: scope.wrap((next: SemanticSelection): SemanticSelection | null => {
      if (!isSelectedField(next)) selectedField = null;
      return beforeSelect.call(rules, grownSavedResultSelection(host, next));
    }),
  });
}

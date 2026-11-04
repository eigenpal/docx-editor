import type { FieldAwarePiece } from './field-pieces.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import { fitTextSpanMarker } from './fit-text-groups.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Preserve the projection and revision metadata of every published span. */
export const paragraphSpanMetadata = (
  piece: FieldAwarePiece
): {
  revisions?: readonly RevisionAttribution[];
  changeSites?: readonly RevisionAttribution[];
  fieldAtom?: FieldAwarePiece['fieldAtom'];
  noteSeparator?: FieldAwarePiece['noteSeparator'];
} => ({
  // A fitted group sets its own spacing; line adjustments read this marker to leave it alone.
  ...fitTextSpanMarker(piece),
  ...(piece.revisions === undefined ? {} : { revisions: piece.revisions }),
  ...(piece.changeSites === undefined ? {} : { changeSites: piece.changeSites }),
  // Rides the same carrier for the same reason: only the paragraph walk knows an atom was a
  // field, and by paint time its result is indistinguishable from ordinary text.
  ...(piece.fieldAtom === undefined ? {} : { fieldAtom: piece.fieldAtom }),
  ...(piece.noteSeparator ? { noteSeparator: piece.noteSeparator } : {}),
});

/**
 * Mark the spans of a finished line whose bold the measurer synthesizes. Only the measurer knows
 * the face, and paint, which adds the extra advance of that bold, has no measurer.
 */
export function markSyntheticBoldSpans(
  line: { readonly spans: StyleSpanRecord[] },
  measurer: TextMeasurer
): void {
  for (let index = 0; index < line.spans.length; index++) {
    const span = line.spans[index]!;
    // A space or a tab draws no ink, so it takes no extra advance.
    if (!span.style.bold || span.syntheticBold || !/\S/.test(span.text)) continue;
    if (measurer.syntheticBold?.(styleForFontSlot(span.style, span.fontSlot)))
      line.spans[index] = { ...span, syntheticBold: true };
  }
}

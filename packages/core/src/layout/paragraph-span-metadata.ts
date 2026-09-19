import type { FieldAwarePiece } from './field-pieces.ts';
import type { RevisionAttribution } from './revision-projection.ts';

/** Preserve the projection and revision metadata of every published span. */
export const paragraphSpanMetadata = (
  piece: FieldAwarePiece
): {
  revisions?: readonly RevisionAttribution[];
  changeSites?: readonly RevisionAttribution[];
  fieldAtom?: FieldAwarePiece['fieldAtom'];
  noteSeparator?: FieldAwarePiece['noteSeparator'];
} => ({
  ...(piece.revisions === undefined ? {} : { revisions: piece.revisions }),
  ...(piece.changeSites === undefined ? {} : { changeSites: piece.changeSites }),
  // Rides the same carrier for the same reason: only the paragraph walk knows an atom was a
  // field, and by paint time its result is indistinguishable from ordinary text.
  ...(piece.fieldAtom === undefined ? {} : { fieldAtom: piece.fieldAtom }),
  ...(piece.noteSeparator ? { noteSeparator: piece.noteSeparator } : {}),
});

import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import type { DisplayWalkInput } from './field-display-input.ts';
import type { FieldAwarePiece, MutableChangeSite, MutableModelRange } from './field-pieces.ts';
import { styleSeparatorMembersOf } from './style-separator-group.ts';

/** Ranges inside one member, moved to the member's own offsets. */
function memberRanges<T extends { readonly start: number; readonly end: number }>(
  ranges: readonly T[] | undefined,
  base: number,
  end: number
): T[] | undefined {
  return ranges
    ?.filter((range) => range.start >= base && range.end <= end)
    .map((range) => ({ ...range, start: range.start - base, end: range.end - base }));
}

/** Project members independently so styles and field state never cross an authored seam. */
export function styleSeparatorPieces(
  input: DisplayWalkInput,
  collect: (input: DisplayWalkInput) => FieldAwarePiece[]
): FieldAwarePiece[] | undefined {
  const members = styleSeparatorMembersOf(input.paragraph);
  if (!members) return undefined;
  const result: FieldAwarePiece[] = [];
  for (const member of members) {
    const deleted: MutableModelRange[] = [];
    const changes: MutableChangeSite[] = [];
    const end = member.base + paragraphOffsetIndex(member.paragraph as OoxmlParagraphNode).length;
    const local: DisplayWalkInput = {
      ...input,
      paragraph: member.paragraph,
      inheritedRunProperties: member.runProperties,
      fieldCodeRanges: memberRanges(input.fieldCodeRanges, member.base, end),
      tocLinkStyleRanges: memberRanges(input.tocLinkStyleRanges, member.base, end),
      deletedRanges: deleted,
      changeSites: changes,
    };
    for (const piece of collect(local)) {
      result.push({ ...piece, start: piece.start + member.base, end: piece.end + member.base });
    }
    for (const range of deleted)
      input.deletedRanges?.push({
        ...range,
        start: range.start + member.base,
        end: range.end + member.base,
      });
    for (const site of changes)
      input.changeSites?.push({
        ...site,
        start: site.start + member.base,
        end: site.end + member.base,
      });
  }
  return result;
}

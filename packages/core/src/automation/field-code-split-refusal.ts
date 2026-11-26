// A paragraph split or delete that would add or remove a paragraph mark inside a complex
// field's field codes, refused before the write.
//
// When a field's field codes (`w:instrText`, ECMA-376 Part 1, 17.16.23) hold paragraph marks,
// a split inside them, or at offset 0 of the paragraph where they end, adds one more mark to
// the field instruction (`w:fldChar`, CT_FldChar, 17.16.18). Layout shows no change for it, so
// the write would change the field silently. The planners refuse it instead. A delete that
// removes such a mark is refused for the same reason.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  blockBeforeInsideFieldCodes,
  markIsFieldCode,
  splitInsideFieldCodes,
} from '../layout/field-code-marks.ts';
import type { PlannedOperation } from './plan-types.ts';

/** The refusal for a split at any of `offsets` of `paragraphId` inside field codes, or null. */
export function fieldCodeSplitRefusal(
  part: OoxmlPart,
  paragraphId: string,
  offsets: readonly number[]
): PlannedOperation | null {
  if (!offsets.some((offset) => splitInsideFieldCodes(part, paragraphId, offset))) return null;
  return refusal('a paragraph break here would add a paragraph mark inside a field instruction');
}

/**
 * The refusal for a delete across `ids`, the paragraphs it spans in order, when a mark it
 * removes (every mark but the last one) is field code, or null. A text delete keeps the field
 * characters, so it would join the field codes and drop the paragraphs inside them, changing
 * the instruction. The untracked range planner removes a field the range holds whole instead
 * (`field-code-range-delete.ts`) and returns this refusal only for part of a field.
 */
export function fieldCodeDeleteRefusal(
  part: OoxmlPart,
  ids: readonly string[]
): PlannedOperation | null {
  if (!ids.slice(0, -1).some((id) => markIsFieldCode(part, id))) return null;
  return refusal(
    'this delete would remove a paragraph mark inside a field instruction; an untracked delete from the start of the field through the end of its result removes the whole field'
  );
}

/** The refusal for deleting paragraph `paragraphId` when its mark is field code, or null. */
export function fieldCodeParagraphDeleteRefusal(
  part: OoxmlPart,
  paragraphId: string
): PlannedOperation | null {
  if (!markIsFieldCode(part, paragraphId)) return null;
  return refusal('this paragraph holds a paragraph mark inside a field instruction');
}

/**
 * The refusal for a table authored at `offset` of `paragraphId` when it would land inside
 * field codes, or null. The table goes before the next paragraph at the end of a paragraph,
 * before this paragraph at its start, and before the tail of a split anywhere else, the same
 * placement `planInsertTable` makes.
 */
export function fieldCodeTableRefusal(
  part: OoxmlPart,
  paragraphId: string,
  offset: number,
  length: number,
  nextParagraphId: string | undefined
): PlannedOperation | null {
  const inside =
    offset === 0
      ? blockBeforeInsideFieldCodes(part, paragraphId)
      : offset === length && nextParagraphId !== undefined
        ? blockBeforeInsideFieldCodes(part, nextParagraphId)
        : splitInsideFieldCodes(part, paragraphId, offset);
  return inside ? refusal('a table here would land inside a field instruction') : null;
}

function refusal(message: string): PlannedOperation {
  // The same code as other refused complex-field structure: the content is valid, and this
  // host does not write that change to it.
  return {
    ok: false,
    error: { code: 'unsupported-capability', message, detail: 'field-code-mark' },
  };
}

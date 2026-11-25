// A paragraph split that would add a paragraph mark inside a complex field's field codes,
// refused before the write.
//
// When a field's field codes (`w:instrText`, ECMA-376 Part 1, 17.16.23) hold paragraph marks,
// a split inside them, or at offset 0 of the paragraph where they end, adds one more mark to
// the field instruction (`w:fldChar`, CT_FldChar, 17.16.18). Layout shows no change for it, so
// the write would change the field silently. The planners refuse it instead.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { splitInsideFieldCodes } from '../layout/field-code-marks.ts';
import type { PlannedOperation } from './plan-types.ts';

/** The refusal for a split at any of `offsets` of `paragraphId` inside field codes, or null. */
export function fieldCodeSplitRefusal(
  part: OoxmlPart,
  paragraphId: string,
  offsets: readonly number[]
): PlannedOperation | null {
  if (!offsets.some((offset) => splitInsideFieldCodes(part, paragraphId, offset))) return null;
  return {
    ok: false,
    error: {
      code: 'unsupported-content',
      message: 'a paragraph break here would add a paragraph mark inside a field instruction',
      detail: 'field-code-mark',
    },
  };
}

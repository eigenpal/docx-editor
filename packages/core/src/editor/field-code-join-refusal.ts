// `mergeParagraphs` across a paragraph mark that is field code, refused before the write.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, ECMA-376 Part 1, 17.16.18) of
// `ST_FldCharType` `begin` (17.18.29) to its `end`, and its field codes (`w:instrText`,
// 17.16.23) run up to `separate`. When the field codes hold paragraph marks, those marks belong
// to the field instruction: the paragraphs inside, and the paragraph that holds `begin`. Layout
// shows none of them as a break (`layout/field-instruction-paragraphs.ts`,
// `layout/field-code-paragraph-merge.ts`), and Backspace and Delete never join across them. A
// join would rewrite the field instruction without showing a change, so the command is refused
// with a stable reason instead.

import type { ExecResult } from '../contracts/editor.ts';
import { markIsFieldCode } from '../layout/field-code-marks.ts';
import { partOfNodeId } from './surface-scope.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** The reason `mergeParagraphs` gives when a joined mark is field code. */
export const FIELD_CODE_JOIN_REFUSAL =
  'field-code-mark: a paragraph mark here is part of a field instruction and cannot be joined';

/**
 * The refusal `mergeParagraphs` meets when it would remove a field-code paragraph mark, or
 * null. `ids` are the paragraphs it joins, in order; every mark but the last one goes.
 */
export function fieldCodeJoinRefusal(
  surface: PaginatedSurface,
  ids: readonly string[]
): Exclude<ExecResult, { ok: true }> | null {
  for (const id of ids.slice(0, -1)) {
    const part = partOfNodeId(surface.session, id);
    if (part && markIsFieldCode(part, id)) {
      return { ok: false, code: 'unsupported', reason: FIELD_CODE_JOIN_REFUSAL };
    }
  }
  return null;
}

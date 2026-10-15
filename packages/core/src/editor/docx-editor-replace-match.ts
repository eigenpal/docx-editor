// `replaceMatch`: replace one `findMatches` result where it stands.
//
// The match is addressed directly, so the reader's selection and the viewport stay put — a
// host stepping through its own list of matches must not have the caret taken or the page
// moved. Suggesting records a tracked replacement under the editor's author, through the same
// plan and store rules as a replacement typed over a selection.

import type { EditorCommand, ExecResult, TextMatch } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

type ReplaceMatchCommand = Extract<EditorCommand, { type: 'replaceMatch' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

/** The argument checks, which need no document. */
export function replaceMatchArgumentRefusal(command: ReplaceMatchCommand): string | null {
  const match: TextMatch | undefined = command.match;
  if (
    typeof match?.blockId !== 'string' ||
    match.blockId.length === 0 ||
    !Number.isInteger(match.start) ||
    match.start < 0 ||
    !Number.isInteger(match.length) ||
    match.length < 0
  ) {
    return 'match must carry a blockId and offsets';
  }
  if (typeof command.text !== 'string') return 'replaceMatch requires text';
  if (/[\r\n\v\f\u2028\u2029]/.test(command.text))
    return 'replaceMatch requires text without a paragraph mark';
  return null;
}

/**
 * Why the match cannot be replaced in the story the reader is in, or null. A match in a text
 * box, or in a story that is not open, is refused rather than edited behind the reader.
 */
export function replaceMatchStoryRefusal(
  surface: PaginatedSurface,
  match: TextMatch
): Refusal | null {
  const scope = match.scope ?? { kind: 'body' as const };
  const active = surface.activeScope();
  const same =
    scope.kind === 'body'
      ? active.kind === 'body'
      : scope.kind === 'headerFooter'
        ? active.kind === 'headerFooter' && active.rId === scope.rId
        : scope.kind === 'note'
          ? active.kind === 'note' && active.id === scope.id
          : false;
  if (same) return null;
  return {
    ok: false,
    code: 'unsupported',
    reason:
      scope.kind === 'frame'
        ? 'replaceMatch does not replace text in a text box'
        : 'replaceMatch replaces text only in the open story',
  };
}

/** Run an admitted `replaceMatch`. Null when it committed or had nothing to change. */
export function execReplaceMatch(
  surface: PaginatedSurface,
  command: ReplaceMatchCommand
): ExecResult | null {
  const refusal = replaceMatchStoryRefusal(surface, command.match);
  if (refusal) return refusal;
  const { blockId, start, length } = command.match;
  if (surface.replaceTextInPlace(blockId, start, start + length, command.text)) return null;
  return {
    ok: false,
    code: 'invalidArgs',
    reason: surface.state().lastRejection ?? 'replaceMatch was refused',
  };
}

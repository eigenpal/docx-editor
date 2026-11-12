// `replaceMatch`: replace one `findMatches` result, or one computed range, where it stands.
//
// The match is addressed directly, so the reader's selection and the viewport stay put — a
// host stepping through its own list of matches must not have the caret taken or the page
// moved. Suggesting records a tracked replacement under the editor's author, through the same
// plan and store rules as a replacement typed over a selection.
//
// A match in a header, footer, or note that is not open opens that story first, as
// `selectMatch` does, so the active story and the selection always agree. A match whose
// expected text is no longer at its offsets is refused before anything opens or changes.

import type { EditorCommand, ExecResult, ViewScope } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import {
  enterStoryPosition,
  isScopedStory,
  leaveScopeForBodyParagraph,
} from './docx-editor-story-navigation.ts';
import {
  isActiveStory,
  resolveTextTarget,
  storyOpenRefusal,
  targetParagraphText,
  textTargetArgumentRefusal,
  type TextTarget,
} from './text-target.ts';

type ReplaceMatchCommand = Extract<EditorCommand, { type: 'replaceMatch' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

/** The argument checks, which need no document. */
export function replaceMatchArgumentRefusal(command: ReplaceMatchCommand): string | null {
  const target = textTargetArgumentRefusal(command.match);
  if (target) return target;
  if (typeof command.text !== 'string') return 'replaceMatch requires text';
  if (/[\r\n\v\f\u2028\u2029]/.test(command.text))
    return 'replaceMatch requires text without a paragraph mark';
  return null;
}

/**
 * The story to replace in, or why the match cannot be replaced. Reads only, so `can` and
 * `exec` agree. A match in a text box is refused rather than edited behind the reader.
 */
export function replaceMatchTarget(
  surface: PaginatedSurface,
  match: TextTarget
): { readonly ok: true; readonly scope: ViewScope } | Refusal {
  const resolved = resolveTextTarget(surface, match);
  if (!resolved.ok) return resolved;
  if (resolved.scope.kind === 'frame') {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'replaceMatch does not replace text in a text box',
    };
  }
  return storyOpenRefusal(surface, resolved.scope) ?? { ok: true, scope: resolved.scope };
}

/**
 * Put the caret after the replacement in a story the command opened. The text after the match
 * is unchanged, so the caret sits that far from the paragraph end, past the insertion and past
 * a tracked deletion that stays in the text.
 */
function caretAfterReplacement(
  surface: PaginatedSurface,
  blockId: string,
  before: string,
  matchEnd: number
): void {
  const after = targetParagraphText(surface, blockId);
  if (after === null) return;
  const offset = Math.min(after.length, Math.max(0, after.length - (before.length - matchEnd)));
  const caret = { paragraphId: blockId, offset };
  surface.setSelection({ anchor: caret, head: caret });
}

/** Run an admitted `replaceMatch`. Null when it committed or had nothing to change. */
export function execReplaceMatch(
  surface: PaginatedSurface,
  command: ReplaceMatchCommand
): ExecResult | null {
  const target = replaceMatchTarget(surface, command.match);
  if (!target.ok) return target;
  const { blockId, start, length } = command.match;
  const { scope } = target;
  const opens = !isActiveStory(surface, scope);
  if (opens) {
    // The caret goes where the match is, so the open story and the selection agree.
    const position = { paragraphId: blockId, offset: start + length };
    if (isScopedStory(scope)) {
      const entered = enterStoryPosition(surface, scope, position);
      if (!entered.ok) return entered;
    } else {
      leaveScopeForBodyParagraph(surface, blockId);
      if (isActiveStory(surface, scope)) surface.setSelection({ anchor: position, head: position });
    }
    if (!isActiveStory(surface, scope)) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'the story that holds the match could not be opened',
      };
    }
  }
  const before = opens ? targetParagraphText(surface, blockId) : null;
  if (surface.replaceTextInPlace(blockId, start, start + length, command.text)) {
    if (before !== null) caretAfterReplacement(surface, blockId, before, start + length);
    return null;
  }
  return {
    ok: false,
    code: 'invalidArgs',
    reason: surface.state().lastRejection ?? 'replaceMatch was refused',
  };
}

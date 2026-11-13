// `replaceAcceptedText`: fix a range of a paragraph's accepted text, as a proofing tool reads it.
//
// A checker reads `ParagraphText.acceptedText`, where a word that a tracked deletion splits is
// one word. Its fix names a range of that text, and replacing the whole range would strike
// and retype letters that were never wrong, moving other authors' changes out of the word.
// So the command compares the range with the fix and edits only the letters between the
// common start and the common end. Those letters can still cover several parts of the
// paragraph; each part is edited from the end to the start, in one commit, so one undo step.
//
// The write goes to the story that holds the paragraph, without opening it: a header, a
// footer, a note, or a text box. Suggesting tracks it under the editor's author, as
// `replaceMatch` does. The reader's selection stays next to the same characters.

import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { EditorCommand, ExecResult, ParagraphText } from '../contracts/editor.ts';
import { isCollaborationFailureCode } from '../collaboration/failure.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { writeRejectionReason } from './command-protection.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { acceptedTextRanges, textOffsetFromAccepted } from './paragraph-text-ranges.ts';
import { textboxScopeOfParagraph } from './review-story-entry.ts';
import { mapSelectionAcrossText } from './surface-remote-caret.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';
import { removedTextRefusal, resolveTextTarget } from './text-target.ts';

type ReplaceAcceptedTextCommand = Extract<EditorCommand, { type: 'replaceAcceptedText' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

const PARAGRAPH_MARK = /[\r\n\v\f\u2028\u2029]/;

/** The argument checks, which need no document. */
export function replaceAcceptedTextArgumentRefusal(
  command: ReplaceAcceptedTextCommand
): string | null {
  if (
    typeof command.blockId !== 'string' ||
    command.blockId.length === 0 ||
    !Number.isInteger(command.start) ||
    command.start < 0 ||
    !Number.isInteger(command.length) ||
    command.length < 0
  ) {
    return 'replaceAcceptedText requires a blockId and offsets';
  }
  if (typeof command.text !== 'string') return 'replaceAcceptedText requires text';
  if (PARAGRAPH_MARK.test(command.text))
    return 'replaceAcceptedText requires text without a paragraph mark';
  if (command.expectedText !== undefined && typeof command.expectedText !== 'string')
    return 'replaceAcceptedText expectedText must be a string';
  return null;
}

const NOT_FOUND: Refusal = Object.freeze({
  ok: false as const,
  code: 'notFound' as const,
  reason: 'the paragraph does not hold that accepted text; read it again',
});

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * The part of `before` that differs from `after`: the common start and the common end are left
 * out, and neither cut splits a surrogate pair. Offsets are in `before`.
 */
export function differingRange(
  before: string,
  after: string
): { readonly from: number; readonly to: number; readonly text: string } {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1;
  return {
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

/** The planned write: the ops, in order, and the model-text range they start from. */
interface Plan {
  readonly ops: readonly TreeDocOp[];
  /** `text` ranges the plan replaces or deletes, from the start to the end. */
  readonly pieces: readonly { readonly start: number; readonly length: number }[];
}

/** Plan the edit, or the refusal. Reads only, so `can` and `exec` agree. */
function planReplacement(
  surface: PaginatedSurface,
  paragraph: ParagraphText,
  command: ReplaceAcceptedTextCommand
): Plan | Refusal | null {
  const { acceptedText, blockId } = paragraph;
  const end = command.start + command.length;
  if (end > acceptedText.length) return NOT_FOUND;
  const current = acceptedText.slice(command.start, end);
  if (command.expectedText !== undefined && command.expectedText !== current) return NOT_FOUND;
  const diff = differingRange(current, command.text);
  const from = command.start + diff.from;
  const to = command.start + diff.to;
  if (from === to && diff.text.length === 0) return null;
  const ops: TreeDocOp[] = [];
  if (from === to) {
    // A pure insertion follows the accepted text before it, ahead of any struck text.
    const at = textOffsetFromAccepted(paragraph, from);
    const landing = surface.replacementLanding(blockId, at, at) ?? at;
    ops.push({ op: 'insertText', paragraphId: blockId, offset: landing, text: diff.text });
    return { ops, pieces: [{ start: at, length: 0 }] };
  }
  const pieces = acceptedTextRanges(paragraph, from, to).map(({ start, length }) => ({
    start,
    length,
  }));
  // Back to front: a later part never moves the offsets of an earlier one.
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const piece = pieces[index]!;
    ops.push({
      op: 'deleteText',
      paragraphId: blockId,
      start: piece.start,
      end: piece.start + piece.length,
    });
  }
  const first = pieces[0]!;
  const firstEnd = first.start + first.length;
  // Non-null exactly when the edit is tracked: the struck text stays, the insertion follows it.
  const landing = surface.replacementLanding(blockId, first.start, firstEnd);
  ops.push({ op: 'deleteText', paragraphId: blockId, start: first.start, end: firstEnd });
  if (diff.text.length > 0) {
    ops.push({
      op: 'insertText',
      paragraphId: blockId,
      offset: landing ?? first.start,
      text: diff.text,
    });
  }
  return { ops, pieces };
}

/** The story to write in, or why the paragraph cannot be written. Reads only. */
function storyOf(
  surface: PaginatedSurface,
  paragraph: ParagraphText,
  command: ReplaceAcceptedTextCommand,
  pieces: Plan['pieces']
): StoryScope | Refusal {
  const { blockId } = paragraph;
  const part = partOfNodeId(surface.session, blockId);
  if (!part) return NOT_FOUND;
  const inTextBox = textboxScopeOfParagraph(part, blockId) !== null;
  for (const piece of pieces) {
    const target = { blockId, start: piece.start, length: piece.length };
    // A text box is written through the story that holds it, so its story needs no opening.
    if (!inTextBox) {
      const resolved = resolveTextTarget(
        surface,
        command.scope ? { ...target, scope: command.scope } : target,
        'refuse'
      );
      if (!resolved.ok) return resolved;
    } else if (command.scope && command.scope.kind !== 'frame') {
      return {
        ok: false,
        code: 'invalidArgs',
        reason: 'the scope names a different story than the one that holds the paragraph',
      };
    }
    const removed = removedTextRefusal(surface, target);
    if (removed) return removed;
  }
  return storyScopeOfNodeId(surface.session, blockId, { kind: 'body' });
}

/** Whether `replaceAcceptedText` would write, without writing. */
export function replaceAcceptedTextRefusal(
  surface: PaginatedSurface,
  paragraph: ParagraphText | null,
  command: ReplaceAcceptedTextCommand
): Refusal | null {
  if (!paragraph) return NOT_FOUND;
  const plan = planReplacement(surface, paragraph, command);
  if (plan === null) return null;
  if ('ok' in plan) return plan;
  const story = storyOf(surface, paragraph, command, plan.pieces);
  return 'ok' in story ? story : null;
}

/** Run an admitted `replaceAcceptedText`. Null when it committed or had nothing to change. */
export function execReplaceAcceptedText(
  surface: PaginatedSurface,
  readParagraph: (blockId: string) => ParagraphText | null,
  command: ReplaceAcceptedTextCommand
): ExecResult | null {
  // Typing still in the buffer lands first, so the range is checked against it.
  surface.flushPendingInput();
  const paragraph = readParagraph(command.blockId);
  if (!paragraph) return NOT_FOUND;
  const plan = planReplacement(surface, paragraph, command);
  if (plan === null) return null;
  if ('ok' in plan) return plan;
  const story = storyOf(surface, paragraph, command, plan.pieces);
  if ('ok' in story) return story;
  const { blockId } = paragraph;
  const modelText = () => {
    const part = partOfNodeId(surface.session, blockId);
    return (part && paragraphTextOf(part, blockId)) ?? undefined;
  };
  const before = modelText();
  const carry = (selection: Parameters<typeof mapSelectionAcrossText>[0]) => {
    const after = modelText();
    return before === undefined || after === undefined
      ? selection
      : mapSelectionAcrossText(selection, blockId, before, after);
  };
  const outcome = surface.applyAutomationOps(() => plan.ops, story, undefined, false, carry);
  if (!outcome.rejected) return null;
  const raw = String(outcome.reason ?? 'replaceAcceptedText was refused');
  if (isCollaborationFailureCode(raw)) return { ok: false, code: 'unsupported', reason: raw };
  const reason =
    surface.state().lastRejection ?? writeRejectionReason(raw, surface.session.settingsRoot());
  return { ok: false, code: raw === 'locked' || raw === 'bound' ? raw : 'invalidArgs', reason };
}

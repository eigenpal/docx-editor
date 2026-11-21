// Writes into a generated table of contents, answered BEFORE the write, so `can`, the toolbar
// and `exec` all say the same thing. The surface's write guard stays the authority; this asks
// its range predicates of the selection, as the guard asks them of each op.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { RUN_FORMAT_COMMANDS, selectedSpans } from './content-lock-format-refusal.ts';
import {
  PARAGRAPH_FORMAT_COMMANDS,
  selectedParagraphIds,
} from './paragraph-format-lock-refusal.ts';
import {
  TOC_READ_ONLY_REFUSAL,
  tocRefusesTextWrite,
  tocDropsRunFormatting,
  tocParagraphRanges,
  tocRefusesParagraphFormatting,
} from './surface-toc-ranges.ts';

/** Commands that write text at the selection, which the guard refuses inside the TOC. */
const TEXT_AT_SELECTION_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'insertText',
  'insertBreak',
  'paste',
  'pasteWithoutFormatting',
  'splitParagraph',
  'deleteText',
  'cut',
]);

/** Paragraph formats whose writer writes the selection as one unit. */
const WHOLE_SELECTION_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'toggleList',
  'adjustIndent',
]);

/**
 * The refusal a command meets because it would write only into a generated table of
 * contents, or null.
 *
 * Text written over the selection is refused when it reaches generated content.
 * Formatting is refused when the guard would drop every write it makes; a selection that
 * also covers ordinary text formats that text. Lists and indent steps are refused when any
 * selected paragraph is protected.
 */
export function tocCommandRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  const part = surface.session.part();
  if (tocParagraphRanges(part).length === 0) return null;
  const refused = TEXT_AT_SELECTION_COMMANDS.has(command.type)
    ? tocRefusesTextWrite(part, surface.state().selection, selectedParagraphIds(surface))
    : RUN_FORMAT_COMMANDS.has(command.type)
      ? tocDropsRunFormatting(part, selectedSpans(surface))
      : PARAGRAPH_FORMAT_COMMANDS.has(command.type) &&
        tocRefusesParagraphFormatting(
          part,
          selectedParagraphIds(surface),
          WHOLE_SELECTION_COMMANDS.has(command.type)
        );
  // The caller can fix it by moving the selection, as with the write guard's own refusal.
  return refused ? { ok: false, code: 'invalidArgs', reason: TOC_READ_ONLY_REFUSAL } : null;
}

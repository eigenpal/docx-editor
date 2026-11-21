// Writes into a generated table of contents, answered BEFORE the write, so `can`, the toolbar
// and `exec` all say the same thing. The surface's write guard stays the authority; this asks
// its range predicates of the selection, as the guard asks them of each op.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { DocTarget } from '../contracts/types.ts';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import { resolveDocTargetSelection } from './doc-target-resolution.ts';
import { RUN_FORMAT_COMMANDS, selectedSpans } from './content-lock-format-refusal.ts';
import {
  PARAGRAPH_FORMAT_COMMANDS,
  selectedParagraphIds,
} from './paragraph-format-lock-refusal.ts';
import {
  TOC_READ_ONLY_REFUSAL,
  paragraphInBodyToc,
  selectionTouchesTocRange,
  tocAtParagraphEnd,
  tocRefusesRunFormatting,
  tocParagraphRanges,
  tocRefusesJoin,
  tocRefusesParagraphFormatting,
  tocRefusesTextWrite,
} from './surface-toc-ranges.ts';

/** Commands that write text over the selection, or join paragraphs around it. */
const TEXT_AT_SELECTION_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'insertText',
  'insertBreak',
  'paste',
  'pasteWithoutFormatting',
  'splitParagraph',
  'deleteText',
  'cut',
  'replaceText',
  'insertNote',
  'proposeDeletion',
  'proposeReplacement',
]);

/** Commands that wrap or mark the selection without replacing it. */
const MARK_SELECTION_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'insertBookmark',
  'insertContentControl',
  'insertHyperlink',
  'proposeInsertion',
]);

/** Run formats: the toolbar's marks and the automation format. */
const RUN_FORMATS: ReadonlySet<EditorCommand['type']> = new Set([
  ...RUN_FORMAT_COMMANDS,
  'applyFormatting',
  'pasteFormatting',
]);

/** Run formats whose writer writes the selection as one unit. */
const WHOLE_RUN_FORMATS: ReadonlySet<EditorCommand['type']> = new Set(['pasteFormatting']);

/** Paragraph formats whose writer writes the selection as one unit. */
const WHOLE_SELECTION_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'toggleList',
  'adjustIndent',
]);

/**
 * The refusal a command meets because it would write only into a generated table of
 * contents, or null.
 *
 * Text written over the selection, and objects inserted at it, are refused when they reach
 * generated content.
 * Formatting is refused when the guard would drop every write it makes; a selection that
 * also covers ordinary text formats that text. Lists and indent steps are refused when any
 * selected paragraph is protected.
 */
export function tocCommandRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  const part = surface.session.part();
  if (tocParagraphRanges(part).length === 0 || !refusesInToc(command, surface, part)) {
    return null;
  }
  // The caller can fix it by moving the selection, as with the write guard's own refusal.
  return { ok: false, code: 'invalidArgs', reason: TOC_READ_ONLY_REFUSAL };
}

function refusesInToc(command: EditorCommand, surface: PaginatedSurface, part: OoxmlPart): boolean {
  const type = command.type;
  const selection = commandSelection(command, surface);
  if (!selection) return false; // An unresolvable target meets its own refusal.
  const head = selection.head.paragraphId;
  if (TEXT_AT_SELECTION_COMMANDS.has(type)) {
    return tocRefusesTextWrite(part, selection, paragraphIdsBetween(surface, selection));
  }
  if (MARK_SELECTION_COMMANDS.has(type)) return selectionTouchesTocRange(part, selection);
  if (type === 'mergeParagraphs') return tocRefusesJoin(part, mergedParagraphIds(surface));
  // A table splits the caret's paragraph; a text box anchors at the paragraph's end.
  if (type === 'insertTable') return paragraphInBodyToc(part, head);
  if (type === 'insertTextBox') return tocAtParagraphEnd(part, head);
  if (RUN_FORMATS.has(type)) {
    return tocRefusesRunFormatting(part, selectedSpans(surface), WHOLE_RUN_FORMATS.has(type));
  }
  if (!PARAGRAPH_FORMAT_COMMANDS.has(type)) return false;
  const whole = WHOLE_SELECTION_COMMANDS.has(type);
  return tocRefusesParagraphFormatting(part, selectedParagraphIds(surface), whole);
}

/** The paragraphs `mergeParagraphs` joins: the selected ones, or the caret's and the next. */
function mergedParagraphIds(surface: PaginatedSurface): readonly string[] {
  const ids = selectedParagraphIds(surface);
  if (ids.length > 1) return ids;
  const order = surface.session.paragraphIds();
  const index = order.indexOf(ids[0]!);
  return index < 0 ? ids : order.slice(index, index + 2);
}

/** The selection a command writes at: its resolved target, when it names one. */
function commandSelection(
  command: EditorCommand,
  surface: PaginatedSurface
): SemanticSelection | null {
  const target = 'target' in command ? command.target : undefined;
  if (target === undefined) return surface.state().selection;
  const resolved = resolveDocTargetSelection(surface, target as DocTarget);
  return resolved.ok ? resolved.selection : null;
}

/** The body paragraphs from one end of `selection` to the other, in document order. */
function paragraphIdsBetween(
  surface: PaginatedSurface,
  { anchor, head }: SemanticSelection
): readonly string[] {
  const order = surface.session.paragraphIds();
  const a = order.indexOf(anchor.paragraphId);
  const b = order.indexOf(head.paragraphId);
  if (a < 0 || b < 0) return [...new Set([anchor.paragraphId, head.paragraphId])];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

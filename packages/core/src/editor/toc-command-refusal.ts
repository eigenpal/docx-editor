// Writes into a generated table of contents, answered BEFORE the write, so `can`, the toolbar
// and `exec` all say the same thing. The surface's write guard stays the authority; this asks
// its range predicates of the selection, as the guard asks them of each op.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { DocTarget } from '../contracts/types.ts';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import { resolveDocTargetSelection } from './doc-target-resolution.ts';
import { selectedSpans } from './content-lock-format-refusal.ts';
import { selectedParagraphIds } from './paragraph-format-lock-refusal.ts';
import {
  TOC_READ_ONLY_REFUSAL,
  selectionTouchesTocRange,
  tocAtEndMarkEdge,
  tocAtParagraphEnd,
  tocParagraphRanges,
  tocProtectsParagraph,
  tocRefusesInsertBefore,
  tocRefusesJoin,
  tocRefusesParagraphFormatting,
  tocRefusesRunFormatting,
  tocRefusesSectionMark,
  tocRefusesTextWrite,
} from './surface-toc-ranges.ts';

/**
 * How the write guard treats a command near a table of contents.
 *
 * - `none`: the command does not write at the selection, or its own lane answers.
 * - `text`: it writes text over the selection, so it is refused where the selection reaches
 *   generated content, or a range across paragraphs would remove or join a TOC paragraph.
 * - `mark`: it wraps or marks the selection without replacing it.
 * - `join`: `mergeParagraphs`. `table`: splits the caret's paragraph. `textBox`: anchors at
 *   the paragraph's end. `toc`: inserts a field before the caret's paragraph.
 * - `runFormat`, `paragraphFormat`: formats drop the writes that reach a TOC and are
 *   refused when none is left; `whole` writers are refused when any write reaches one.
 *
 * `writesEmptyMark`: at a caret in an empty paragraph the format writes the paragraph mark
 * instead of arming the next typed text.
 * `beforeEndMark`: the command inserts before the end mark when the selection starts a
 * closing line, inside the field result, where a refresh would drop it. `atTarget`: the
 * command writes at its resolved `target` (or `match`) rather than at the selection.
 */
interface TocPolicy {
  readonly kind:
    | 'none'
    | 'text'
    | 'mark'
    | 'join'
    | 'table'
    | 'textBox'
    | 'toc'
    | 'runFormat'
    | 'paragraphFormat';
  readonly whole?: true;
  readonly writesEmptyMark?: true;
  readonly beforeEndMark?: true;
  readonly atTarget?: true;
}

const NONE: TocPolicy = { kind: 'none' };
const TEXT: TocPolicy = { kind: 'text' };
const MARK: TocPolicy = { kind: 'mark' };
const RUN_FORMAT: TocPolicy = { kind: 'runFormat' };
const PARAGRAPH_FORMAT: TocPolicy = { kind: 'paragraphFormat' };

/**
 * Every command, so the compiler asks for a decision on each new one. `replaceAllMatches`
 * is `none`: it skips TOC matches like its other skipped matches, and reports a refusal only
 * after its search, which `can` does not run.
 */
const TOC_POLICIES: Readonly<Record<EditorCommand['type'], TocPolicy>> = {
  acceptAllRevisions: NONE,
  acceptRevision: NONE,
  addComment: { kind: 'mark', beforeEndMark: true },
  addRepeatingSectionItem: NONE,
  adjustIndent: { kind: 'paragraphFormat', whole: true },
  applyFormatting: RUN_FORMAT,
  applyVariables: NONE,
  clearFormatting: { kind: 'runFormat', writesEmptyMark: true },
  commitTableColumnDividerResize: NONE,
  commitTableRightEdgeResize: NONE,
  compareDocuments: NONE,
  convertAllNotes: NONE,
  convertNote: NONE,
  copy: NONE,
  copyFormatting: NONE,
  cut: TEXT,
  deleteBookmark: NONE,
  deleteColumn: NONE,
  deleteImage: NONE,
  deleteNote: NONE,
  deleteRow: NONE,
  deleteTable: NONE,
  deleteText: TEXT,
  editHeaderFooter: NONE,
  editTextFormField: NONE,
  exitHeaderFooter: NONE,
  goToBookmark: NONE,
  insertBookmark: { kind: 'mark', beforeEndMark: true },
  insertBreak: TEXT,
  insertChart: TEXT,
  insertColumn: NONE,
  insertContentControl: { kind: 'mark', beforeEndMark: true, atTarget: true },
  insertHyperlink: { kind: 'mark', beforeEndMark: true },
  insertImage: { kind: 'text', atTarget: true },
  insertNote: { kind: 'text', beforeEndMark: true },
  insertPageField: NONE,
  insertRow: NONE,
  insertTable: { kind: 'table' },
  insertText: TEXT,
  insertTextBox: { kind: 'textBox' },
  insertToc: { kind: 'toc' },
  keepFirstBookmark: NONE,
  linkHeaderFooterToPrevious: NONE,
  mergeCells: NONE,
  mergeParagraphs: { kind: 'join' },
  navigateHighlight: NONE,
  navigateReviewChange: NONE,
  openBookmarkDialog: NONE,
  openCompareDocumentsDialog: NONE,
  openGoTo: NONE,
  openRevisionMarkupDialog: NONE,
  paste: TEXT,
  pasteFormatting: { kind: 'runFormat', whole: true, writesEmptyMark: true },
  pasteWithoutFormatting: TEXT,
  proposeDeletion: { kind: 'text', atTarget: true },
  proposeInsertion: { kind: 'mark', atTarget: true },
  proposeReplacement: { kind: 'text', atTarget: true },
  redo: NONE,
  refreshToc: NONE,
  rejectAllRevisions: NONE,
  rejectRevision: NONE,
  removeContentControl: NONE,
  removeHeaderFooter: NONE,
  removeHyperlink: MARK,
  removeRepeatingSectionItem: NONE,
  removeTabMark: PARAGRAPH_FORMAT,
  removeToc: NONE,
  replaceAcceptedText: NONE,
  replaceAllMatches: NONE,
  replaceDocument: NONE,
  replaceImage: NONE,
  replaceMatch: { kind: 'text', atTarget: true },
  replaceText: TEXT,
  replyComment: NONE,
  resolveAllReviewChanges: NONE,
  resolveComment: NONE,
  selectAll: NONE,
  selectTableRegion: NONE,
  setAlignment: PARAGRAPH_FORMAT,
  setCellFill: NONE,
  setChartColor: NONE,
  setChartData: NONE,
  setChartFormat: NONE,
  setChartType: NONE,
  setContentControlValue: NONE,
  setEditingMode: NONE,
  setHeaderFooterOptions: NONE,
  setImagePosition: NONE,
  setImageProperties: NONE,
  setImageWrapType: NONE,
  setIndent: { kind: 'paragraphFormat', whole: true },
  setLineSpacing: PARAGRAPH_FORMAT,
  setMarkAttr: RUN_FORMAT,
  setNoteProperties: NONE,
  setPageSetup: NONE,
  setParagraphDirection: PARAGRAPH_FORMAT,
  setParagraphFormat: { kind: 'paragraphFormat', whole: true },
  setParagraphSpacing: PARAGRAPH_FORMAT,
  setParagraphStyle: PARAGRAPH_FORMAT,
  setReviewChangesAuthor: NONE,
  setReviewDisplayMode: NONE,
  setSelection: NONE,
  setShapeFill: NONE,
  setShapeOutline: NONE,
  setTableBorders: NONE,
  setTableCellVerticalAlignment: NONE,
  setTableProperties: NONE,
  setVariable: NONE,
  setWatermark: NONE,
  splitCell: NONE,
  splitParagraph: TEXT,
  toggleBookmarks: NONE,
  toggleDocumentProtection: NONE,
  toggleHeaderRow: NONE,
  toggleList: { kind: 'paragraphFormat', whole: true },
  toggleMark: RUN_FORMAT,
  toggleParagraphMarks: NONE,
  toggleReviewPane: NONE,
  transformImage: NONE,
  undo: NONE,
  unlinkHeaderFooterFromPrevious: NONE,
};

/**
 * The refusal a command meets because it would write into a generated table of contents,
 * or null. See {@link TocPolicy} for each kind of command.
 */
export function tocCommandRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  const policy = TOC_POLICIES[command.type];
  if (policy.kind === 'none') return null;
  const part = surface.session.part();
  if (tocParagraphRanges(part).length === 0 || !refusesInToc(command, policy, surface, part)) {
    return null;
  }
  // The caller can fix it by moving the selection, as with the write guard's own refusal.
  return { ok: false, code: 'invalidArgs', reason: TOC_READ_ONLY_REFUSAL };
}

function refusesInToc(
  command: EditorCommand,
  policy: TocPolicy,
  surface: PaginatedSurface,
  part: OoxmlPart
): boolean {
  const selection = policy.atTarget ? targetSelection(command, surface) : surface.state().selection;
  if (!selection) return false; // An unresolvable target meets its own refusal.
  const head = selection.head.paragraphId;
  if (policy.beforeEndMark && tocAtEndMarkEdge(part, selection)) return true;
  switch (policy.kind) {
    case 'text': {
      // A section break also ends a section at the caret's paragraph.
      const sectionBreak = command.type === 'insertBreak' && command.kind.startsWith('section');
      return (
        tocRefusesTextWrite(part, selection, paragraphIdsBetween(surface, selection)) ||
        (sectionBreak && tocRefusesSectionMark(part, head))
      );
    }
    case 'mark':
      return selectionTouchesTocRange(part, selection);
    case 'join':
      return tocRefusesJoin(part, mergedParagraphIds(surface));
    case 'table':
      return selectionTouchesTocRange(part, selection) || tocProtectsParagraph(part, head);
    case 'textBox':
      return tocAtParagraphEnd(part, head);
    case 'toc':
      return selectionTouchesTocRange(part, selection) || tocRefusesInsertBefore(part, head);
    case 'runFormat':
      return tocRefusesRunFormatting(part, selectedSpans(surface), {
        whole: policy.whole === true,
        writesEmptyMark: policy.writesEmptyMark === true,
      });
    case 'paragraphFormat':
      return tocRefusesParagraphFormatting(
        part,
        selectedParagraphIds(surface),
        policy.whole === true
      );
    case 'none':
      return false;
  }
}

/** The paragraphs `mergeParagraphs` joins: the selected ones, or the caret's and the next. */
function mergedParagraphIds(surface: PaginatedSurface): readonly string[] {
  const ids = selectedParagraphIds(surface);
  if (ids.length > 1) return ids;
  const order = surface.session.paragraphIds();
  const index = order.indexOf(ids[0]!);
  return index < 0 ? ids : order.slice(index, index + 2);
}

/** The selection a command writes at: its drop point, match, or resolved target. */
function targetSelection(
  command: EditorCommand,
  surface: PaginatedSurface
): SemanticSelection | null {
  if (command.type === 'insertImage' && command.at) {
    const at = { paragraphId: command.at.paragraphId, offset: command.at.offset };
    return { anchor: at, head: at };
  }
  if (command.type === 'replaceMatch') {
    const { blockId, start, length } = command.match;
    return {
      anchor: { paragraphId: blockId, offset: start },
      head: { paragraphId: blockId, offset: start + length },
    };
  }
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

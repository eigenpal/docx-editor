// Joining two paragraphs the reader sees as neighbours when the tree holds, between them,
// paragraphs a hidden mark removed from the flow (see `layout/hidden-paragraph-mark.ts`).
//
// Those paragraphs show nothing, so Backspace or Delete at the visible break means "join the
// two paragraphs on either side". A `joinParagraphs` of just those two is refused
// (`not-adjacent-siblings`), because joins need true child-index adjacency. The join instead
// absorbs each removed paragraph into the first paragraph on the way. The first paragraph
// keeps its properties, and whatever a removed paragraph holds (hidden runs, tracked content
// this view does not show) moves with it unchanged, so nothing the reader can see changes
// except the break they deleted.
//
// Which paragraphs count as removed is LAYOUT'S answer for the view being edited, not a
// separate rule: a paragraph whose only content is a tracked deletion is removed in the
// proposed view and shown in all-markup, and editing has to agree with the page either way.
//
// The caret can still come to rest in such a paragraph: Enter at the end of a paragraph whose
// mark is hidden makes an empty one, and deleting the last character of one empties it. A
// break the reader cannot see is not a place they can see either, so a caret there SHOWS at
// the start of the paragraph that takes the join, and the arrow keys move from there. Typing
// still lands in the paragraph itself, which then shows again, and so do the other lanes that
// insert at the caret. Paragraph and character formatting, and the toolbar state that reports
// it, read the paragraph where the caret shows. Backspace and Delete act on
// that paragraph first: both join it into the paragraph before it, which is the exact reverse
// of the Enter that made it, and only then act from the shown position.

import {
  parentNodeOf,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type {
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { paragraphsInsideFieldInstructions } from '../layout/field-instruction-paragraphs.ts';
import { numberingFlowBlocks } from '../layout/hidden-paragraph-mark.ts';
import { paragraphTextOf } from '../store/store/tree-ops.ts';
import { paragraphLinesFor, positionPastDeletion } from '../layout/paragraph-lines.ts';
import { joinStartShared } from '../layout/field-code-join-stop.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import { mergedFlowBlocks, paragraphMergeGroupOf } from '../layout/story-roots.ts';
import { mergedPredecessorsOf } from '../layout/line-segments.ts';
import {
  blockAnchorOutsideFieldCodes,
  blockBeforeInsideFieldCodes,
  markIsFieldCode,
  splitInsideFieldCodes,
} from '../layout/field-code-marks.ts';

/** The revision view the page is laid out in. */
export interface RevisionView {
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The reason an editor write gives when it would add a paragraph mark or a table inside field
 * codes that hold paragraph marks: inside a paragraph wholly in the field codes, or at the start
 * of the paragraph where they end. A new mark there would change the field instruction
 * (`w:fldChar`, ECMA-376 Part 1, 17.16.18) and show no change, so the write is refused.
 */
export const FIELD_CODE_SPLIT_REFUSAL =
  'field-code-mark: this would add a paragraph mark inside a field instruction';

/**
 * The informational rejection a rich paste leaves when it would have added paragraph marks
 * inside field codes and landed as plain text instead (`surface-clipboard-ops.ts`).
 */
export const FIELD_CODE_PASTE_NOTICE =
  'field-code-mark: the paste kept only its text, because its paragraphs would land inside a field instruction';

/**
 * Ids of the paragraphs a container's laid-out blocks draw: each block, and each member of a
 * merged paragraph. The paragraphs on either side of a field's field codes lay out as one
 * merged paragraph, and both still show.
 */
function laidOutIds(flow: readonly OoxmlNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const block of flow) {
    if (block.kind === 'textValue') continue;
    ids.add(block.id);
    for (const member of paragraphMergeGroupOf(block)?.members ?? []) ids.add(member.id);
  }
  return ids;
}

/**
 * Ids of the paragraphs among `children` that layout removes under a hidden mark in `view`.
 *
 * Asks the same collector layout uses for that container, so the two cannot disagree. A
 * paragraph inside a field instruction is left out: its mark is part of the field code
 * (§17.16.18), so a join never absorbs it.
 */
export function hiddenMarkRemovedIds(
  children: readonly OoxmlNode[],
  view: RevisionView
): ReadonlySet<string> {
  const flow = mergedFlowBlocks(children, view.displayMode, view.authorFilter);
  const all = numberingFlowBlocks(flow);
  if (all === flow) return NONE;
  const laidOut = laidOutIds(flow);
  const fieldCode = paragraphsInsideFieldInstructions(all);
  return new Set(
    all.flatMap((block, index) => (laidOut.has(block.id) || fieldCode.has(index) ? [] : [block.id]))
  );
}

/**
 * The laid-out paragraph that takes the join of a removed paragraph, read from layout's own
 * block list for the container: the next block after it that layout keeps. Markers between
 * blocks (a body-level `w:bookmarkEnd`) are not blocks at all, and a paragraph a revision view
 * removes is not kept, so neither can stand in for it. Null when the paragraph is not removed.
 */
function joinTargetOf(
  children: readonly OoxmlNode[],
  paragraphId: string,
  view: RevisionView
): string | null {
  const flow = mergedFlowBlocks(children, view.displayMode, view.authorFilter);
  const all = numberingFlowBlocks(flow);
  if (all === flow) return null;
  const laidOut = laidOutIds(flow);
  if (laidOut.has(paragraphId)) return null;
  const index = all.findIndex((block) => block.id === paragraphId);
  if (index === -1) return null;
  const next = all.slice(index + 1).find((block) => laidOut.has(block.id));
  return next?.kind === 'paragraph' ? next.id : null;
}

/**
 * Ids of the siblings strictly between two paragraphs, in order: `[]` when the two are
 * adjacent, `null` when they are not in that order. `removed` is asked only when there is
 * something between; the answer is `null` unless every sibling between is removed.
 */
export function hiddenParagraphsBetween(
  siblings: readonly OoxmlNode[],
  firstId: string,
  secondId: string,
  removed: () => ReadonlySet<string>
): string[] | null {
  const indexOf = (id: string): number =>
    siblings.findIndex((child) => child.kind !== 'textValue' && child.id === id);
  const first = indexOf(firstId);
  const second = indexOf(secondId);
  if (first === -1 || second <= first) return null;
  const between: string[] = [];
  for (let index = first + 1; index < second; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue') return null;
    between.push(child.id);
  }
  if (between.length === 0) return between;
  const ids = removed();
  return between.every((id) => ids.has(id)) ? between : null;
}

/**
 * True when `firstId` and `secondId` are siblings and only paragraphs inside a field instruction
 * stand between them. Those marks are field code (ECMA-376 Part 1, 17.16.18), so no join
 * crosses them; Delete moves the caret over them instead, as Backspace does.
 */
export function onlyFieldCodeBetween(
  part: OoxmlPart,
  firstId: string,
  secondId: string,
  view: RevisionView
): boolean {
  const parent = parentNodeOf(part, firstId);
  if (parent === null || parentNodeOf(part, secondId)?.id !== parent.id) return false;
  const all = numberingFlowBlocks(
    mergedFlowBlocks(parent.children, view.displayMode, view.authorFilter)
  );
  const first = all.findIndex((block) => block.id === firstId);
  const second = all.findIndex((block) => block.id === secondId);
  if (first === -1 || second <= first + 1) return false;
  const fieldCode = paragraphsInsideFieldInstructions(all);
  for (let index = first + 1; index < second; index += 1) {
    if (!fieldCode.has(index)) return false;
  }
  return true;
}

/**
 * The ops that join `secondId` onto `firstId`, absorbing any removed paragraphs between them
 * first, or `null` when the two are not siblings that such a join can reach.
 */
export function joinAcrossHiddenMarks(
  part: OoxmlPart,
  firstId: string,
  secondId: string,
  view: RevisionView
): TreeDocOp[] | null {
  const parent = parentNodeOf(part, firstId);
  if (parent === null || parentNodeOf(part, secondId)?.id !== parent.id) return null;
  const between = hiddenParagraphsBetween(parent.children, firstId, secondId, () =>
    hiddenMarkRemovedIds(parent.children, view)
  );
  if (between === null) return null;
  return [...between, secondId].map((id) => ({ op: 'joinParagraphs', firstId, secondId: id }));
}

/**
 * Where a position shows on the page.
 *
 * The start of a field's result side shows as the end of the first side, its one caret stop on
 * the shared line (see {@link fieldCodeJoinStart}).
 *
 * A position in a paragraph that layout removed shows at the start of the laid-out paragraph
 * that takes its join. Any other position, and one whose container holds nothing laid out
 * after it, shows where it is.
 */
export function shownPosition(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition,
  view: RevisionView
): SemanticPosition {
  const join = fieldCodeJoinStart(layout, part, position);
  if (join) return join;
  if (paragraphLinesFor(layout, position.paragraphId).length > 0) return position;
  const parent = parentNodeOf(part, position.paragraphId);
  if (parent === null) return position;
  const target = joinTargetOf(parent.children, position.paragraphId, view);
  return target === null ? position : { paragraphId: target, offset: 0 };
}

/**
 * Backspace or Delete from a caret in a paragraph layout removed: join that paragraph into the
 * sibling paragraph before it. Backspace leaves the caret at the end of that sibling; Delete
 * leaves it where it showed, so nothing visible moves.
 *
 * Null when the caret's paragraph is laid out, or when no paragraph directly precedes it in
 * its container; the keys then act from the shown position. A body-level marker such as
 * `w:bookmarkStart` directly before it counts as no paragraph: a join needs adjacent siblings,
 * and the store refuses one across a marker.
 */
export function removedCaretParagraphEdit(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition,
  view: RevisionView,
  direction: 'backward' | 'forward'
): { readonly ops: TreeDocOp[]; readonly caret: SemanticPosition } | null {
  if (paragraphLinesFor(layout, position.paragraphId).length > 0) return null;
  const parent = parentNodeOf(part, position.paragraphId);
  if (parent === null) return null;
  if (!hiddenMarkRemovedIds(parent.children, view).has(position.paragraphId)) return null;
  const siblings = parent.children;
  const index = siblings.findIndex(
    (child) => child.kind !== 'textValue' && child.id === position.paragraphId
  );
  let previous: OoxmlNode | undefined;
  for (let at = index - 1; at >= 0 && previous === undefined; at -= 1) {
    if (siblings[at]!.kind !== 'textValue') previous = siblings[at];
  }
  if (previous === undefined || previous.kind !== 'paragraph') return null;
  const caret =
    direction === 'backward'
      ? { paragraphId: previous.id, offset: (paragraphTextOf(part, previous.id) ?? '').length }
      : shownPosition(layout, part, position, view);
  return {
    ops: [{ op: 'joinParagraphs', firstId: previous.id, secondId: position.paragraphId }],
    caret,
  };
}

/**
 * Delete at the end of a paragraph, when the join to the next laid-out paragraph cannot reach
 * it: absorb the run of removed paragraphs directly after it, and nothing else.
 *
 * Something that is not a removed paragraph (a body-level `w:bookmarkEnd`, a paragraph this
 * view merges away) sits between, and a join across it would be refused. The removed run
 * before it is still adjacent and shows nothing, so absorbing it is the edit Delete made when
 * those paragraphs were laid out as blank lines, with no visible change. Null when no removed
 * paragraph directly follows.
 */
export function absorbRemovedAfter(
  part: OoxmlPart,
  firstId: string,
  view: RevisionView
): TreeDocOp[] | null {
  const parent = parentNodeOf(part, firstId);
  if (parent === null) return null;
  const siblings = parent.children;
  const start = siblings.findIndex((child) => child.kind !== 'textValue' && child.id === firstId);
  if (start === -1) return null;
  let removed: ReadonlySet<string> | null = null;
  const ops: TreeDocOp[] = [];
  for (let index = start + 1; index < siblings.length; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue') continue;
    removed ??= hiddenMarkRemovedIds(siblings, view);
    if (!removed.has(child.id)) break;
    ops.push({ op: 'joinParagraphs', firstId, secondId: child.id });
  }
  return ops.length > 0 ? ops : null;
}

/**
 * Whether `ops` add a paragraph mark, or a table, inside field codes that hold paragraph marks
 * (see `layout/field-code-marks.ts`). The surface's journaled write asks this for every batch
 * (`surface-journaled-apply.ts`), so Enter, a section break, a table, and a table of contents
 * all refuse in one place; a rich paste asks {@link fieldCodePasteRefusal} before its package
 * transaction. The check reads the tree before the batch, where a collapsed caret's ops point.
 * An op that a batch moves after an earlier op, such as a split behind inserted text, is read
 * at its pre-batch offset. That can only miss a refusal, never refuse a write wrongly: the
 * offsets this refuses sit before the field codes in the pre-batch tree.
 */
export function opsAddFieldCodeMark(
  partOf: (paragraphId: string) => OoxmlPart | null,
  ops: readonly TreeDocOp[]
): boolean {
  const inside = (id: string, offset: number) => {
    const part = partOf(id);
    return part !== null && splitInsideFieldCodes(part, id, offset);
  };
  return ops.some((op) => {
    switch (op.op) {
      case 'splitParagraph':
        return inside(op.paragraphId, op.offset);
      case 'splitParagraphMany':
        return op.offsets.some((offset) => inside(op.paragraphId, offset));
      case 'insertFragment':
        // One paragraph's inline content adds no mark; anything more splits at the offset.
        return (
          (op.blocks.length > 1 || op.blocks.some((block) => block.kind !== 'paragraph')) &&
          inside(op.paragraphId, op.offset)
        );
      case 'insertTable':
      case 'insertToc': {
        const part = partOf(op.beforeParagraphId);
        return part !== null && blockBeforeInsideFieldCodes(part, op.beforeParagraphId);
      }
      default:
        return false;
    }
  });
}

/**
 * {@link FIELD_CODE_SPLIT_REFUSAL} when a rich paste at `position` could add a paragraph mark
 * inside field codes, else null. Its blocks are not known before the merge, so any paste at
 * such a position is refused; the plain text flavour then lands outside the field codes.
 */
export function fieldCodePasteRefusal(
  partOf: (paragraphId: string) => OoxmlPart | null,
  position: SemanticPosition
): string | null {
  const part = partOf(position.paragraphId);
  return part !== null && splitInsideFieldCodes(part, position.paragraphId, position.offset)
    ? FIELD_CODE_SPLIT_REFUSAL
    : null;
}

/**
 * The paragraph that opens the field when `paragraphId` is the result side of a field's shared
 * line, or null. A field-code merge has exactly these two members (a paragraph that closes one
 * field's codes never opens another merge), so the member drawn directly before is the first.
 */
function fieldCodeLineOpener(
  layout: SemanticLayout,
  part: OoxmlPart,
  paragraphId: string
): string | null {
  const before = mergedPredecessorsOf(layout, paragraphId);
  const opener = before.at(-1);
  return before.length === 1 && opener !== undefined && markIsFieldCode(part, opener)
    ? opener
    : null;
}

/**
 * Where an insert at `position` belongs when the position is the start of the result side of a
 * field's shared line (see `layout/field-code-paragraph-merge.ts`), or null anywhere else.
 *
 * That offset sits before the field codes that continue into the paragraph, so a split there
 * would add a paragraph mark inside the field instruction (ECMA-376 Part 1, 17.16.18) and the
 * page would not change. The end of the first side's text, before the field's `begin`, is
 * outside the field codes, so every insert there lands there instead, also when the result
 * side starts a wrapped line.
 */
export function fieldCodeInsertLanding(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition
): SemanticPosition | null {
  // The stored tree decides that the position is inside field codes; the merged line only
  // decides where the insert can go instead. With no merge, nothing redirects, and the
  // surface's one field-code check (`opsAddFieldCodeMark`) refuses the insert.
  if (position.offset !== 0 || !splitInsideFieldCodes(part, position.paragraphId, 0)) return null;
  const opener = fieldCodeLineOpener(layout, part, position.paragraphId);
  return opener === null
    ? null
    : { paragraphId: opener, offset: (paragraphTextOf(part, opener) ?? '').length };
}

/**
 * Where the caret shows for `position`: the {@link fieldCodeInsertLanding} while the result
 * side's start paints at the end of the first side (`layout/field-code-join-stop.ts`), where
 * the line has one caret stop. Null anywhere else, so a caret at the start of a wrapped result
 * line, or of a result that runs in the other direction, stays where it is.
 */
export function fieldCodeJoinStart(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition
): SemanticPosition | null {
  const landing = fieldCodeInsertLanding(layout, part, position);
  return landing && joinStartShared(layout, position.paragraphId) ? landing : null;
}

/**
 * Where an insert at `position` lands: past a deletion the caret rests in
 * (`positionPastDeletion`), after {@link fieldCodeInsertLanding} moves it out of the field codes.
 */
export function insertPointOf(
  layout: SemanticLayout,
  part: OoxmlPart,
  position: SemanticPosition
): SemanticPosition {
  return positionPastDeletion(layout, fieldCodeInsertLanding(layout, part, position) ?? position);
}

/** The editing surface's view of the rules above, over its live layout, story, and view. */
export function createHiddenMarkEditing(deps: {
  readonly layout: () => SemanticLayout;
  readonly part: () => OoxmlPart;
  readonly view: () => RevisionView;
}): {
  /** Ops joining two neighbours in paragraph order; see {@link joinAcrossHiddenMarks}. */
  joinOps(firstId: string, secondId: string): TreeDocOp[] | null;
  /**
   * Delete's join: {@link joinOps}, else {@link absorbRemovedAfter}. The ops Delete applies at the end of `firstId`, or `'step'` when only field-code paragraphs
   * stand between: the caret then steps over them, the mirror of Backspace at the field result.
   */
  forwardJoinOps(firstId: string, nextId: string): TreeDocOp[] | 'step' | null;
  /** See {@link shownPosition}. */
  shown(position: SemanticPosition): SemanticPosition;
  /** See {@link insertPointOf}: where an insert, or a format armed for it, lands. */
  insertPoint(position: SemanticPosition): SemanticPosition;
  /** Where a table or a table of contents at `position` goes: `blockAnchorOutsideFieldCodes`. */
  lineFirst(position: SemanticPosition): string;
  /** A collapsed selection moved to where it shows; a range is left alone. */
  shownSelection(selection: SemanticSelection): SemanticSelection;
  /** The same for an ordered range: moved only when it is collapsed. */
  shownRange(range: { from: SemanticPosition; to: SemanticPosition }): {
    from: SemanticPosition;
    to: SemanticPosition;
  };
  /** See {@link removedCaretParagraphEdit}. */
  removedCaretEdit(
    position: SemanticPosition,
    direction: 'backward' | 'forward'
  ): { readonly ops: TreeDocOp[]; readonly caret: SemanticPosition } | null;
} {
  const shown = (position: SemanticPosition): SemanticPosition =>
    shownPosition(deps.layout(), deps.part(), position, deps.view());
  return {
    joinOps: (firstId, secondId) =>
      joinAcrossHiddenMarks(deps.part(), firstId, secondId, deps.view()),
    forwardJoinOps: (firstId, nextId) =>
      joinAcrossHiddenMarks(deps.part(), firstId, nextId, deps.view()) ??
      absorbRemovedAfter(deps.part(), firstId, deps.view()) ??
      (onlyFieldCodeBetween(deps.part(), firstId, nextId, deps.view()) ? 'step' : null),
    shown,
    insertPoint: (position) => insertPointOf(deps.layout(), deps.part(), position),
    lineFirst: (position) => blockAnchorOutsideFieldCodes(deps.part(), position.paragraphId),
    removedCaretEdit: (position, direction) =>
      removedCaretParagraphEdit(deps.layout(), deps.part(), position, deps.view(), direction),
    shownRange: (range) => {
      const { from, to } = range;
      if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return range;
      const position = shown(from);
      return position === from ? range : { from: position, to: position };
    },
    shownSelection: (selection) => {
      const { anchor, head } = selection;
      if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) {
        return selection;
      }
      const position = shown(head);
      return position === head ? selection : { ...selection, anchor: position, head: position };
    },
  };
}

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
// the start of the paragraph that takes the join, and Backspace and Delete act from there.
// Typing still lands in the paragraph itself, which then shows again.

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
import { numberingFlowBlocks } from '../layout/hidden-paragraph-mark.ts';
import { paragraphLinesIndex } from '../layout/paragraph-lines.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import { mergedFlowBlocks } from '../layout/story-roots.ts';

/** The revision view the page is laid out in. */
export interface RevisionView {
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Ids of the paragraphs among `children` that layout removes under a hidden mark in `view`.
 *
 * Asks the same collector layout uses for that container, so the two cannot disagree.
 */
export function hiddenMarkRemovedIds(
  children: readonly OoxmlNode[],
  view: RevisionView
): ReadonlySet<string> {
  const flow = mergedFlowBlocks(children, view.displayMode, view.authorFilter);
  const all = numberingFlowBlocks(flow);
  if (all === flow) return NONE;
  const laidOut = new Set(flow.map((block) => block.id));
  return new Set(all.flatMap((block) => (laidOut.has(block.id) ? [] : [block.id])));
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
  if (paragraphLinesIndex(layout).has(position.paragraphId)) return position;
  const parent = parentNodeOf(part, position.paragraphId);
  if (parent === null) return position;
  const removed = hiddenMarkRemovedIds(parent.children, view);
  if (!removed.has(position.paragraphId)) return position;
  const siblings = parent.children;
  const start = siblings.findIndex(
    (child) => child.kind !== 'textValue' && child.id === position.paragraphId
  );
  for (let index = start + 1; index < siblings.length; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue' || removed.has(child.id)) continue;
    return child.kind === 'paragraph' ? { paragraphId: child.id, offset: 0 } : position;
  }
  return position;
}

/** The editing surface's view of the rules above, over its live layout, story, and view. */
export function createHiddenMarkEditing(deps: {
  readonly layout: () => SemanticLayout;
  readonly part: () => OoxmlPart;
  readonly view: () => RevisionView;
}): {
  /** Ops joining two neighbours in paragraph order; see {@link joinAcrossHiddenMarks}. */
  joinOps(firstId: string, secondId: string): TreeDocOp[] | null;
  /** See {@link shownPosition}. */
  shown(position: SemanticPosition): SemanticPosition;
  /** A collapsed selection moved to where it shows; a range is left alone. */
  shownSelection(selection: SemanticSelection): SemanticSelection;
} {
  const shown = (position: SemanticPosition): SemanticPosition =>
    shownPosition(deps.layout(), deps.part(), position, deps.view());
  return {
    joinOps: (firstId, secondId) =>
      joinAcrossHiddenMarks(deps.part(), firstId, secondId, deps.view()),
    shown,
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

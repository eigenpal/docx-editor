// Joining two paragraphs the reader sees as neighbours when the tree holds, between them,
// paragraphs a hidden mark removed from the flow (see `layout/hidden-paragraph-mark.ts`).
//
// Those paragraphs show nothing, so Backspace or Delete at the visible break means "join the
// two paragraphs on either side". A `joinParagraphs` of just those two is refused
// (`not-adjacent-siblings`), because joins need true child-index adjacency. The join instead
// absorbs each removed paragraph into the first paragraph on the way. The first paragraph
// keeps its properties, and any directly hidden runs a removed paragraph holds move with it
// and stay hidden, so nothing the reader can see changes except the break they deleted.

import {
  parentNodeOf,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { hiddenMarkParagraphAlwaysRemoved } from '../layout/hidden-paragraph-mark.ts';

/**
 * Ids of the removed paragraphs between two siblings, in order: `[]` when the two are
 * adjacent, `null` when anything else lies between them or they are not in that order.
 */
export function hiddenParagraphsBetween(
  siblings: readonly OoxmlNode[],
  firstId: string,
  secondId: string
): string[] | null {
  const indexOf = (id: string): number =>
    siblings.findIndex((child) => child.kind !== 'textValue' && child.id === id);
  const first = indexOf(firstId);
  const second = indexOf(secondId);
  if (first === -1 || second <= first) return null;
  const between: string[] = [];
  for (let index = first + 1; index < second; index += 1) {
    const child = siblings[index]!;
    if (child.kind === 'textValue' || !hiddenMarkParagraphAlwaysRemoved(child)) return null;
    between.push(child.id);
  }
  return between;
}

/**
 * The ops that join `secondId` onto `firstId`, absorbing any removed paragraphs between them
 * first, or `null` when the two are not siblings that such a join can reach.
 */
export function joinAcrossHiddenMarks(
  part: OoxmlPart,
  firstId: string,
  secondId: string
): TreeDocOp[] | null {
  const parent = parentNodeOf(part, firstId);
  if (parent === null || parentNodeOf(part, secondId)?.id !== parent.id) return null;
  const between = hiddenParagraphsBetween(parent.children, firstId, secondId);
  if (between === null) return null;
  return [...between, secondId].map((id) => ({ op: 'joinParagraphs', firstId, secondId: id }));
}

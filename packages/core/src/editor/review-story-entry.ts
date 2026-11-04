// Moving to a position inside a text box opens that box.
//
// A change or a match inside a text box has its range in the box's own paragraph. A caret put
// there without opening the box typed into it while the box stayed closed: no frame, and the
// toolbar read the formatting of the story behind it. In a header, the open header clamped the
// caret to its own first paragraph instead. The box opens first, as a press on its text does.

import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import type { ViewScope } from '../contracts/editor.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

type FrameScope = Extract<ViewScope, { kind: 'frame' }>;

/** Nested boxes and the containers between them stay well within this. */
const MAX_ANCESTORS = 256;

/** The frame scope of the innermost text box in `part` holding `paragraphId`, or null. */
export function textboxScopeOfParagraph(part: OoxmlPart, paragraphId: string): FrameScope | null {
  const stories = textboxStoriesInPart(part);
  if (stories.length === 0 || !findNode(part, paragraphId)) return null;
  let ancestor = parentNodeOf(part, paragraphId);
  for (let depth = 0; ancestor && depth < MAX_ANCESTORS; depth += 1) {
    const id = ancestor.id;
    const story = stories.find((candidate) => candidate.root.id === id);
    if (story)
      return {
        kind: 'frame',
        id: story.root.id,
        drawingNodeId: story.drawingNodeId,
        hostParagraphId: story.hostParagraphId,
      };
    ancestor = parentNodeOf(part, id);
  }
  return null;
}

/**
 * Open the text box holding `position`, if any, and put the caret at `position` in it. `rId`
 * names the header or footer the box sits in. A box that cannot take a caret, or a document
 * open for viewing, leaves the caret where it is.
 */
export function openTextboxAt(
  surface: PaginatedSurface,
  position: SemanticPosition,
  rId?: string
): void {
  const part = partOfNodeId(surface.session, position.paragraphId);
  const scope = part && textboxScopeOfParagraph(part, position.paragraphId);
  if (!scope) return;
  if (!surface.setActiveScope(rId ? { ...scope, owner: { kind: 'headerFooter', rId } } : scope))
    return;
  surface.setSelection({ anchor: position, head: position });
}

/**
 * Leave a note or header the caret sits in from a previous card, and open the body text box
 * the card's change sits in, if any.
 */
export function openBodyStoryOf(surface: PaginatedSurface, position: SemanticPosition): void {
  surface.exitNote?.();
  surface.exitHeaderFooter?.();
  openTextboxAt(surface, position);
}

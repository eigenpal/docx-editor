// The content control a selection is IN, for the chrome's active state.
//
// A caret answers with one point. A range that selects a prompt whole runs from the
// control's start to its end, and the head's point sits on the control's outer edge, just
// outside the fragment the hit test consults — so the control that was clearly just clicked
// read as "no control at the caret", its chrome went dark, and its button hid. The range's
// ends are probed a hair inside the selection instead, so a selected prompt keeps its control
// active. Its own module because the surface sits at its line cap.

import type { SemanticLayout, ContentControlBoundaryRecord } from '../layout/semantic-records.ts';
import type { SemanticSelection, SemanticPosition } from '../layout/semantic-interaction.ts';
import { caretAt, contentControlAtSemantic } from '../layout/semantic-interaction.ts';
import type { TextMeasurer } from '../layout/semantic-records.ts';

/** A quarter point inside the fragment edge: enough to be inside, too small to cross a glyph. */
const INSIDE = 0.25;

export function contentControlAtSelection(
  layout: SemanticLayout,
  selection: SemanticSelection,
  measurer: TextMeasurer
): ContentControlBoundaryRecord | null {
  const probe = (position: SemanticPosition, shiftX: number) => {
    const caret = caretAt(layout, position, measurer);
    if (!caret) return null;
    return contentControlAtSemantic(layout, {
      x: caret.x + shiftX,
      y: caret.y + caret.height / 2,
      pageIndex: caret.pageIndex,
    });
  };
  const atHead = probe(selection.head, 0);
  if (atHead) return atHead;
  const collapsed =
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset;
  // A caret on a control's trailing edge is still IN the control, as Word's is: typing there
  // continues the field, and ArrowRight is what leaves it. The edge itself hit-tests outside,
  // so the caret is probed a hair to its left before it counts as beside the control.
  if (collapsed) return probe(selection.head, -INSIDE);
  const headFirst =
    selection.head.paragraphId === selection.anchor.paragraphId &&
    selection.head.offset < selection.anchor.offset;
  // The end of the range sits on the control's outer edge; step inward from both ends.
  return (
    probe(selection.head, headFirst ? INSIDE : -INSIDE) ??
    probe(selection.anchor, headFirst ? -INSIDE : INSIDE)
  );
}

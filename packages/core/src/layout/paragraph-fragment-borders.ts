// The border rules one placed paragraph fragment draws, and the box they close.

import { paragraphBorderStrokeWidthPt } from './paragraph-style.ts';
import type { ParagraphBorderEdge, ParagraphBorders } from './paragraph-style.ts';
import type {
  LayoutBox,
  ParagraphBorderStrokeRecord,
  ParagraphBottomBorderRecord,
} from './semantic-records.ts';

export interface ParagraphFragmentBorderInput {
  readonly borders: ParagraphBorders;
  /** The top rule, or undefined when the paragraph continues a border group above. */
  readonly topEdge: ParagraphBorderEdge | undefined;
  /** The bottom rule, or the `between` rule when the group continues below. */
  readonly closingEdge: ParagraphBorderEdge | undefined;
  readonly continuesAbove: boolean;
  readonly continuesBelow: boolean;
  readonly inFrame: boolean;
  readonly isLast: boolean;
  readonly fragmentIndex: number;
  /** Top rule and gap reserved above this fragment's first line (0 on continuations). */
  readonly topExtent: number;
  readonly appliedAfter: number;
  /** Fragment top: the first line's top less space before and the top rule. */
  readonly top: number;
  readonly linesTop: number;
  readonly linesBottom: number;
  readonly regionX: number;
  readonly indentLeft: number;
  readonly available: number;
  /**
   * False for a fragment that paints no rule at all. The empty line in front of a leading
   * page break is one: its paragraph's rules frame the text after the break.
   */
  readonly drawn: boolean;
}

export interface ParagraphFragmentBorders {
  readonly strokes: ParagraphBorderStrokeRecord[];
  readonly bottomBorder: ParagraphBottomBorderRecord | undefined;
  readonly contentTop: number;
  readonly contentBottom: number;
  readonly boxLeft: number;
  readonly boxWidth: number;
  /** Where the flow continues after the fragment: below its closing rule and space after. */
  readonly bottom: number;
  readonly height: number;
}

export function paragraphFragmentBorders(
  input: ParagraphFragmentBorderInput
): ParagraphFragmentBorders {
  const { topEdge, closingEdge, continuesAbove, continuesBelow, isLast, top } = input;
  const { linesTop, linesBottom, regionX, indentLeft, available, appliedAfter } = input;
  const borders: ParagraphBorders = input.drawn ? input.borders : {};
  const strokes: ParagraphBorderStrokeRecord[] = [];
  let bottomBorder: ParagraphBottomBorderRecord | undefined;
  let contentTop = linesTop;
  let contentBottom = linesBottom;
  // THE FOUR EDGES ARE ONE BOX. The side rules sit outside the text column by their own
  // `w:space`, so a top rule drawn only across the column stops short of them and the
  // frame reads as two horizontal rules with two detached vertical bars beside it —
  // which is what a callout looked like. Word closes the rectangle, so the horizontal
  // rules span from the left rule's outer edge to the right rule's.
  // Stroke thickness uses the inflated compound band for `double`/etc. so thin authored
  // doubles still publish a box paint can draw as two lines (shared with table borders).
  // The fill box keeps the frame's width even when this fragment draws no rule.
  const frame = input.borders;
  const leftStroke = frame.left ? paragraphBorderStrokeWidthPt(frame.left) : 0;
  const rightStroke = frame.right ? paragraphBorderStrokeWidthPt(frame.right) : 0;
  const boxLeft = frame.left
    ? regionX + indentLeft - frame.left.spacePt - leftStroke
    : regionX + indentLeft;
  const boxRight = frame.right
    ? regionX + indentLeft + available + frame.right.spacePt + rightStroke
    : regionX + indentLeft + available;
  const boxWidth = Math.max(boxRight - boxLeft, 0);
  if (input.drawn && input.topExtent > 0 && topEdge) {
    const topStroke = paragraphBorderStrokeWidthPt(topEdge);
    const ruleY = linesTop - topEdge.spacePt - topStroke;
    strokes.push({
      side: 'top',
      edge: topEdge,
      box: { x: boxLeft, y: ruleY, width: boxWidth, height: topStroke },
    });
    contentTop = ruleY;
  }
  // Inside a text frame the paragraph's space after lies INSIDE the frame, above its
  // bottom edge, and Word draws a bottom border at that edge: below the spacing, not
  // below the text. A contents heading framed with `w:after="2200"` and a bottom rule
  // shows its rule 110pt under the heading, just above the entries. A free paragraph
  // keeps the rule under its text and its space after below the rule.
  const drawnClosing = input.drawn ? closingEdge : undefined;
  const afterInsideBorder = input.inFrame && drawnClosing && !continuesBelow ? appliedAfter : 0;
  if (isLast && drawnClosing) {
    const closeStroke = paragraphBorderStrokeWidthPt(drawnClosing);
    const ruleY = linesBottom + afterInsideBorder + drawnClosing.spacePt;
    const box = { x: boxLeft, y: ruleY, width: boxWidth, height: closeStroke };
    strokes.push({ side: continuesBelow ? 'between' : 'bottom', edge: drawnClosing, box });
    // `bottomBorder` stays the BOTTOM rule alone: a `between` rule closing a grouped
    // paragraph is a different edge, and a consumer reading it as the box's bottom would
    // draw the block's frame at every interior boundary.
    if (!continuesBelow) bottomBorder = { edge: drawnClosing, box };
    contentBottom = ruleY + closeStroke;
  }
  const afterBelowBorder = appliedAfter - afterInsideBorder;
  const height = Math.max(contentBottom + afterBelowBorder - top, 0);
  // Side rules run the height of the bordered block, and inside a group they run THROUGH
  // the inter-paragraph gap so the box reads as one outline rather than a ladder.
  const sideTop = continuesAbove && input.fragmentIndex === 0 ? top : contentTop;
  const sideBottom = continuesBelow && isLast ? top + height : contentBottom;
  const sideHeight = Math.max(sideBottom - sideTop, 0);
  const sideBox = (x: number, width: number): LayoutBox => ({
    x,
    y: sideTop,
    width,
    height: sideHeight,
  });
  if (borders.left) {
    strokes.push({ side: 'left', edge: borders.left, box: sideBox(boxLeft, leftStroke) });
  }
  if (borders.right) {
    const x = regionX + indentLeft + available + borders.right.spacePt;
    strokes.push({ side: 'right', edge: borders.right, box: sideBox(x, rightStroke) });
  }
  // `w:bar` is the change-bar rule beside the paragraph. It belongs to the paragraph, not
  // to the block, so it neither opens nor closes with the group.
  if (borders.bar) {
    const barStroke = paragraphBorderStrokeWidthPt(borders.bar);
    strokes.push({
      side: 'bar',
      edge: borders.bar,
      box: {
        x: regionX + indentLeft - borders.bar.spacePt - barStroke,
        y: linesTop,
        width: barStroke,
        height: Math.max(linesBottom - linesTop, 0),
      },
    });
  }
  return {
    strokes,
    bottomBorder,
    contentTop,
    contentBottom,
    boxLeft,
    boxWidth,
    bottom: contentBottom + afterBelowBorder,
    height,
  };
}

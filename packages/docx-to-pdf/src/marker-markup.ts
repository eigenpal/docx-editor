/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LayoutBox, SemanticSpanVisit } from '@docx-editor.dev/core/layout';

/**
 * The revisions a list number shows. The number belongs to the paragraph mark, so it shows the
 * mark's insertion or deletion; a formatting change to the mark leaves it unmarked.
 */
export function markerRevisions(visit: SemanticSpanVisit) {
  const revisions = visit.paragraph.markRevisions?.filter(({ kind }) => kind !== 'format');
  return revisions?.length ? revisions : undefined;
}

/**
 * Where a list number paints, in absolute points. When the number shows a revision, its marks
 * run on across the gap after it, up to the paragraph's text, since that gap belongs to the
 * number. Only a number in one piece runs on: a right-to-left number comes in visual pieces.
 */
export function markerMarkBox(
  visit: SemanticSpanVisit,
  box: LayoutBox,
  single: boolean
): LayoutBox {
  const x = box.x + visit.storyOrigin.x;
  const placed = { ...box, x, y: box.y + visit.storyOrigin.y };
  if (!single || !markerRevisions(visit)) return placed;
  const gap = visit.absoluteBox.x - (x + box.width);
  return gap > 0 ? { ...placed, width: box.width + gap } : placed;
}

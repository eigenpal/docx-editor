// Text projections for automation reads and searches.
//
// Model offsets always include every addressable segment. A projection can show text that the
// model does not address one-for-one. Every visible match still maps to one editable model range.

import type { AutomationTextProjection } from './operations.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import {
  identityProjection,
  projectionFromPieces,
  visibleParagraphPieces,
  type ProjectedParagraphText,
  type VisiblePiece,
} from '../store/store/text-projection.ts';

export {
  identityProjection,
  projectionFromPieces,
  projectVisibleParagraphText,
  visibleParagraphPieces,
  type ProjectedParagraphText,
  type VisiblePiece,
} from '../store/store/text-projection.ts';

interface RawSpan {
  readonly start: number;
  readonly end: number;
}

function clippedIdentityPiece(
  piece: VisiblePiece,
  start: number,
  end: number
): VisiblePiece | null {
  if (start >= end) return null;
  return {
    text: piece.text.slice(start - piece.rawStart, end - piece.rawStart),
    rawStart: start,
    rawEnd: end,
  };
}

function hideFromPiece(piece: VisiblePiece, hidden: readonly RawSpan[]): VisiblePiece[] {
  const rawLength = piece.rawEnd - piece.rawStart;
  if (piece.text.length !== rawLength) {
    // Whole-atom revision wrappers are hidden here. Insertions inside a field result are
    // removed while its cached result text is built.
    const covered = hidden.some((span) => span.start < piece.rawEnd && span.end > piece.rawStart);
    return covered ? [] : [piece];
  }

  const shown: VisiblePiece[] = [];
  let cursor = piece.rawStart;
  for (const span of hidden) {
    if (span.end <= cursor) continue;
    if (span.start >= piece.rawEnd) break;
    const visible = clippedIdentityPiece(piece, cursor, Math.min(span.start, piece.rawEnd));
    if (visible) shown.push(visible);
    cursor = Math.max(cursor, span.end);
    if (cursor >= piece.rawEnd) break;
  }
  const tail = clippedIdentityPiece(piece, cursor, piece.rawEnd);
  if (tail) shown.push(tail);
  return shown;
}

/** Build the projection once for one immutable paragraph node. */
export function projectParagraphText(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  projection: AutomationTextProjection
): ProjectedParagraphText {
  if (projection === 'model') return identityProjection(rawText);
  const base = visibleParagraphPieces(paragraph, rawText, projection);
  if (projection === 'allMarkup') return projectionFromPieces(base);

  const hidden = hiddenInsertionSpans(paragraph);
  if (hidden.length === 0) return projectionFromPieces(base);
  const pieces: VisiblePiece[] = [];
  for (const piece of base) {
    for (const visible of hideFromPiece(piece, hidden)) pieces.push(visible);
  }
  return projectionFromPieces(pieces);
}

/** Pending insertions and move destinations are absent from Word's Original review view. */
function hiddenInsertionSpans(paragraph: OoxmlParagraphNode): readonly RawSpan[] {
  const index = paragraphOffsetIndex(paragraph);
  const found: RawSpan[] = [];
  const visit = (node: OoxmlNode, depth: number): void => {
    if (depth > 64 || node.kind === 'textValue') return;
    if (node.kind === 'revisionInsert' || node.kind === 'revisionMoveTo') {
      const span = index.spanOf(node);
      if (span && span.end > span.start) found.push({ start: span.start, end: span.end });
      return;
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(paragraph, 0);
  found.sort((left, right) => left.start - right.start || right.end - left.end);

  const merged: { start: number; end: number }[] = [];
  for (const span of found) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

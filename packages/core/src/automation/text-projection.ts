// Text projections for automation reads and searches.
//
// Model offsets always include every addressable segment. A projection can hide text from a
// caller, but it must map every visible match back to that same model-offset space. Otherwise a
// search can return words that its range cannot read, select, or edit.

import type { AutomationTextProjection } from './operations.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

interface VisiblePiece {
  readonly projectedStart: number;
  readonly projectedEnd: number;
  readonly rawStart: number;
  readonly rawEnd: number;
}

/** One paragraph under a chosen text projection, with lossless links to model offsets. */
export interface ProjectedParagraphText {
  readonly text: string;
  /** Map one model boundary into the projected UTF-16 offset space. */
  projectedOffset(rawOffset: number): number;
  /** Map a non-empty projected range back to one editable model range. */
  rawRange(
    start: number,
    end: number
  ): {
    readonly start: number;
    readonly end: number;
  } | null;
  /** Read a model range through this projection. */
  sliceRaw(start: number, end: number): string;
}

/** Build the projection once for one immutable paragraph node. */
export function projectParagraphText(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  projection: AutomationTextProjection
): ProjectedParagraphText {
  if (projection === 'allMarkup') return identityProjection(rawText);

  const hidden = hiddenInsertionSpans(paragraph);
  if (hidden.length === 0) return identityProjection(rawText);

  const pieces: VisiblePiece[] = [];
  const text: string[] = [];
  let raw = 0;
  let projected = 0;
  for (const span of hidden) {
    if (raw < span.start) {
      const value = rawText.slice(raw, span.start);
      pieces.push({
        projectedStart: projected,
        projectedEnd: projected + value.length,
        rawStart: raw,
        rawEnd: span.start,
      });
      text.push(value);
      projected += value.length;
    }
    raw = Math.max(raw, span.end);
  }
  if (raw < rawText.length) {
    const value = rawText.slice(raw);
    pieces.push({
      projectedStart: projected,
      projectedEnd: projected + value.length,
      rawStart: raw,
      rawEnd: rawText.length,
    });
    text.push(value);
  }

  return projectionFromPieces(text.join(''), pieces);
}

function identityProjection(text: string): ProjectedParagraphText {
  return projectionFromPieces(
    text,
    text.length === 0
      ? []
      : [{ projectedStart: 0, projectedEnd: text.length, rawStart: 0, rawEnd: text.length }]
  );
}

function projectionFromPieces(
  text: string,
  pieces: readonly VisiblePiece[]
): ProjectedParagraphText {
  return {
    text,
    projectedOffset(rawOffset) {
      let offset = 0;
      for (const piece of pieces) {
        if (rawOffset <= piece.rawStart) return offset;
        offset += Math.max(0, Math.min(rawOffset, piece.rawEnd) - piece.rawStart);
        if (rawOffset <= piece.rawEnd) return offset;
      }
      return offset;
    },
    rawRange(start, end) {
      const first = pieces.find(
        (piece) => start >= piece.projectedStart && start < piece.projectedEnd
      );
      const last = pieces.find((piece) => end > piece.projectedStart && end <= piece.projectedEnd);
      if (!first || !last || start >= end) return null;
      return {
        start: first.rawStart + start - first.projectedStart,
        end: last.rawStart + end - last.projectedStart,
      };
    },
    sliceRaw(start, end) {
      if (start >= end) return '';
      return pieces
        .map((piece) => {
          const from = Math.max(start, piece.rawStart);
          const to = Math.min(end, piece.rawEnd);
          return from < to
            ? text.slice(
                piece.projectedStart + from - piece.rawStart,
                piece.projectedStart + to - piece.rawStart
              )
            : '';
        })
        .join('');
    },
  };
}

/** Pending insertions and move destinations are absent from Word's Original review view. */
function hiddenInsertionSpans(
  paragraph: OoxmlParagraphNode
): readonly { readonly start: number; readonly end: number }[] {
  const index = paragraphOffsetIndex(paragraph);
  const found: { start: number; end: number }[] = [];
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

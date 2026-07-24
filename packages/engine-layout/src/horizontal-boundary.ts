// Semantic whole-grapheme horizontal boundaries vs geometry-trusted caret edges (task 5.5).

import type { MetricsPort } from './metrics.ts';
import { segmentGraphemes } from './grapheme.ts';

function graphemeAtIndex(fullText: string, graphemeIndex: number): string {
  return segmentGraphemes(fullText)[graphemeIndex]?.text ?? '';
}

function graphemeAdvanceProvable(metrics: MetricsPort, grapheme: string): boolean {
  if (grapheme.length === 0) return true;
  const prove = metrics.provesCharacterAdvance;
  if (!prove) return metrics.shaping.caretEdges === 'per-grapheme-advance';
  for (const unit of grapheme) {
    if (!prove(unit)) return false;
  }
  return true;
}

function caretEdgeGeometryTrusted(
  metrics: MetricsPort,
  fullText: string,
  graphemeOffset: number,
  paragraphGraphemeCount: number,
): boolean {
  if (metrics.shaping.caretEdges !== 'per-grapheme-advance') return false;
  if (graphemeOffset === 0 || graphemeOffset === paragraphGraphemeCount) return true;
  if (metrics.shaping.ligatures === 'disabled-per-grapheme') {
    const left = graphemeAtIndex(fullText, graphemeOffset - 1);
    const right = graphemeAtIndex(fullText, graphemeOffset);
    return graphemeAdvanceProvable(metrics, left) && graphemeAdvanceProvable(metrics, right);
  }
  const interior = metrics.ligatureInteriorCaret;
  if (!interior) return false;
  return !interior(fullText, graphemeOffset);
}

function opaqueLigatureInterior(metrics: MetricsPort, fullText: string, graphemeOffset: number): boolean {
  if (metrics.shaping.ligatures !== 'opaque') return false;
  const interior = metrics.ligatureInteriorCaret;
  return interior?.(fullText, graphemeOffset) === true;
}

/**
 * Whole-grapheme boundary allowed for horizontal semantic keyboard transitions.
 * Differs from geometry trust: emoji/combining boundaries may succeed logically
 * even when exact caret-edge x is unavailable.
 */
export function isWholeGraphemeHorizontalBoundary(
  metrics: MetricsPort,
  fullText: string,
  graphemeOffset: number,
): boolean {
  const paragraphGraphemeCount = segmentGraphemes(fullText).length;
  if (graphemeOffset === 0 || graphemeOffset === paragraphGraphemeCount) return true;
  if (opaqueLigatureInterior(metrics, fullText, graphemeOffset)) return false;
  return true;
}

/** Layout-published caret edge is geometry-trusted for vertical/page/caret overlay. */
export function isGeometryTrustedCaretOffset(
  metrics: MetricsPort,
  fullText: string,
  graphemeOffset: number,
): boolean {
  const paragraphGraphemeCount = segmentGraphemes(fullText).length;
  return caretEdgeGeometryTrusted(metrics, fullText, graphemeOffset, paragraphGraphemeCount);
}

/**
 * Cumulative geometry trust from a known line origin: every grapheme advance from
 * `lineStartGraphemeOffset` up to (but not including) `graphemeOffset` must be provable.
 * Unsupported emoji/non-ASCII advances poison the endpoint and subsequent edges on the line.
 * Line-origin edges are always trusted; opaque ligature interiors remain excluded.
 */
export function isCumulativeGeometryTrustedFromLineOrigin(
  metrics: MetricsPort,
  fullText: string,
  lineStartGraphemeOffset: number,
  graphemeOffset: number,
): boolean {
  if (metrics.shaping.caretEdges !== 'per-grapheme-advance') return false;
  if (graphemeOffset < lineStartGraphemeOffset) return false;
  if (graphemeOffset === lineStartGraphemeOffset) return true;
  if (opaqueLigatureInterior(metrics, fullText, graphemeOffset)) return false;
  for (let g = lineStartGraphemeOffset; g < graphemeOffset; g += 1) {
    if (!graphemeAdvanceProvable(metrics, graphemeAtIndex(fullText, g))) return false;
  }
  return true;
}

/** Sorted semantic horizontal transition offsets for one paragraph (0 and count always included). */
export function semanticHorizontalBoundaries(metrics: MetricsPort, fullText: string): readonly number[] {
  const count = segmentGraphemes(fullText).length;
  const out = new Set<number>([0, count]);
  for (let offset = 1; offset < count; offset += 1) {
    if (isWholeGraphemeHorizontalBoundary(metrics, fullText, offset)) out.add(offset);
  }
  return [...out].sort((a, b) => a - b);
}

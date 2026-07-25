// Semantic whole-grapheme horizontal boundaries vs geometry-trusted caret edges (task 5.5).

import type { MetricsPort } from './metrics.ts';
import { segmentGraphemes } from './grapheme.ts';

/** Single-entry memo so a per-character probe does not re-segment the paragraph. */
let segText: string | null = null;
let segCache: readonly { readonly text: string }[] | null = null;

function segmentsOf(fullText: string): readonly { readonly text: string }[] {
  if (segText === fullText && segCache) return segCache;
  segCache = segmentGraphemes(fullText);
  segText = fullText;
  return segCache;
}

function graphemeAtIndex(fullText: string, graphemeIndex: number): string {
  return segmentsOf(fullText)[graphemeIndex]?.text ?? '';
}

function graphemeCountOf(fullText: string): number {
  return segmentsOf(fullText).length;
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
  const paragraphGraphemeCount = graphemeCountOf(fullText);
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
  const paragraphGraphemeCount = graphemeCountOf(fullText);
  return caretEdgeGeometryTrusted(metrics, fullText, graphemeOffset, paragraphGraphemeCount);
}

/**
 * Cumulative geometry trust from a known line origin: every grapheme advance from
 * `lineStartGraphemeOffset` up to (but not including) `graphemeOffset` must be provable.
 * Unsupported emoji/non-ASCII advances poison the endpoint and subsequent edges on the line.
 * Line-origin edges are always trusted; opaque ligature interiors remain excluded.
 */
/**
 * Incremental prefix scan for the cumulative-trust probe.
 *
 * "Every grapheme from the line origin to here has a provable advance" is a
 * MONOTONIC prefix property, but this used to re-verify the whole prefix on every
 * call — and paragraph layout calls it once per caret edge, i.e. once per
 * character. That made layout quadratic independently of segmentation cost:
 * independent review measured a single 20,000-character paragraph, in a ~20 KB
 * .docx with no capsule and no crafted markup, freezing the main thread for 117
 * seconds on open (600 chars 132 ms, 2,400 chars 1.85 s, 10,000 chars 29.1 s).
 *
 * The hot loop asks for a fixed line origin with a non-decreasing offset, so one
 * cached watermark answers each query in O(1) amortized and the prefix is never
 * re-walked. A single entry, because the key includes a file-derived string of
 * unbounded size.
 */
let trustText: string | null = null;
let trustLineStart = -1;
let trustCheckedUpTo = -1;
let trustFirstUnprovable: number | null = null;

function prefixProvableUpTo(metrics: MetricsPort, fullText: string, lineStart: number, upTo: number): boolean {
  if (trustText !== fullText || trustLineStart !== lineStart || trustCheckedUpTo > upTo) {
    trustText = fullText;
    trustLineStart = lineStart;
    trustCheckedUpTo = lineStart;
    trustFirstUnprovable = null;
  }
  if (trustFirstUnprovable !== null) return trustFirstUnprovable >= upTo;
  for (let g = trustCheckedUpTo; g < upTo; g += 1) {
    if (!graphemeAdvanceProvable(metrics, graphemeAtIndex(fullText, g))) {
      trustFirstUnprovable = g;
      trustCheckedUpTo = g + 1;
      return g >= upTo;
    }
  }
  trustCheckedUpTo = Math.max(trustCheckedUpTo, upTo);
  return true;
}

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
  return prefixProvableUpTo(metrics, fullText, lineStartGraphemeOffset, graphemeOffset);
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

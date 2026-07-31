import { segmentGraphemes } from './grapheme.ts';
import type { ShapedRun } from './shaped-run.ts';

/** UTF-16 boundaries that are both whole-grapheme and HarfBuzz cluster edges. */
export function shapedHorizontalBoundaries(run: ShapedRun): readonly number[] {
  const grapheme = new Set<number>([0, run.text.length]);
  for (const segment of segmentGraphemes(run.text)) {
    grapheme.add(segment.utf16From);
    grapheme.add(segment.utf16To);
  }
  const clusters = new Set<number>([0, run.text.length]);
  for (const cluster of run.clusters) {
    clusters.add(cluster.textStart);
    clusters.add(cluster.textEnd);
  }
  return [...grapheme].filter((offset) => clusters.has(offset)).sort((left, right) => left - right);
}

export function isWholeGraphemeHorizontalBoundary(run: ShapedRun, utf16Offset: number): boolean {
  return shapedHorizontalBoundaries(run).includes(utf16Offset);
}

/** Every published shaped boundary has exact geometry from the shaping result. */
export function isGeometryTrustedCaretOffset(run: ShapedRun, utf16Offset: number): boolean {
  return isWholeGraphemeHorizontalBoundary(run, utf16Offset);
}

export function isCumulativeGeometryTrustedFromLineOrigin(
  run: ShapedRun,
  lineStartUtf16Offset: number,
  utf16Offset: number
): boolean {
  return (
    utf16Offset >= lineStartUtf16Offset &&
    isWholeGraphemeHorizontalBoundary(run, lineStartUtf16Offset) &&
    isWholeGraphemeHorizontalBoundary(run, utf16Offset)
  );
}

/** Grapheme offsets corresponding to exact shaped boundaries. */
export function semanticHorizontalBoundaries(run: ShapedRun): readonly number[] {
  const segments = segmentGraphemes(run.text);
  return shapedHorizontalBoundaries(run).map((utf16Offset) => {
    if (utf16Offset === run.text.length) return segments.length;
    return segments.findIndex((segment) => segment.utf16From === utf16Offset);
  });
}

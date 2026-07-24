// Unicode grapheme segmentation for semantic positions (interactive-paginated-editing 3.3).
// Uses Intl.Segmenter through a small replaceable boundary — no hand-written splitter.

export interface GraphemeSegment {
  readonly index: number;
  readonly text: string;
  readonly utf16From: number;
  readonly utf16To: number;
}

export interface GraphemeBoundary {
  segment(text: string): readonly GraphemeSegment[];
}

/** Invariant locale for deterministic cross-runtime grapheme boundaries. */
export const GRAPHEME_SEGMENTER_LOCALE = 'und' as const;

type IntlSegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string; index: number }> };

export function isIntlSegmenterAvailable(): boolean {
  return typeof (Intl as unknown as { Segmenter?: IntlSegmenterCtor }).Segmenter === 'function';
}

function requireIntlSegmenter(): IntlSegmenterCtor {
  const Seg = (Intl as unknown as { Segmenter?: IntlSegmenterCtor }).Segmenter;
  if (typeof Seg !== 'function') {
    throw new Error(
      `Intl.Segmenter is required for deterministic grapheme segmentation (locale: ${GRAPHEME_SEGMENTER_LOCALE})`,
    );
  }
  return Seg;
}

function createIntlBoundary(): GraphemeBoundary {
  const segmenter = new (requireIntlSegmenter())(GRAPHEME_SEGMENTER_LOCALE, { granularity: 'grapheme' });
  return {
    segment(text: string): readonly GraphemeSegment[] {
      const out: GraphemeSegment[] = [];
      let index = 0;
      for (const part of segmenter.segment(text)) {
        const utf16From = part.index;
        const utf16To = utf16From + part.segment.length;
        out.push({ index, text: part.segment, utf16From, utf16To });
        index += 1;
      }
      return out;
    },
  };
}

export const intlGraphemeBoundary: GraphemeBoundary = createIntlBoundary();

let activeBoundary: GraphemeBoundary = intlGraphemeBoundary;

/** Test hook: replace the grapheme boundary without changing call sites. */
export function setGraphemeBoundary(boundary: GraphemeBoundary): void {
  activeBoundary = boundary;
}

export function resetGraphemeBoundary(): void {
  activeBoundary = intlGraphemeBoundary;
}

export function segmentGraphemes(text: string): readonly GraphemeSegment[] {
  return activeBoundary.segment(text);
}

export function graphemeCount(text: string): number {
  return segmentGraphemes(text).length;
}

export function utf16OffsetToGrapheme(text: string, utf16Offset: number): number {
  const clamped = Math.max(0, Math.min(utf16Offset, text.length));
  for (const seg of segmentGraphemes(text)) {
    if (clamped <= seg.utf16From) return seg.index;
    if (clamped < seg.utf16To) return seg.index;
  }
  return graphemeCount(text);
}

export function graphemeOffsetToUtf16(text: string, graphemeOffset: number): number {
  const segments = segmentGraphemes(text);
  if (segments.length === 0) return 0;
  const clamped = Math.max(0, Math.min(graphemeOffset, segments.length));
  if (clamped >= segments.length) return text.length;
  return segments[clamped]!.utf16From;
}

// bidi-js is pinned and UAX #9 conformance-tested, but does not publish TypeScript declarations.
// @ts-expect-error -- the structural contract below is the subset this package consumes.
import untypedBidiFactory from 'bidi-js';

/**
 * UAX #9 embedding levels, one per UTF-16 code unit, plus the paragraph ranges they were resolved
 * within.
 *
 * The level is EXACT, not a direction: its parity gives direction, but the numeric value is what
 * reordering needs, and collapsing it early loses nested isolates.
 */
export interface BidiEmbeddingLevels {
  readonly levels: Uint8Array;
  readonly paragraphs: readonly {
    readonly start: number;
    readonly end: number;
    readonly level: number;
  }[];
}

export interface BidiAlgorithm {
  getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): BidiEmbeddingLevels;
  getReorderSegments(
    text: string,
    embedding: BidiEmbeddingLevels,
    start?: number,
    end?: number
  ): readonly (readonly [number, number])[];
}

const bidiFactory = untypedBidiFactory as () => BidiAlgorithm;

/** Pinned Unicode Bidirectional Algorithm implementation used for paragraph policy. */
export const bidiAlgorithm: BidiAlgorithm = bidiFactory();

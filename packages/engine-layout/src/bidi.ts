// bidi-js is pinned and UAX #9 conformance-tested, but does not publish TypeScript declarations.
// @ts-expect-error -- the structural contract below is the subset this package consumes.
import untypedBidiFactory from 'bidi-js';

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

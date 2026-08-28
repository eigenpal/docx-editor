// The closed candidate set `googleFonts()` may rank an uncatalogued family against, and
// the distance function that ranks it.
//
// Apart from `google-fonts.ts` so the rule can be unit-tested directly without becoming
// public API: nothing here is re-exported from an entry point.

export interface MetricCandidate {
  readonly family: string;
  readonly panose: string;
  /**
   * Mean advance over the Latin letters and the space, in em — the one term that tracks
   * how WIDE a line of text comes out.
   *
   * Not `OS/2.xAvgCharWidth`, which the earlier revision read. That field is a legacy
   * frequency-weighted figure that some families never updated, and a candidate whose
   * recorded width is far below its real one wins every ranking it enters for the wrong
   * reason. Recompute with `hmtx` if a candidate is added.
   */
  readonly averageAdvanceEm: number;
}

/**
 * PANOSE digits 0 ("any") and 1 ("no fit") are the ABSENCE of a classification, not a
 * value near 2. Treating them as a value is what let a family declaring half its digits
 * as "any" accumulate almost no distance against everything and win nearly every lookup.
 */
const isClassified = (digit: number): boolean => digit >= 2;

/** PANOSE index 1 for latin text: serif style. Cove and Square are not Normal Sans. */
const PANOSE_SERIF_STYLE = 1;
/** PANOSE index 3 for latin text: proportion, which is what the advance term keys on. */
const PANOSE_PROPORTION = 3;
/**
 * How much of its own PANOSE a candidate must actually state. A family that leaves most
 * digits unclassified cannot be ranked honestly — every unstated digit is a term the
 * comparison skips, so the family scores well by saying nothing.
 */
const MIN_CLASSIFIED_CANDIDATE_DIGITS = 7;

/**
 * Catalog faces eligible to stand in for an uncatalogued family, with their PANOSE and
 * their measured Latin mean advance.
 *
 * Every entry must pass {@link isRankableCandidate}: no wildcard PANOSE, and a stated
 * serif style. Nobile used to sit here and had to go — it declares four digits as "any",
 * including serif style, so it ranked as a near-perfect match for old-style serifs and
 * slab serifs alike.
 */
const DECLARED_METRIC_CANDIDATES: readonly MetricCandidate[] = Object.freeze([
  { family: 'B612', panose: '020b0606050000020004', averageAdvanceEm: 0.5854 },
  { family: 'Fira Sans', panose: '020b0503050000020004', averageAdvanceEm: 0.5401 },
  { family: 'Lato', panose: '020f0502020204030203', averageAdvanceEm: 0.5721 },
]);

const PANOSE_FIELD_WEIGHTS = [12, 8, 3, 6, 2, 1, 1, 1, 1, 1] as const;
/**
 * How far a candidate may sit from the declared classification and still be used. Beyond
 * it the resolver returns nothing, and the host's own measurement stands.
 */
export const MAX_METRIC_DISTANCE = 40;
const AVERAGE_ADVANCE_BY_PROPORTION = new Map<number, number>([
  [2, 0.49],
  [3, 0.54],
  [4, 0.6],
  [5, 0.66],
  [6, 0.45],
  [7, 0.72],
  [8, 0.4],
  [9, 0.6],
]);

function panoseBytes(value: string): readonly number[] | null {
  if (!/^[0-9a-f]{20}$/.test(value)) return null;
  return Array.from({ length: 10 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}

/** Whether a candidate states enough of its own classification to be ranked at all. */
export function isRankableCandidate(panose: string): boolean {
  const digits = panoseBytes(panose);
  if (!digits) return false;
  if (!isClassified(digits[PANOSE_SERIF_STYLE]!)) return false;
  return digits.filter(isClassified).length >= MIN_CLASSIFIED_CANDIDATE_DIGITS;
}

export const METRIC_CANDIDATES: readonly MetricCandidate[] = Object.freeze(
  DECLARED_METRIC_CANDIDATES.filter((candidate) => isRankableCandidate(candidate.panose))
);

export function metricDistance(sourcePanose: string, candidate: MetricCandidate): number {
  const source = panoseBytes(sourcePanose);
  const target = panoseBytes(candidate.panose);
  if (!source || !target || !isClassified(source[0]!) || source[0] !== target[0]) {
    return Number.POSITIVE_INFINITY;
  }
  // Serif style is a GATE, not one more weighted term. A document that does not state it
  // cannot be told apart from a sans, and the earlier revision skipped the digit whenever
  // either side left it unstated — which is precisely when it mattered most.
  if (!isClassified(source[PANOSE_SERIF_STYLE]!) || !isClassified(target[PANOSE_SERIF_STYLE]!)) {
    return Number.POSITIVE_INFINITY;
  }
  let score = 0;
  for (let index = 0; index < source.length; index += 1) {
    const left = source[index]!;
    const right = target[index]!;
    if (!isClassified(left) || !isClassified(right)) continue;
    score += Math.abs(left - right) * PANOSE_FIELD_WEIGHTS[index]!;
  }
  const expectedAdvance = AVERAGE_ADVANCE_BY_PROPORTION.get(source[PANOSE_PROPORTION]!);
  if (expectedAdvance !== undefined) {
    score += Math.abs(candidate.averageAdvanceEm - expectedAdvance) * 100;
  }
  return score;
}

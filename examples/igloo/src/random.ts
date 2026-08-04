// Deterministic pseudo-random, shared by the sea and the blizzard.
//
// Deterministic so every reload draws the SAME weather: a demo that rearranges itself
// between screenshots is a demo whose visual regressions are invisible. One integer of
// state, no dependency.

/** A seeded LCG. Same seed, same sequence, forever. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

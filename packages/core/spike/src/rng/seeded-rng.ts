/** @spike-features seeded-rng-diagnostics */
/** Mulberry32 deterministic PRNG for spike property runs. */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: () => number, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function pickOne<T>(rng: () => number, items: readonly T[]): T {
  return items[randomInt(rng, 0, items.length - 1)]!;
}

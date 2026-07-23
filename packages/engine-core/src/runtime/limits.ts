// Resource limits with finite defaults and non-disableable hard ceilings
// (document-engine task 0.3 / design D9, D14). Security ceilings are safety caps
// that a caller can lower but never raise or disable: an override of Infinity,
// 0, a negative, or NaN never turns a limit off — it clamps into (0, ceiling].
//
// These ceilings are conservative safety values, deliberately finite. They are
// NOT the performance thresholds the perf spec forbids inventing (latency/memory
// budgets ratified from baselines); they are the trust-boundary hard caps the
// security model requires.

export interface ResourceLimits {
  /** Max nested-structure recursion (tables/shapes/SDT/groups). */
  readonly maxRecursionDepth: number;
  /** Max total parsed element count. */
  readonly maxElementCount: number;
  /** Max package part count. */
  readonly maxPartCount: number;
  /** Max total decompressed bytes (zip-bomb guard). */
  readonly maxDecompressedBytes: number;
  /** Max total compressed input bytes. */
  readonly maxCompressedBytes: number;
  /** Max decompressed:compressed ratio per entry. */
  readonly maxCompressionRatio: number;
  /** In-memory chunk budget for streaming/spooling. */
  readonly maxChunkBytes: number;
  /** Max pagination passes before non-convergence is declared. */
  readonly maxPaginationPasses: number;
  /** Max queued items in any bounded work queue. */
  readonly maxQueueDepth: number;
}

/** Non-disableable hard ceilings: no resolved limit may exceed these. */
export const HARD_CEILINGS: ResourceLimits = Object.freeze({
  maxRecursionDepth: 256,
  maxElementCount: 50_000_000,
  maxPartCount: 100_000,
  maxDecompressedBytes: 2 * 1024 * 1024 * 1024,
  maxCompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxChunkBytes: 64 * 1024 * 1024,
  maxPaginationPasses: 100,
  maxQueueDepth: 1_000_000,
});

/** Finite defaults, all <= their hard ceiling. */
export const DEFAULT_LIMITS: ResourceLimits = Object.freeze({
  maxRecursionDepth: 128,
  maxElementCount: 10_000_000,
  maxPartCount: 10_000,
  maxDecompressedBytes: 512 * 1024 * 1024,
  maxCompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxChunkBytes: 16 * 1024 * 1024,
  maxPaginationPasses: 32,
  maxQueueDepth: 100_000,
});

const KEYS = Object.keys(HARD_CEILINGS) as (keyof ResourceLimits)[];

/**
 * Resolve caller overrides into a frozen, always-finite limit set. Each value is
 * `min(override>0 ? override : default, ceiling)`. Infinity/0/negative/NaN can
 * never disable a limit — the hard ceiling always wins.
 */
export function resolveLimits(overrides?: Partial<ResourceLimits>): ResourceLimits {
  const out = {} as Record<keyof ResourceLimits, number>;
  for (const key of KEYS) {
    const ceiling = HARD_CEILINGS[key];
    const raw = overrides?.[key];
    const chosen = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIMITS[key];
    out[key] = Math.min(Math.floor(chosen), ceiling);
  }
  return Object.freeze(out) as ResourceLimits;
}

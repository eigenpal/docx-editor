// The surface's count of published refusals. A caller reads the count before a call and asks
// for the refusal published after it, so a refusal read back is that call's own, whatever
// else moved the state meanwhile.

/** The refusal reads the surface exposes, and the recorder its `refuse` calls. */
export interface SurfaceRefusalLog {
  /**
   * Record one published refusal, and pass its raw form on to the host's diagnostics.
   * Returns `reason`, the refusal to publish.
   */
  readonly record: (reason: string, raw: string) => string;
  readonly reads: {
    readonly refusalCount: () => number;
    readonly refusalSince: (count: number) => string | null;
  };
}

/** A refusal log that reports each raw refusal through `report`. */
export function createSurfaceRefusalLog(report: (raw: string) => void): SurfaceRefusalLog {
  let count = 0;
  let latest: string | null = null;
  return {
    record: (reason, raw) => {
      count += 1;
      latest = reason;
      report(raw);
      return reason;
    },
    reads: {
      refusalCount: () => count,
      refusalSince: (since) => (since !== count ? latest : null),
    },
  };
}

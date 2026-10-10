// Pure analysis of one benchmark step. No I/O, so the math has its own unit tests.

import type { ClientReport } from './protocol.ts';

export interface ServerSample {
  readonly t: number;
  readonly cpuPct: number;
  readonly rssMb: number;
  readonly heapUsedMb: number;
  readonly heapTotalMb: number;
  readonly externalMb: number;
  readonly arrayBuffersMb: number;
  readonly eventLoopP50Ms: number;
  readonly eventLoopP99Ms: number;
  readonly eventLoopMaxMs: number;
  readonly tcpSockets: number;
}

export interface Distribution {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentile over a sorted copy. Returns 0 for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
}

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export interface LatencyResult {
  /** Milliseconds from a keystroke to the edit in another participant's document store. */
  readonly samples: number[];
  /** Edit and receiver pairs where the receiver never applied the edit. */
  readonly missing: number;
}

/**
 * Join every sent edit with the moment each other participant applied it.
 *
 * A Yjs clock only grows, so the first remote transaction at a receiver whose clock for the
 * sender reaches the edit's clock is the transaction that delivered the edit. Several edits
 * can arrive in one transaction. Each of them then gets its own latency from its own start.
 */
export function editLatencies(clients: readonly ClientReport[]): LatencyResult {
  const samples: number[] = [];
  let missing = 0;
  for (const receiver of clients) {
    // An observer keeps no store, so it records no apply times to measure.
    if (receiver.observer) continue;
    const bySender = new Map<number, (readonly [number, number])[]>();
    for (const [sender, clock, t] of receiver.received) {
      let list = bySender.get(sender);
      if (!list) bySender.set(sender, (list = []));
      list.push([clock, t]);
    }
    for (const sender of clients) {
      if (sender === receiver) continue;
      const arrivals = bySender.get(sender.clientId) ?? [];
      let cursor = 0;
      for (const [clock, startedAt] of sender.sent) {
        while (cursor < arrivals.length && arrivals[cursor]![0] < clock) cursor += 1;
        const arrival = arrivals[cursor];
        if (!arrival) {
          missing += 1;
          continue;
        }
        samples.push(Math.max(0, arrival[1] - startedAt));
      }
    }
  }
  return { samples, missing };
}

export interface ServerSummary {
  readonly samples: number;
  readonly cpuAvgPct: number;
  readonly cpuP95Pct: number;
  readonly cpuMaxPct: number;
  readonly rssStartMb: number;
  readonly rssMaxMb: number;
  readonly heapUsedMaxMb: number;
  readonly eventLoopP99MaxMs: number;
  readonly eventLoopMaxMs: number;
  readonly tcpSocketsMax: number;
}

export function summarizeServer(
  samples: readonly ServerSample[],
  from: number,
  to: number
): ServerSummary {
  const window = samples.filter((sample) => sample.t >= from && sample.t <= to);
  const cpu = window.map((sample) => sample.cpuPct);
  const max = (values: readonly number[]) => values.reduce((top, value) => Math.max(top, value), 0);
  return {
    samples: window.length,
    cpuAvgPct: cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : 0,
    cpuP95Pct: percentile(cpu, 0.95),
    cpuMaxPct: max(cpu),
    rssStartMb: window[0]?.rssMb ?? 0,
    rssMaxMb: max(window.map((sample) => sample.rssMb)),
    heapUsedMaxMb: max(window.map((sample) => sample.heapUsedMb)),
    eventLoopP99MaxMs: max(window.map((sample) => sample.eventLoopP99Ms)),
    eventLoopMaxMs: max(window.map((sample) => sample.eventLoopMaxMs)),
    tcpSocketsMax: max(window.map((sample) => sample.tcpSockets)),
  };
}

/** Least-squares line through `(x, y)`. Used to estimate the cost of one more participant. */
export function linearFit(points: readonly (readonly [number, number])[]): {
  readonly slope: number;
  readonly intercept: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0 };
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

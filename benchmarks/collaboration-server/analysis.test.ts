import { describe, expect, test } from 'bun:test';
import {
  distribution,
  editLatencies,
  linearFit,
  summarizeServer,
  type ServerSample,
} from './analysis.ts';
import type { ClientReport } from './protocol.ts';

function client(
  clientId: number,
  sent: [number, number][],
  received: [number, number, number][]
): ClientReport {
  return {
    index: clientId,
    clientId,
    joinMs: 0,
    sent,
    received,
    planned: sent.length,
    applied: sent.length,
    refused: {},
    schedulerLagMs: [],
    remoteApplyMs: [],
    statusEvents: [],
  };
}

describe('editLatencies', () => {
  test('matches each edit with the first arrival that reaches its clock', () => {
    const alice = client(
      1,
      [
        [5, 100],
        [9, 200],
      ],
      []
    );
    // Bob receives both of Alice's edits in one transaction at t=230.
    const bob = client(2, [], [[1, 9, 230]]);
    const result = editLatencies([alice, bob]);
    expect(result.samples.sort((a, b) => a - b)).toEqual([30, 130]);
    expect(result.missing).toBe(0);
  });

  test('counts an edit that a peer never applied as missing', () => {
    const alice = client(
      1,
      [
        [5, 100],
        [9, 200],
      ],
      []
    );
    const bob = client(2, [], [[1, 5, 140]]);
    const result = editLatencies([alice, bob]);
    expect(result.samples).toEqual([40]);
    expect(result.missing).toBe(1);
  });

  test('ignores arrivals from other senders', () => {
    const alice = client(1, [[3, 100]], []);
    const carol = client(3, [], []);
    const bob = client(
      2,
      [],
      [
        [3, 50, 110],
        [1, 3, 150],
      ]
    );
    expect(editLatencies([alice, bob, carol]).samples).toEqual([50]);
  });

  test('skips readers, who record no arrivals, instead of counting their edits missing', () => {
    const alice = client(1, [[5, 100]], []);
    const bob = client(2, [], [[1, 5, 140]]);
    const reader = { ...client(3, [], []), observer: true };
    const result = editLatencies([alice, bob, reader]);
    expect(result.samples).toEqual([40]);
    expect(result.missing).toBe(0);
  });
});

describe('distribution and fits', () => {
  test('reports nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const result = distribution(values);
    expect(result.p50).toBe(50);
    expect(result.p95).toBe(95);
    expect(result.p99).toBe(99);
    expect(result.max).toBe(100);
  });

  test('returns zeros for no values', () => {
    expect(distribution([]).count).toBe(0);
  });

  test('fits a straight line', () => {
    const fit = linearFit([
      [5, 110],
      [10, 120],
      [20, 140],
    ]);
    expect(fit.slope).toBeCloseTo(2);
    expect(fit.intercept).toBeCloseTo(100);
  });

  test('summarizes only the samples inside the window', () => {
    const sample = (t: number, cpuPct: number, rssMb: number): ServerSample => ({
      t,
      cpuPct,
      rssMb,
      heapUsedMb: 1,
      heapTotalMb: 1,
      externalMb: 0,
      arrayBuffersMb: 0,
      eventLoopP50Ms: 1,
      eventLoopP99Ms: 2,
      eventLoopMaxMs: 3,
      tcpSockets: 4,
    });
    const summary = summarizeServer(
      [sample(0, 90, 900), sample(10, 10, 100), sample(20, 30, 200)],
      5,
      25
    );
    expect(summary.samples).toBe(2);
    expect(summary.cpuAvgPct).toBe(20);
    expect(summary.rssMaxMb).toBe(200);
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  FAILING_REPORT_MS,
  MAX_ABANDONED_PER_PEER,
  createLinkHealth,
  linkHealthStatus,
} from '../webrtc-link-health.ts';

/** Timers the test fires by hand. */
function manualTimers() {
  let next = 0;
  const pending = new Map<number, { run: () => void; ms: number }>();
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        next += 1;
        pending.set(next, { run, ms });
        return next;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    fireAll(ms: number) {
      for (const [handle, timer] of [...pending]) {
        if (timer.ms > ms) continue;
        pending.delete(handle);
        timer.run();
      }
    },
  };
}

describe('createLinkHealth', () => {
  test('reports a link only after repeated losses, and once', () => {
    const reports: boolean[] = [];
    const clock = manualTimers();
    const health = createLinkHealth((failing) => reports.push(failing), clock.timers);
    for (let loss = 1; loss < MAX_ABANDONED_PER_PEER; loss += 1) health.abandoned('peer-a');
    expect(reports).toEqual([]);
    health.abandoned('peer-a');
    health.abandoned('peer-a');
    expect(reports).toEqual([true]);
  });

  test('a large message that arrives whole ends the report', () => {
    const reports: boolean[] = [];
    const health = createLinkHealth((failing) => reports.push(failing), manualTimers().timers);
    for (let loss = 0; loss < MAX_ABANDONED_PER_PEER; loss += 1) health.abandoned('peer-a');
    health.delivered('peer-a');
    expect(reports).toEqual([true, false]);
  });

  test('a peer that leaves or stops losing messages stops being reported', () => {
    const reports: boolean[] = [];
    const clock = manualTimers();
    const health = createLinkHealth((failing) => reports.push(failing), clock.timers);
    for (let loss = 0; loss < MAX_ABANDONED_PER_PEER; loss += 1) health.abandoned('peer-a');
    clock.fireAll(FAILING_REPORT_MS);
    expect(reports).toEqual([true, false]);
    // Counting starts over: one more loss is not a failing link.
    health.abandoned('peer-a');
    expect(reports).toEqual([true, false]);
  });

  test('the signaling connection coming back starts every count over', () => {
    const reports: boolean[] = [];
    const health = createLinkHealth((failing) => reports.push(failing), manualTimers().timers);
    for (let loss = 0; loss < MAX_ABANDONED_PER_PEER; loss += 1) health.abandoned('peer-a');
    health.reset();
    expect(reports).toEqual([true, false]);
    for (let loss = 0; loss < MAX_ABANDONED_PER_PEER; loss += 1) health.abandoned('peer-a');
    expect(reports).toEqual([true, false, true]);
  });

  test('two failing peers report once, and recover only when both do', () => {
    const reports: boolean[] = [];
    const health = createLinkHealth((failing) => reports.push(failing), manualTimers().timers);
    for (let loss = 0; loss < MAX_ABANDONED_PER_PEER; loss += 1) {
      health.abandoned('peer-a');
      health.abandoned('peer-b');
    }
    health.delivered('peer-a');
    expect(reports).toEqual([true]);
    health.delivered('peer-b');
    expect(reports).toEqual([true, false]);
  });
});

describe('link health on the room status', () => {
  test('a failing link keeps the room ready, so editing never pauses for one peer', () => {
    const calls: unknown[][] = [];
    const report = linkHealthStatus(
      { setTransportStatus: (...args: unknown[]) => calls.push(args) },
      () => true
    );
    report(true);
    report(false);
    expect(calls).toEqual([
      ['ready', 'transport-disconnected', 'a peer link cannot carry large updates'],
      ['ready'],
    ]);
  });

  test('while signaling is down, its own status stands', () => {
    const calls: unknown[][] = [];
    const report = linkHealthStatus(
      { setTransportStatus: (...args: unknown[]) => calls.push(args) },
      () => false
    );
    report(true);
    report(false);
    expect(calls).toEqual([]);
  });
});

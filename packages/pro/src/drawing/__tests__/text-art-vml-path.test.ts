/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The VML path tracer's bounds on file-supplied arc sweeps.

import { describe, expect, test } from 'bun:test';
import { traceVmlPath } from '../text-art-vml-path.ts';

describe('the VML path tracer bounds', () => {
  test('an arc whose sweep needs more points than the cap is refused at once', () => {
    const started = performance.now();
    expect(traceVmlPath('al10800,10800,10800,10800,0,99999999999999999e', [])).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('a sweep of a few full turns still traces', () => {
    // Three full turns, 65536 units per degree.
    const [arc] = traceVmlPath(`al10800,10800,10800,10800,0,${3 * 360 * 65536}e`, [])!;
    expect(arc!.points.length).toBe(1 + 12 * 24);
  });

  test('arcs that together pass the point cap are refused', () => {
    const turn = 360 * 65536;
    const path = `al0,0,10,10,0,${10 * turn}` + `ae0,0,10,10,0,${10 * turn}`.repeat(4) + 'e';
    expect(traceVmlPath(path, [])).toBeNull();
  });
});

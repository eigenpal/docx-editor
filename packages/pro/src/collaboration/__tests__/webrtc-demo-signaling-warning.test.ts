/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A silent fallback to the public demo signaling endpoints ships demos to production.
// `createWebrtcCollaboration` warns once per process when `signaling` is omitted; passing
// `DEMO_SIGNALING_ENDPOINTS` explicitly is deliberate and stays silent.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DEMO_SIGNALING_ENDPOINTS,
  resetDemoSignalingWarningForTests,
  warnOnDemoSignalingFallback,
} from '../webrtc.ts';

const originalWarn = console.warn;
let warnings: string[] = [];

beforeEach(() => {
  resetDemoSignalingWarningForTests();
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('demo signaling fallback warning', () => {
  test('an omitted signaling option warns once per process', () => {
    warnOnDemoSignalingFallback(undefined);
    warnOnDemoSignalingFallback(undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('signaling');
    expect(warnings[0]).toContain('DEMO_SIGNALING_ENDPOINTS');
  });

  test('passing the demo endpoints explicitly is deliberate and never warns', () => {
    warnOnDemoSignalingFallback(DEMO_SIGNALING_ENDPOINTS);
    expect(warnings).toHaveLength(0);
  });

  test('custom signaling never warns', () => {
    warnOnDemoSignalingFallback(['wss://signaling.example']);
    expect(warnings).toHaveLength(0);
  });
});

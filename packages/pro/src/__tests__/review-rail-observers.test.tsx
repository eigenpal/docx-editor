/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's observers outlive review changes. Every comment edit changes the items the rail
// measures against; that must measure again on the existing observers, not rebuild them.
// The Vue twin is review-rail-observers-vue.test.ts.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { useRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRailMetrics } from '../react/use-rail-geometry.ts';
import { countRailObservers, railScene } from './review-rail-observers-harness.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

test('a review change measures again without rebuilding the observers', () => {
  const scene = railScene();
  const counter = countRailObservers();
  try {
    const editor = { getRenderScale: () => scene.scale };
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly string[] }) => {
        const railRef = useRef<HTMLElement | null>(scene.column);
        return useRailMetrics(editor, railRef, items, true);
      },
      { initialProps: { items: ['a'] } }
    );
    expect(result.current.scale).toBe(96 / 72);
    const built = counter.constructed;
    const next = ['a', 'b'];
    const reads = scene.reads();

    scene.scale = 2;
    act(() => rerender({ items: next }));
    expect(result.current.scale).toBe(2);
    expect(counter.constructed).toBe(built);
    expect(counter.disconnected).toBe(0);
    expect(scene.reads()).toBe(reads + 1);

    // The same items measure nothing.
    act(() => rerender({ items: next }));
    expect(scene.reads()).toBe(reads + 1);
  } finally {
    counter.restore();
  }
});

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of review-rail-observers.test.tsx: a review change measures again on the
// rail's existing observers.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { effectScope, nextTick, shallowRef } from 'vue';
import { bindReviewRailMetrics } from '../vue/useReviewRailMetrics.ts';
import { countRailObservers, railScene } from './review-rail-observers-harness.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());
afterEach(() => {
  document.body.replaceChildren();
});

test('a review change measures again without rebuilding the observers', async () => {
  const scene = railScene();
  const counter = countRailObservers();
  const scope = effectScope();
  try {
    const items = shallowRef<readonly string[]>(['a']);
    const editor = { getRenderScale: () => scene.scale };
    const metrics = scope.run(() =>
      bindReviewRailMetrics({
        rail: () => scene.column,
        editor: () => editor,
        trackScroll: () => false,
        remeasure: () => items.value,
      })
    )!;
    await nextTick();
    expect(metrics.value.scale).toBe(96 / 72);
    const built = counter.constructed;
    const reads = scene.reads();

    scene.scale = 2;
    items.value = ['a', 'b'];
    await nextTick();
    expect(metrics.value.scale).toBe(2);
    expect(counter.constructed).toBe(built);
    expect(counter.disconnected).toBe(0);
    expect(scene.reads()).toBe(reads + 1);

    scope.stop();
    expect(counter.disconnected).toBe(1);
  } finally {
    scope.stop();
    counter.restore();
  }
});

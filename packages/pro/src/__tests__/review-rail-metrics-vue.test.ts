/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `useReviewRailMetrics` gives a custom review column the packaged rail's geometry. The React
// twin is review-rail-metrics-react.test.tsx; both assert the same numbers for the same layout.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defineComponent, h, ref, type VNode } from 'vue';
import { flush, waitFor } from './review-vue-harness.ts';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import {
  COMMENTED_SOURCE,
  EXPECTED_AT_100,
  installRailGeometry,
  readMetrics,
} from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();

/** Reads the packaged rail's measurement from inside `preset: false`. */
const InsideProbe = defineComponent({
  name: 'InsideProbe',
  setup() {
    const { metrics } = useReviewRailMetrics();
    return () =>
      h('div', { 'data-testid': 'inside-probe', 'data-metrics': JSON.stringify(metrics.value) });
  },
});

/** A host's own column, placed only from the public composables. */
const CustomColumn = defineComponent({
  name: 'CustomColumn',
  setup() {
    const railRef = ref<HTMLElement | null>(null);
    const { metrics } = useReviewRailMetrics(railRef);
    const { items } = useReview();
    const positions = useStackedReviewPositions(items, NO_HEIGHTS, () => ({
      scale: metrics.value.scale,
    }));
    return () =>
      h(
        'div',
        {
          ref: railRef,
          'data-testid': 'custom-rail',
          'data-metrics': JSON.stringify(metrics.value),
          style: { position: 'absolute', top: '0px', left: `${metrics.value.left ?? 0}px` },
        },
        items.value.map((item) =>
          h('div', {
            key: item.key,
            'data-testid': 'custom-card',
            'data-anchor': item.anchorY ?? '',
            style: {
              position: 'absolute',
              top: `${metrics.value.top + (positions.value.get(item.key) ?? 0) * metrics.value.scale}px`,
            },
          })
        )
      );
  },
});

async function mount(children: () => VNode) {
  const mounted = mountEditorTree(
    () => [],
    COMMENTED_SOURCE,
    () => [children()],
    [reviewModule()]
  );
  await flush();
  await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
  return mounted;
}

describe('useReviewRailMetrics (Vue)', () => {
  test('a preset: false child reads the packaged rail geometry', async () => {
    const mounted = await mount(() =>
      h(DocxEditorReview, { preset: false }, { default: () => [h(InsideProbe)] })
    );
    try {
      const probe = () => mounted.container.querySelector('[data-testid="inside-probe"]');
      await waitFor(() => readMetrics(probe())?.left === EXPECTED_AT_100.left);
      expect(readMetrics(probe())).toEqual({ ...EXPECTED_AT_100 });
      const rail = mounted.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
      expect(rail.style.left).toBe(`${EXPECTED_AT_100.left}px`);
    } finally {
      mounted.unmount();
    }
  });

  test('a custom column measures itself and places a card at its anchor', async () => {
    const mounted = await mount(() => h(CustomColumn));
    try {
      const column = () => mounted.container.querySelector('[data-testid="custom-rail"]');
      await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
      expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
      await waitFor(() => mounted.container.querySelector('[data-testid="custom-card"]') !== null);
      const card = mounted.container.querySelector('[data-testid="custom-card"]') as HTMLElement;
      const anchor = Number(card.getAttribute('data-anchor'));
      expect(card.getAttribute('data-anchor')).not.toBe('');
      expect(card.getAttribute('data-anchor')).not.toBe('');
      expect(Number.isFinite(anchor)).toBe(true);
      expect(Number.parseFloat(card.style.top)).toBeCloseTo(
        EXPECTED_AT_100.top + anchor * EXPECTED_AT_100.scale,
        5
      );
    } finally {
      mounted.unmount();
    }
  });

  test('a zoom change updates the scale', async () => {
    const mounted = await mount(() => h(CustomColumn));
    try {
      const column = () => mounted.container.querySelector('[data-testid="custom-rail"]');
      await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
      mounted.editor().setZoom(1.5);
      await waitFor(() => readMetrics(column())?.scale === 2);
      expect(readMetrics(column())?.scale).toBe(2);
    } finally {
      mounted.unmount();
    }
  });

  test('outside the rail and without a ref, it reports the initial value', async () => {
    const Outside = defineComponent({
      setup() {
        const { metrics } = useReviewRailMetrics();
        return () =>
          h('div', {
            'data-testid': 'outside-probe',
            'data-metrics': JSON.stringify(metrics.value),
          });
      },
    });
    const mounted = await mount(() => h(Outside));
    try {
      expect(readMetrics(mounted.container.querySelector('[data-testid="outside-probe"]'))).toEqual(
        { scale: 96 / 72, top: 0, left: null, compactCardLeft: null }
      );
    } finally {
      mounted.unmount();
    }
  });
});

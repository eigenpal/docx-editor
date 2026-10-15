/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `useReviewRailMetrics` gives a custom review column the packaged rail's geometry. The React
// twin is review-rail-metrics-react.test.tsx; both assert the same numbers for the same layout.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { flush, waitFor } from './review-vue-harness.ts';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
  type UseReviewRailMetricsOptions,
} from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { mountEditorTree, type MountedEditor } from '../../../vue/test/helpers/mount.ts';
import {
  BANNER_HEIGHT,
  COMMENTED_SOURCE,
  EXPECTED_AT_100,
  insertBanner,
  installRailGeometry,
  railGeometry,
  readMetrics,
} from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());
afterEach(() => {
  railGeometry.surfaceRight = 1116;
  railGeometry.clientWidth = 1400;
});

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
  props: {
    position: { type: String, default: 'absolute' },
    options: { type: Object as PropType<UseReviewRailMetricsOptions>, default: undefined },
  },
  setup(props) {
    const railRef = ref<HTMLElement | null>(null);
    const { metrics } = useReviewRailMetrics(railRef, () => props.options);
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
          style: {
            position: props.position,
            top: '0px',
            left: `${metrics.value.left ?? 0}px`,
            visibility: metrics.value.left === null ? 'hidden' : 'visible',
          },
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

async function mount(children: () => VNode): Promise<MountedEditor> {
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

/** Run `body` against a mount, and always unmount it. */
async function withMount(
  children: () => VNode,
  body: (mounted: MountedEditor) => Promise<void>
): Promise<void> {
  const mounted = await mount(children);
  try {
    await body(mounted);
  } finally {
    mounted.unmount();
  }
}

const scroller = (container: HTMLElement) =>
  container.querySelector('.docx-editor__scroll-container') as HTMLElement;
const columnOf = (container: HTMLElement) => container.querySelector('[data-testid="custom-rail"]');

describe('useReviewRailMetrics (Vue)', () => {
  test('a preset: false child reads the packaged rail geometry', async () => {
    await withMount(
      () => h(DocxEditorReview, { preset: false }, { default: () => [h(InsideProbe)] }),
      async (mounted) => {
        const probe = () => mounted.container.querySelector('[data-testid="inside-probe"]');
        await waitFor(() => readMetrics(probe())?.left === EXPECTED_AT_100.left);
        expect(readMetrics(probe())).toEqual({ ...EXPECTED_AT_100 });
        const rail = mounted.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
        expect(rail.style.left).toBe(`${EXPECTED_AT_100.left}px`);
      }
    );
  });

  test('a custom column measures itself and places a card at its anchor', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
        expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
        await waitFor(
          () => mounted.container.querySelector('[data-testid="custom-card"]') !== null
        );
        const card = mounted.container.querySelector('[data-testid="custom-card"]') as HTMLElement;
        expect(card.getAttribute('data-anchor')).not.toBe('');
        const anchor = Number(card.getAttribute('data-anchor'));
        expect(Number.isFinite(anchor)).toBe(true);
        expect(Number.parseFloat(card.style.top)).toBeCloseTo(
          EXPECTED_AT_100.top + anchor * EXPECTED_AT_100.scale,
          5
        );
      }
    );
  });

  test('a zoom change updates the scale', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
        mounted.editor().setZoom(1.5);
        await waitFor(() => readMetrics(column())?.scale === 2);
        expect(readMetrics(column())?.scale).toBe(2);
      }
    );
  });

  test('ignores a loading placeholder before the pages and survives its removal', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        // Remount the column with a placeholder surface ahead of the pages, as
        // `DocxEditor.Loading` placed before `DocxEditor.Content` renders one.
        mounted.viewportVisible.value = false;
        await flush();
        const placeholder = document.createElement('div');
        placeholder.className = 'docx-paginated-surface docx-editor__loading-surface';
        scroller(mounted.container).prepend(placeholder);
        mounted.viewportVisible.value = true;
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
        expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
        placeholder.remove();
        await flush();
        expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
      }
    );
  });

  test('follows a banner that appears above the pages', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
        insertBanner(scroller(mounted.container));
        await waitFor(() => readMetrics(column())?.top === EXPECTED_AT_100.top + BANNER_HEIGHT);
        expect(readMetrics(column())?.top).toBe(EXPECTED_AT_100.top + BANNER_HEIGHT);
      }
    );
  });

  test('measures again after the column unmounts and mounts', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
        mounted.viewportVisible.value = false;
        await flush();
        expect(column()).toBeNull();
        railGeometry.surfaceRight = 1016;
        mounted.viewportVisible.value = true;
        await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left - 100);
        expect(readMetrics(column())?.left).toBe(EXPECTED_AT_100.left - 100);
      }
    );
  });

  test('a custom column reserves the review gutter unless told not to', async () => {
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const gutter = () =>
          scroller(mounted.container).style.getPropertyValue('--docx-review-gutter');
        await waitFor(() => gutter() !== '');
        expect(gutter()).not.toBe('');
      }
    );
    await withMount(
      () => h(CustomColumn, { options: { reserveGutter: false } }),
      async (mounted) => {
        await waitFor(
          () => readMetrics(columnOf(mounted.container))?.left === EXPECTED_AT_100.left
        );
        expect(scroller(mounted.container).style.getPropertyValue('--docx-review-gutter')).toBe('');
      }
    );
  });

  test('reports compact when the viewport is too narrow for a full column', async () => {
    railGeometry.clientWidth = 1000;
    await withMount(
      () => h(CustomColumn),
      async (mounted) => {
        const column = () => columnOf(mounted.container);
        await waitFor(() => readMetrics(column())?.compact === true);
        expect(readMetrics(column())?.compact).toBe(true);
        expect(readMetrics(column())?.compactCardLeft).toBe(1000 - EXPECTED_AT_100.left - 312);
      }
    );
  });

  test('the packaged rail re-measures when the viewport style changes', async () => {
    await withMount(
      () => h(DocxEditorReview),
      async (mounted) => {
        const rail = () =>
          mounted.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
        await waitFor(() => rail()?.style.left === `${EXPECTED_AT_100.left}px`);
        railGeometry.surfaceRight = 1016;
        scroller(mounted.container).style.setProperty('--probe', '1');
        await waitFor(() => rail().style.left === `${EXPECTED_AT_100.left - 100}px`);
        expect(rail().style.left).toBe(`${EXPECTED_AT_100.left - 100}px`);
      }
    );
  });

  test('warns once in development when the column is not absolutely positioned', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withMount(
        () => h(CustomColumn, { position: 'relative' }),
        async () => {
          await waitFor(() => warn.mock.calls.length > 0);
          const messages = warn.mock.calls.map((call) => String(call[0]));
          expect(messages.some((text) => text.includes('not absolutely positioned'))).toBe(true);
        }
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('outside the rail and without a ref, it warns and reports the initial value', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
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
    try {
      await withMount(
        () => h(Outside),
        async (mounted) => {
          expect(
            readMetrics(mounted.container.querySelector('[data-testid="outside-probe"]'))
          ).toEqual({ scale: 96 / 72, top: 0, left: null, compactCardLeft: null, compact: false });
          const messages = warn.mock.calls.map((call) => String(call[0]));
          expect(messages.some((text) => text.includes('without a railRef'))).toBe(true);
        }
      );
    } finally {
      warn.mockRestore();
    }
  });
});

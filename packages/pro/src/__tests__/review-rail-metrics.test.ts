/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The shared rail measurement both adapters and the public hook read.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  BANNER_HEIGHT,
  EXPECTED_AT_100,
  installRailGeometry,
  insertBanner,
  railGeometry,
} from './review-rail-metrics-harness.ts';
import type { ReviewRailGeometry } from '../review/rail-metrics.ts';
import {
  isCompactReviewColumn,
  measureReviewRailMetrics,
  observeReviewRailMetrics,
  sameReviewRailMetrics,
} from '../review/rail-metrics.ts';

interface FakeRect {
  top: number;
  left: number;
  right: number;
}

/** A rail, its scroll container, and the surface inside it, with no DOM at all. */
function fakeRail(options: {
  container?: Partial<{
    scrollTop: number;
    scrollLeft: number;
    clientTop: number;
    clientLeft: number;
    clientWidth: number;
  }>;
  containerRect?: FakeRect;
  surfaceRect?: FakeRect | null;
  view?: object;
  side?: 'left';
  railWidth?: number;
}) {
  const listeners = new Map<string, () => void>();
  const surface =
    options.surfaceRect === null
      ? null
      : {
          getBoundingClientRect: () => options.surfaceRect ?? { top: 140, left: 300, right: 1116 },
        };
  const container = {
    scrollTop: 0,
    scrollLeft: 0,
    clientTop: 0,
    clientLeft: 0,
    clientWidth: 1400,
    ...options.container,
    getBoundingClientRect: () => options.containerRect ?? { top: 40, left: 20, right: 1420 },
    children: [] as unknown[],
    getAttribute: (name: string) => (name === 'data-review-side' ? (options.side ?? null) : null),
    querySelector: (selector: string) =>
      selector.startsWith('.docx-paginated-surface') ? surface : null,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const rail = {
    offsetParent: container,
    offsetWidth: options.railWidth ?? 300,
    ownerDocument: { defaultView: options.view ?? null },
  } as unknown as HTMLElement;
  return { rail, container, listeners };
}

describe('measureReviewRailMetrics', () => {
  test('places the rail one gutter right of the page and finds the first page top', () => {
    const { rail } = fakeRail({});
    expect(measureReviewRailMetrics(rail, 2)).toEqual({
      scale: 2,
      top: 100,
      left: 1112,
      side: 'right',
      compactCardLeft: 1400 - 1112 - 300 - 12,
    });
  });

  test('is scroll-invariant for top and left, and follows the visible edge for compact', () => {
    // Scrolling moves both rects by the scroll amount; the scroll offsets cancel it.
    const { rail } = fakeRail({
      container: { scrollTop: 500, scrollLeft: 30, clientTop: 2, clientLeft: 3 },
      containerRect: { top: 40, left: 20, right: 1420 },
      surfaceRect: { top: 140 - 500 + 2, left: 300 - 30 + 3, right: 1116 - 30 + 3 },
    });
    const metrics = measureReviewRailMetrics(rail, 1);
    expect(metrics.top).toBe(100);
    expect(metrics.left).toBe(1112);
    expect(metrics.compactCardLeft).toBe(30 + 1400 - 1112 - 300 - 12);
  });

  test('places the rail one gutter left of the page in a right-to-left interface', () => {
    // Page box 300..1116 in a container at 20: the column ends 16px before x 280.
    const open = fakeRail({ side: 'left' });
    expect(measureReviewRailMetrics(open.rail, 1)).toEqual({
      scale: 1,
      top: 100,
      left: 280 - 16 - 300,
      side: 'left',
      compactCardLeft: 12 - (280 - 16 - 300),
    });
    // The closed strip is narrower, and its right edge stays one gutter off the page.
    const closed = fakeRail({ side: 'left', railWidth: 32 });
    expect(measureReviewRailMetrics(closed.rail, 1).left).toBe(280 - 16 - 32);
    // Scrolled sideways, the compact card follows the visible left edge.
    const scrolled = fakeRail({
      side: 'left',
      container: { scrollLeft: 30 },
      surfaceRect: { top: 140, left: 300 - 30, right: 1116 - 30 },
    });
    const metrics = measureReviewRailMetrics(scrolled.rail, 1);
    expect(metrics.left).toBe(280 - 16 - 300);
    expect(metrics.compactCardLeft).toBe(30 + 12 - (280 - 16 - 300));
  });

  test('reports no horizontal placement before there is a page', () => {
    const { rail } = fakeRail({ surfaceRect: null });
    expect(measureReviewRailMetrics(rail, 1.5)).toEqual({
      scale: 1.5,
      top: 0,
      left: null,
      side: 'right',
      compactCardLeft: null,
    });
  });

  test('compares every field', () => {
    const base = { scale: 1, top: 2, left: 3, side: 'right' as const, compactCardLeft: 4 };
    expect(isCompactReviewColumn(true, 32, 316)).toBe(true);
    expect(isCompactReviewColumn(true, 316, 316)).toBe(false);
    expect(isCompactReviewColumn(false, 32, 316)).toBe(false);
    expect(isCompactReviewColumn(true, 0, 316)).toBe(false);
    expect(sameReviewRailMetrics(base, { ...base })).toBe(true);
    expect(sameReviewRailMetrics(base, { ...base, compactCardLeft: null })).toBe(false);
    expect(sameReviewRailMetrics(base, { ...base, side: 'left' })).toBe(false);
  });
});

describe('observeReviewRailMetrics', () => {
  test("observes in the rail's own window, as in a pop-out window or an iframe", () => {
    const resizeTargets: unknown[] = [];
    const mutationTargets: unknown[] = [];
    const resizeCallbacks: Array<() => void> = [];
    const frames: Array<() => void> = [];
    let disconnected = 0;
    // A window other than this realm's global one: nothing may fall back to the globals.
    const popout = {
      ResizeObserver: class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe(target: unknown) {
          resizeTargets.push(target);
        }
        disconnect() {
          disconnected++;
        }
      },
      MutationObserver: class {
        observe(target: unknown) {
          mutationTargets.push(target);
        }
        disconnect() {
          disconnected++;
        }
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: () => {},
    };
    const { rail, container, listeners } = fakeRail({ view: popout });
    let scale = 96 / 72;
    const seen: number[] = [];
    const stop = observeReviewRailMetrics(
      rail,
      { getRenderScale: () => scale },
      (metrics) => seen.push(metrics.scale),
      { trackScroll: true }
    );
    expect(seen).toEqual([96 / 72]);
    expect(resizeTargets).toEqual([container, container.querySelector('.docx-paginated-surface')]);
    expect(mutationTargets).toEqual([container]);

    // A zoom change resizes the surface; the observer re-reads the engine's scale.
    scale = 2;
    resizeCallbacks[0]!();
    expect(seen.at(-1)).toBe(2);

    // Scrolling re-measures once per frame of the pop-out window.
    listeners.get('scroll')!();
    listeners.get('scroll')!();
    expect(frames.length).toBe(1);
    frames[0]!();
    expect(seen.length).toBe(3);

    stop();
    expect(disconnected).toBe(2);
    expect(listeners.has('scroll')).toBe(false);
  });
});

describe('observeReviewRailMetrics in a DOM', () => {
  let restore: () => void = () => {};
  beforeAll(() => {
    restore = installRailGeometry();
  });
  afterAll(() => restore());
  afterEach(() => {
    document.body.replaceChildren();
    railGeometry.surfaceRight = 1116;
  });

  /** A scroll container holding a column, and optionally the placeholder and the pages. */
  function scene(options: { placeholder?: boolean; content?: boolean }) {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    if (options.placeholder) {
      const loading = document.createElement('div');
      loading.className = 'docx-editor docx-editor__loading';
      const placeholder = document.createElement('div');
      placeholder.className = 'docx-paginated-surface docx-editor__loading-surface';
      loading.append(placeholder);
      scroller.append(loading);
    }
    const mount = document.createElement('div');
    mount.className = 'docx-content-mount';
    if (options.content) {
      const surface = document.createElement('div');
      surface.className = 'docx-paginated-surface';
      mount.append(surface);
    }
    const column = document.createElement('div');
    column.style.position = 'absolute';
    scroller.append(mount, column);
    document.body.append(scroller);
    const seen: ReviewRailGeometry[] = [];
    const stop = observeReviewRailMetrics(column, { getRenderScale: () => 96 / 72 }, (next) =>
      seen.push(next)
    );
    return { scroller, mount, column, seen, stop };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  test('ignores the loading placeholder and binds to the pages once they mount', async () => {
    const { scroller, mount, seen, stop } = scene({ placeholder: true });
    try {
      // Only the placeholder exists: nothing to place against yet.
      expect(seen.at(-1)?.left).toBeNull();
      const surface = document.createElement('div');
      surface.className = 'docx-paginated-surface';
      mount.append(surface);
      // The surface lands inside the content mount, not as a container child, so the swap
      // is seen when the placeholder leaves.
      scroller.firstElementChild!.remove();
      await settle();
      expect(seen.at(-1)).toMatchObject({ top: EXPECTED_AT_100.top, left: EXPECTED_AT_100.left });
    } finally {
      stop();
    }
  });

  test('measures the pages, not the placeholder, while both exist', () => {
    const { seen, stop } = scene({ placeholder: true, content: true });
    try {
      expect(seen.at(-1)).toMatchObject({ top: EXPECTED_AT_100.top, left: EXPECTED_AT_100.left });
    } finally {
      stop();
    }
  });

  test('follows a banner that appears above the pages', async () => {
    const { scroller, seen, stop } = scene({ content: true });
    try {
      expect(seen.at(-1)?.top).toBe(EXPECTED_AT_100.top);
      insertBanner(scroller);
      await settle();
      expect(seen.at(-1)?.top).toBe(EXPECTED_AT_100.top + BANNER_HEIGHT);
    } finally {
      stop();
    }
  });

  test('re-measures when the container style changes', async () => {
    const { scroller, seen, stop } = scene({ content: true });
    try {
      railGeometry.surfaceRight = 1016;
      scroller.style.setProperty('--docx-review-gutter', '316px');
      await settle();
      expect(seen.at(-1)?.left).toBe(EXPECTED_AT_100.left - 100);
    } finally {
      stop();
    }
  });
});

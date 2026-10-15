/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The shared rail measurement both adapters and the public hook read.

import { describe, expect, test } from 'bun:test';
import {
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
    querySelector: (selector: string) => (selector === '.docx-paginated-surface' ? surface : null),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const rail = {
    offsetParent: container,
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

  test('reports no horizontal placement before there is a page', () => {
    const { rail } = fakeRail({ surfaceRect: null });
    expect(measureReviewRailMetrics(rail, 1.5)).toEqual({
      scale: 1.5,
      top: 0,
      left: null,
      compactCardLeft: null,
    });
  });

  test('compares every field', () => {
    const base = { scale: 1, top: 2, left: 3, compactCardLeft: 4 };
    expect(sameReviewRailMetrics(base, { ...base })).toBe(true);
    expect(sameReviewRailMetrics(base, { ...base, compactCardLeft: null })).toBe(false);
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

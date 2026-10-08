// `trackWidestPage`: the settled re-read of the widest page behind the navigation shift.
// The Vue adapter carries a byte-identical copy (checked by `check:adapter-mirror`).

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import {
  WIDEST_PAGE_SETTLE_MS,
  trackWidestPage,
  type WidestPageSource,
} from '../src/editor/navigation/navigation-widest-page.ts';

function fakeSource(widths: number[]) {
  let pages = widths;
  let reads = 0;
  const listeners = new Set<() => void>();
  const source: WidestPageSource = {
    getPageGeometry() {
      reads++;
      return pages.map((width) => ({ box: { width } }));
    },
    on(_event, handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  return {
    source,
    reads: () => reads,
    listeners: () => listeners.size,
    setPages(next: number[]) {
      pages = next;
    },
    change() {
      for (const listener of [...listeners]) listener();
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('trackWidestPage', () => {
  test('reads once at start and publishes the widest page', () => {
    const fake = fakeSource([816, 1056, 816]);
    const published: Array<number | null> = [];
    trackWidestPage(fake.source, (widest) => published.push(widest));
    expect(fake.reads()).toBe(1);
    expect(published).toEqual([1056]);
  });

  test('a burst of nudges gives one re-read, after the settle time', () => {
    const fake = fakeSource([816]);
    const published: Array<number | null> = [];
    const tracker = trackWidestPage(fake.source, (widest) => published.push(widest));
    for (let step = 0; step < 5; step++) {
      tracker.nudge();
      jest.advanceTimersByTime(WIDEST_PAGE_SETTLE_MS - 1);
    }
    expect(fake.reads()).toBe(1);
    fake.setPages([816, 1056]);
    jest.advanceTimersByTime(1);
    expect(fake.reads()).toBe(2);
    expect(published).toEqual([816, 1056]);
  });

  test('a document change triggers a settled re-read', () => {
    const fake = fakeSource([816]);
    const published: Array<number | null> = [];
    trackWidestPage(fake.source, (widest) => published.push(widest));
    fake.setPages([1056]);
    fake.change();
    expect(fake.reads()).toBe(1);
    jest.advanceTimersByTime(WIDEST_PAGE_SETTLE_MS);
    expect(fake.reads()).toBe(2);
    expect(published).toEqual([816, 1056]);
  });

  test('dispose cancels a pending read, publishes nothing more, and unsubscribes', () => {
    const fake = fakeSource([816]);
    const published: Array<number | null> = [];
    const tracker = trackWidestPage(fake.source, (widest) => published.push(widest));
    expect(fake.listeners()).toBe(1);
    tracker.nudge();
    tracker.dispose();
    jest.advanceTimersByTime(WIDEST_PAGE_SETTLE_MS * 2);
    expect(fake.reads()).toBe(1);
    expect(published).toEqual([816]);
    expect(fake.listeners()).toBe(0);
    tracker.nudge();
    jest.advanceTimersByTime(WIDEST_PAGE_SETTLE_MS * 2);
    expect(fake.reads()).toBe(1);
  });

  test('answers null before the first layout', () => {
    const fake = fakeSource([]);
    const published: Array<number | null> = [];
    trackWidestPage(fake.source, (widest) => published.push(widest));
    expect(published).toEqual([null]);
  });
});

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `useReviewCardHeights` in Vue: host cards measured for `useStackedReviewPositions`. The
// React twin is in review-slot-sizing.test.tsx.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { COMMENTED_SOURCE, flush, waitFor } from './review-vue-harness.ts';
import {
  DocxEditorReview,
  useReview,
  useReviewCardHeights,
  useStackedReviewPositions,
} from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';

class ManualResizeObserver {
  static readonly all: ManualResizeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    ManualResizeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  fire() {
    const entries = [...this.targets].map((target) => ({ target }) as ResizeObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

describe('useReviewCardHeights (Vue)', () => {
  test('measures host cards, follows a resize, and stops when the host unmounts', async () => {
    const originalObserver = globalThis.ResizeObserver;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    let cardHeight = 100;
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.hostCard ? cardHeight : 0;
      },
    });
    let measured: ReturnType<typeof useReviewCardHeights> | null = null;
    let reviewRef: ReturnType<typeof useReview> | null = null;
    const HostCards = defineComponent({
      name: 'HostCards',
      setup() {
        const review = useReview();
        reviewRef = review;
        const { items } = review;
        const heights = useReviewCardHeights(items);
        measured = heights;
        const positions = useStackedReviewPositions(items, heights.heights, () => ({
          defaultHeight: 10,
        }));
        return () =>
          items.value.map((item) =>
            h('div', {
              key: item.key,
              'data-host-card': item.key,
              ref: heights.cardRef(item.key),
              style: { position: 'absolute', top: `${positions.value.get(item.key) ?? 0}px` },
            })
          );
      },
    });
    const mounted = mountEditorTree(
      () => [],
      COMMENTED_SOURCE,
      () => [h(DocxEditorReview, { preset: false }, () => [h(HostCards)])],
      [reviewModule()]
    );
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-host-card]') !== null);
      await flush();
      const key = mounted.container
        .querySelector<HTMLElement>('[data-host-card]')!
        .getAttribute('data-host-card')!;
      expect(measured!.heights.value.get(key)).toBe(100);
      expect(measured!.cardRef(key)).toBe(measured!.cardRef(key));

      cardHeight = 160;
      for (const observer of ManualResizeObserver.all) observer.fire();
      await flush();
      expect(measured!.heights.value.get(key)).toBe(160);

      // Deleting the item drops its height.
      const item = reviewRef!.items.value.find((entry) => entry.key === key)!;
      reviewRef!.remove(item);
      await flush();
      await waitFor(() => !measured!.heights.value.has(key));
      expect(measured!.heights.value.has(key)).toBe(false);

      mounted.unmount();
      expect(ManualResizeObserver.all.every((observer) => observer.targets.size === 0)).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
      globalThis.ResizeObserver = originalObserver;
    }
  });

  test('measures a card component through its root element', async () => {
    const originalObserver = globalThis.ResizeObserver;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.hostCard ? 120 : 0;
      },
    });
    const Card = defineComponent({
      name: 'Card',
      props: { itemKey: { type: String, required: true } },
      setup(props) {
        return () => h('div', { 'data-host-card': props.itemKey });
      },
    });
    let measured: ReturnType<typeof useReviewCardHeights> | null = null;
    const HostCards = defineComponent({
      name: 'HostCards',
      setup() {
        const { items } = useReview();
        measured = useReviewCardHeights();
        return () =>
          items.value.map((item) =>
            h(Card, { key: item.key, itemKey: item.key, ref: measured!.cardRef(item.key) })
          );
      },
    });
    const mounted = mountEditorTree(
      () => [],
      COMMENTED_SOURCE,
      () => [h(DocxEditorReview, { preset: false }, () => [h(HostCards)])],
      [reviewModule()]
    );
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-host-card]') !== null);
      await flush();
      const key = mounted.container
        .querySelector<HTMLElement>('[data-host-card]')!
        .getAttribute('data-host-card')!;
      expect(measured!.heights.value.get(key)).toBe(120);
    } finally {
      mounted.unmount();
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
      globalThis.ResizeObserver = originalObserver;
    }
  });
});

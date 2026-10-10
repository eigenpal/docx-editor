/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { onUnmounted, ref } from 'vue';

/** Observe rendered review cards and report their heights to the rail stacker. */
export function useReviewSlotSizing(
  measure: (key: string, height: number) => void
): (node: HTMLElement | null, key: string) => void {
  const slotSizes = ref(new WeakMap<Element, string>());
  const slotElements = ref(new Map<string, Element>());
  const sizeObserver = ref<ResizeObserver | null>(null);

  const observeSlot = (node: HTMLElement | null, key: string) => {
    const previous = slotElements.value.get(key);
    if (!node) {
      if (previous) {
        sizeObserver.value?.unobserve(previous);
        slotSizes.value.delete(previous);
        slotElements.value.delete(key);
      }
      return;
    }
    if (typeof ResizeObserver === 'undefined') return;
    measure(key, node.offsetHeight);
    sizeObserver.value ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const owner = slotSizes.value.get(entry.target);
        if (owner) measure(owner, (entry.target as HTMLElement).offsetHeight);
      }
    });
    if (previous === node && slotSizes.value.get(node) === key) return;
    if (previous) {
      sizeObserver.value.unobserve(previous);
      slotSizes.value.delete(previous);
    }
    slotSizes.value.set(node, key);
    slotElements.value.set(key, node);
    sizeObserver.value.observe(node);
  };

  onUnmounted(() => {
    sizeObserver.value?.disconnect();
    slotElements.value.clear();
  });

  return observeSlot;
}

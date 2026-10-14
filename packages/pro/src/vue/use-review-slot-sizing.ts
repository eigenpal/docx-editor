/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { onUnmounted } from 'vue';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

/** Observe rendered review cards and report their heights to the rail stacker. */
export function useReviewSlotSizing(
  measure: (key: string, height: number) => void
): (node: HTMLElement | null, key: string) => void {
  const slotSizes = new WeakMap<Element, string>();
  const slotElements = new Map<string, Element>();
  // One observer per window: an observer only reports elements in its own window's
  // documents, and a rail in a pop-out window is not in the script's.
  const sizeObservers = new Map<Window, ResizeObserver>();
  const observerFor = (node: Element): ResizeObserver | null => {
    const view = hostWindowOf(node);
    const existing = sizeObservers.get(view);
    if (existing) return existing;
    if (typeof view.ResizeObserver === 'undefined') return null;
    const observer = new view.ResizeObserver((entries) => {
      for (const entry of entries) {
        const owner = slotSizes.get(entry.target);
        if (owner) measure(owner, (entry.target as HTMLElement).offsetHeight);
      }
    });
    sizeObservers.set(view, observer);
    return observer;
  };

  const observeSlot = (node: HTMLElement | null, key: string) => {
    const previous = slotElements.get(key);
    if (!node) {
      if (previous) {
        sizeObservers.get(hostWindowOf(previous))?.unobserve(previous);
        slotSizes.delete(previous);
        slotElements.delete(key);
      }
      return;
    }
    const observer = observerFor(node);
    if (!observer) return;
    measure(key, node.offsetHeight);
    if (previous === node && slotSizes.get(node) === key) return;
    if (previous) {
      sizeObservers.get(hostWindowOf(previous))?.unobserve(previous);
      slotSizes.delete(previous);
    }
    slotSizes.set(node, key);
    slotElements.set(key, node);
    observer.observe(node);
  };

  onUnmounted(() => {
    for (const observer of sizeObservers.values()) observer.disconnect();
    sizeObservers.clear();
    slotElements.clear();
  });

  return observeSlot;
}

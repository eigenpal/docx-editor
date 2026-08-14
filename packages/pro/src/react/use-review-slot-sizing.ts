/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// ResizeObserver wiring for review-card height reporting.

import { useCallback, useEffect, useRef } from 'react';

/** Observe rendered review cards and report their heights to the rail stacker. */
export function useReviewSlotSizing(
  measure: (key: string, height: number) => void
): (node: HTMLElement | null, key: string) => void {
  const slotSizes = useRef(new WeakMap<Element, string>());
  const slotElements = useRef(new Map<string, Element>());
  const sizeObserver = useRef<ResizeObserver | null>(null);
  const observeSlot = useCallback(
    (node: HTMLElement | null, key: string) => {
      const previous = slotElements.current.get(key);
      if (!node) {
        if (previous) {
          sizeObserver.current?.unobserve(previous);
          slotSizes.current.delete(previous);
          slotElements.current.delete(key);
        }
        return;
      }
      if (typeof ResizeObserver === 'undefined') return;
      measure(key, node.offsetHeight);
      sizeObserver.current ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
          const owner = slotSizes.current.get(entry.target);
          if (owner) measure(owner, (entry.target as HTMLElement).offsetHeight);
        }
      });
      if (previous === node && slotSizes.current.get(node) === key) return;
      if (previous) {
        sizeObserver.current.unobserve(previous);
        slotSizes.current.delete(previous);
      }
      slotSizes.current.set(node, key);
      slotElements.current.set(key, node);
      sizeObserver.current.observe(node);
    },
    [measure]
  );
  useEffect(
    () => () => {
      sizeObserver.current?.disconnect();
      slotElements.current.clear();
    },
    []
  );
  return observeSlot;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// ResizeObserver wiring for review-card height reporting.

import { useCallback, useEffect, useRef } from 'react';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

/** Observe rendered review cards and report their heights to the rail stacker. */
export function useReviewSlotSizing(
  measure: (key: string, height: number) => void
): (node: HTMLElement | null, key: string) => void {
  const slotSizes = useRef(new WeakMap<Element, string>());
  const slotElements = useRef(new Map<string, Element>());
  // One observer per window: an observer only reports elements in its own window's
  // documents, and a rail in a pop-out window is not in the script's.
  const sizeObservers = useRef(new Map<Window, ResizeObserver>());
  const observerFor = useCallback(
    (node: Element): ResizeObserver | null => {
      const view = hostWindowOf(node);
      const existing = sizeObservers.current.get(view);
      if (existing) return existing;
      if (typeof view.ResizeObserver === 'undefined') return null;
      const observer = new view.ResizeObserver((entries) => {
        for (const entry of entries) {
          const owner = slotSizes.current.get(entry.target);
          if (owner) measure(owner, (entry.target as HTMLElement).offsetHeight);
        }
      });
      sizeObservers.current.set(view, observer);
      return observer;
    },
    [measure]
  );
  const observeSlot = useCallback(
    (node: HTMLElement | null, key: string) => {
      const previous = slotElements.current.get(key);
      if (!node) {
        if (previous) {
          sizeObservers.current.get(hostWindowOf(previous))?.unobserve(previous);
          slotSizes.current.delete(previous);
          slotElements.current.delete(key);
        }
        return;
      }
      const observer = observerFor(node);
      if (!observer) return;
      measure(key, node.offsetHeight);
      if (previous === node && slotSizes.current.get(node) === key) return;
      if (previous) {
        sizeObservers.current.get(hostWindowOf(previous))?.unobserve(previous);
        slotSizes.current.delete(previous);
      }
      slotSizes.current.set(node, key);
      slotElements.current.set(key, node);
      observer.observe(node);
    },
    [measure, observerFor]
  );
  useEffect(
    () => () => {
      for (const observer of sizeObservers.current.values()) observer.disconnect();
      sizeObservers.current.clear();
      slotElements.current.clear();
    },
    []
  );
  return observeSlot;
}

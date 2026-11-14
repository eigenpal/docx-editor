/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review-card height reporting, shared by the React and Vue rails (`useReviewCardHeights` in
// each adapter), which only decide when to create, disconnect and reconnect the sizer.
//
// A report is a state write in the rail, so this file reports a height only when it CHANGES.
// A framework can attach the same slot element again on every commit (a React ref callback
// that is a new function each render detaches and attaches its node), and a write on each
// attach can feed a render loop: React queues a write it cannot drop eagerly when the rail
// already has a lower-priority write pending, the higher-priority render rebases over the
// pending one, and the rail renders with a new heights map on every pass.

import { hostWindowOf, isHTMLElementNode } from '@docx-editor.dev/core/editor';

/** Reports a rendered card's height and keeps it current while the card stays mounted. */
export interface ReviewSlotSizer {
  /**
   * Attach `node` as the slot for `key`, or pass `null` to detach the key's slot. A detach
   * waits for a microtask, so a framework that detaches and attaches the same node in one
   * commit keeps the observation and reads nothing.
   */
  readonly observe: (node: HTMLElement | null, key: string) => void;
  /**
   * A ref callback for `key`: the same function each time until the key's slot is released,
   * so a framework does not detach and attach the slot on every render. It takes an element,
   * or a Vue component instance whose root (`$el`) is an element.
   */
  readonly slotRef: (key: string) => (node: unknown) => void;
  /**
   * Stop all observation and keep the attached slots, so `reconnect` can observe them again.
   * A React StrictMode remount runs effect cleanup without detaching refs.
   */
  readonly disconnect: () => void;
  /** Observe the attached slots again after `disconnect`, and report changed heights. */
  readonly reconnect: () => void;
  /**
   * Forget every key that is not in `keys` and has no attached slot: its last height and its
   * ref callback. Answers the forgotten keys that had a height, so the caller can drop them
   * from its own heights too. A key in `keys` keeps its height while its card is unmounted.
   */
  readonly retain: (keys: ReadonlySet<string>) => readonly string[];
}

const BORDER_BOX: ResizeObserverOptions = { box: 'border-box' };

/** The element a ref hands over: the node itself, or a component instance's root element. */
function slotElementOf(node: unknown): HTMLElement | null {
  if (isHTMLElementNode(node)) return node;
  const root = node !== null && typeof node === 'object' ? (node as { $el?: unknown }).$el : null;
  return isHTMLElementNode(root) ? root : null;
}

/**
 * Create a sizer that calls `report(key, height)` with each slot's border-box height in CSS
 * pixels, once when it is first attached and again each time it changes. A zero height is
 * never reported: a real card is never 0px tall, so zero is a read without layout.
 */
export function createReviewSlotSizer(
  report: (key: string, height: number) => void
): ReviewSlotSizer {
  const owners = new WeakMap<Element, string>();
  const elements = new Map<string, HTMLElement>();
  // The observer that watches each element. Release unobserves through it, so a node that
  // moved to another window still leaves the observer that had it.
  const observedBy = new WeakMap<Element, ResizeObserver>();
  const refs = new Map<string, (node: unknown) => void>();
  // The last height reported for each key. It outlives the slot on purpose: a card that
  // virtualization unmounts keeps its height in the rail, so its return reports nothing new.
  const reported = new Map<string, number>();
  // One observer per window: an observer only reports elements in its own window's
  // documents, and a rail in a pop-out window is not in the script's.
  const observers = new Map<Window, ResizeObserver>();
  const pendingRelease = new Set<string>();
  let releaseQueued = false;
  let disconnected = false;

  const send = (key: string, height: number): void => {
    if (!(height > 0) || reported.get(key) === height) return;
    reported.set(key, height);
    report(key, height);
  };

  const observerFor = (node: Element): ResizeObserver | null => {
    const view = hostWindowOf(node);
    const existing = observers.get(view);
    if (existing) return existing;
    if (typeof view.ResizeObserver === 'undefined') return null;
    const observer = new view.ResizeObserver((entries) => {
      for (const entry of entries) {
        const owner = owners.get(entry.target);
        if (owner !== undefined && elements.get(owner) === entry.target) {
          send(owner, (entry.target as HTMLElement).offsetHeight);
        }
      }
    });
    observers.set(view, observer);
    return observer;
  };

  const watch = (node: HTMLElement): void => {
    if (disconnected) return;
    const observer = observerFor(node);
    if (!observer) return;
    const previous = observedBy.get(node);
    if (previous === observer) return;
    previous?.unobserve(node);
    observedBy.set(node, observer);
    // The border box, because `offsetHeight` is what the rail stacks by: a padding change
    // alone leaves the content box as it was and would report nothing.
    observer.observe(node, BORDER_BOX);
  };

  const release = (key: string): void => {
    const element = elements.get(key);
    if (!element) return;
    elements.delete(key);
    if (owners.get(element) !== key) return;
    owners.delete(element);
    observedBy.get(element)?.unobserve(element);
    observedBy.delete(element);
  };

  const flushReleases = (): void => {
    releaseQueued = false;
    for (const key of pendingRelease) {
      release(key);
      refs.delete(key);
    }
    pendingRelease.clear();
  };

  const observe = (node: HTMLElement | null, key: string): void => {
    if (!node) {
      // Nothing attached under this key, such as a component without one root element: drop
      // the callback rather than keep it for the life of the sizer.
      if (!elements.has(key)) {
        refs.delete(key);
        return;
      }
      pendingRelease.add(key);
      if (!releaseQueued) {
        releaseQueued = true;
        queueMicrotask(flushReleases);
      }
      return;
    }
    pendingRelease.delete(key);
    // Already the slot for this key: the observer reports any change, so a re-attach reads
    // no layout and reports nothing. It only moves the node to its window's observer.
    if (elements.get(key) === node && owners.get(node) === key) {
      watch(node);
      return;
    }
    const formerOwner = owners.get(node);
    if (formerOwner !== undefined && formerOwner !== key) {
      pendingRelease.delete(formerOwner);
      elements.delete(formerOwner);
      refs.delete(formerOwner);
    }
    release(key);
    send(key, node.offsetHeight);
    owners.set(node, key);
    elements.set(key, node);
    watch(node);
  };

  const slotRef = (key: string): ((node: unknown) => void) => {
    let ref = refs.get(key);
    if (!ref) {
      ref = (node) => observe(slotElementOf(node), key);
      refs.set(key, ref);
    }
    return ref;
  };

  const disconnect = (): void => {
    disconnected = true;
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
  };

  const reconnect = (): void => {
    if (!disconnected) return;
    disconnected = false;
    for (const [key, element] of elements) {
      observedBy.delete(element);
      send(key, element.offsetHeight);
      watch(element);
    }
  };

  // A slot whose detach waits for its microtask is gone already: the commit that removed it
  // has finished by the time a caller retains.
  const attached = (key: string): boolean => elements.has(key) && !pendingRelease.has(key);

  const retain = (keys: ReadonlySet<string>): readonly string[] => {
    const forgotten: string[] = [];
    for (const key of reported.keys()) {
      if (keys.has(key) || attached(key)) continue;
      reported.delete(key);
      forgotten.push(key);
      // Release a waiting detach now: a re-attach of the same node must report its height
      // again, since the caller drops it.
      if (pendingRelease.delete(key)) release(key);
    }
    for (const key of refs.keys()) {
      if (!keys.has(key) && !attached(key)) refs.delete(key);
    }
    return forgotten;
  };

  return { observe, slotRef, disconnect, reconnect, retain };
}

/** `heights` without `keys`, or `heights` itself when it holds none of them. */
export function withoutKeys(
  heights: ReadonlyMap<string, number>,
  keys: readonly string[]
): ReadonlyMap<string, number> {
  let next: Map<string, number> | null = null;
  for (const key of keys) {
    if (!heights.has(key)) continue;
    next ??= new Map(heights);
    next.delete(key);
  }
  return next ?? heights;
}

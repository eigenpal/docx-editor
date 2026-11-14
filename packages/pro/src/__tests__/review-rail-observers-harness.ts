/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shared by review-rail-observers.test.tsx and its Vue twin. Install the rail geometry from
// review-rail-metrics-harness.ts first.

/** A scroll container with the pages and a column, counting surface rect reads. */
export function railScene() {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const mount = document.createElement('div');
  mount.className = 'docx-content-mount';
  const surface = document.createElement('div');
  surface.className = 'docx-paginated-surface';
  mount.append(surface);
  const column = document.createElement('div');
  column.style.position = 'absolute';
  scroller.append(mount, column);
  document.body.append(scroller);
  let reads = 0;
  const read = surface.getBoundingClientRect.bind(surface);
  surface.getBoundingClientRect = () => {
    reads += 1;
    return read();
  };
  return { column, scale: 96 / 72, reads: () => reads };
}

/** Count the ResizeObservers built and disconnected on this window until `restore()`. */
export function countRailObservers() {
  const Native = window.ResizeObserver;
  const counter = { constructed: 0, disconnected: 0, restore: () => {} };
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      counter.constructed += 1;
    }
    override disconnect(): void {
      counter.disconnected += 1;
      super.disconnect();
    }
  };
  counter.restore = () => {
    window.ResizeObserver = Native;
  };
  return counter;
}

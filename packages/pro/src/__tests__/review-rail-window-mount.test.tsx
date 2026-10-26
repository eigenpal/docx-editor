/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review rail's visible band, from the rail's first render.
//
// The rail renders only the cards inside the band, and a null band renders every card. The
// band was null until an effect measured the scroller, so a rail that mounted beside a document
// with thousands of tracked changes built, measured and dropped thousands of cards in its first
// commit. The band now starts empty, and the first measure runs before the rail paints.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useLayoutEffect, useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { useRailWindow } from '../react/use-rail-window.ts';

afterEach(cleanup);

type Band = { top: number; bottom: number } | null;

/**
 * A rail inside a scroller, recording the band of each commit. `attached={false}` is a host
 * rail element that never reaches the ref, as an `asChild` child that does not forward it.
 */
function Rail({
  commits,
  scroller,
  attached = true,
}: {
  commits: Band[];
  scroller: boolean;
  attached?: boolean;
}) {
  const railRef = useRef<HTMLElement | null>(null);
  const band = useRailWindow({}, railRef, true);
  useLayoutEffect(() => {
    commits.push(band);
  });
  const rail = <aside ref={attached ? railRef : undefined} data-testid="rail" />;
  return scroller ? <div data-testid="scroller">{rail}</div> : rail;
}

/** happy-dom lays nothing out: give the rail its scroller and the scroller a height. */
function withScroller(run: () => void, scroller: boolean): void {
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return scroller && this.dataset.testid === 'rail' ? this.parentElement : null;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 900,
  });
  try {
    run();
  } finally {
    for (const [name, descriptor] of [
      ['offsetParent', offset],
      ['clientHeight', height],
    ] as const) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  }
}

const covers = (band: Band, y: number) => band === null || (y >= band.top && y <= band.bottom);

describe('the review rail band', () => {
  test('holds no card before the first measure, then the visible band', () => {
    const commits: Band[] = [];
    withScroller(() => render(<Rail commits={commits} scroller />), true);
    // No commit renders every card: the first one holds none, and the measured band follows.
    expect(commits.every((band) => band !== null)).toBe(true);
    expect(covers(commits[0]!, 0)).toBe(false);
    expect(covers(commits.at(-1)!, 0)).toBe(true);
    expect(covers(commits.at(-1)!, 100_000)).toBe(false);
  });

  test('renders every card when the rail has no scroller', () => {
    const commits: Band[] = [];
    withScroller(() => render(<Rail commits={commits} scroller={false} />), false);
    expect(commits.at(-1)).toBeNull();
  });

  test('renders every card when the rail element never reaches the ref', () => {
    const commits: Band[] = [];
    withScroller(() => render(<Rail commits={commits} scroller attached={false} />), true);
    expect(commits.at(-1)).toBeNull();
  });
});

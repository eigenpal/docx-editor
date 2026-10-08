/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Where a review balloon stands: at the inline start of its change, inside the visible width
// of the scroll container, and on the change's current painted site after a repaint. The Vue
// adapter ships the same module byte for byte (`check:adapter-mirror`).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import {
  BALLOON_EDGE_PX,
  anchorFromRevisionElement,
  balloonBox,
  remeasureBalloonAnchor,
  type BalloonAnchor,
} from '../react/review-balloon-anchor.ts';

const base: BalloonAnchor = {
  revisionId: '1',
  author: 'Ada Lovelace',
  structuralSite: false,
  left: 100,
  right: 140,
  top: 40,
  bottom: 56,
  above: false,
  rtl: false,
  visibleLeft: 0,
  visibleRight: 1200,
};

describe('balloonBox', () => {
  test('starts at the left edge of a left-to-right change', () => {
    expect(balloonBox(base, 280)).toEqual({ left: 100, width: 280 });
  });

  test('moves inward near the right edge of the visible width', () => {
    const box = balloonBox({ ...base, left: 1100, right: 1140 }, 280);
    expect(box).toEqual({ left: 1200 - BALLOON_EDGE_PX - 280, width: 280 });
  });

  test('narrows to the visible width on a narrow viewport', () => {
    const box = balloonBox({ ...base, left: 200, right: 240, visibleRight: 260 }, 280);
    expect(box.width).toBe(260 - 2 * BALLOON_EDGE_PX);
    expect(box.left).toBe(BALLOON_EDGE_PX);
  });

  test('stays inside a visible box that starts right of the rail origin', () => {
    const box = balloonBox({ ...base, left: 20, right: 60, visibleLeft: 50 }, 280);
    expect(box.left).toBe(50 + BALLOON_EDGE_PX);
  });

  test('ends at the right edge of a right-to-left change', () => {
    const box = balloonBox({ ...base, left: 600, right: 700, rtl: true }, 280);
    expect(box).toEqual({ left: 420, width: 280 });
  });
});

describe('measuring the painted site', () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const run of cleanup.splice(0)) run();
  });

  function scene(direction: 'ltr' | 'rtl' = 'ltr') {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const rail = document.createElement('div');
    const page = document.createElement('div');
    scroller.append(rail, page);
    document.body.append(scroller);
    cleanup.push(() => scroller.remove());
    let siteLeft = 100;
    const paint = (): HTMLElement => {
      page.replaceChildren();
      const span = document.createElement('span');
      span.dataset.revisionId = '1';
      span.dataset.reviewAuthor = 'Ada Lovelace';
      span.dataset.paragraphId = 'p1';
      span.dataset.start = '5';
      span.style.direction = direction;
      const left = siteLeft;
      span.getBoundingClientRect = () =>
        ({ left, right: left + 40, top: 40, bottom: 56, width: 40, height: 16 }) as DOMRect;
      page.append(span);
      return span;
    };
    scroller.getBoundingClientRect = () =>
      ({ left: 0, right: 900, top: 0, bottom: 600, width: 900, height: 600 }) as DOMRect;
    rail.getBoundingClientRect = () =>
      ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
    return {
      scroller,
      rail,
      paint,
      move(next: number) {
        siteLeft = next;
      },
    };
  }

  test('reads the site box, the visible width, and the text direction', () => {
    const { rail, paint } = scene('rtl');
    const anchor = anchorFromRevisionElement(paint(), rail, false);
    expect(anchor).toMatchObject({ left: 100, right: 140, visibleLeft: 0, visibleRight: 900 });
    expect(anchor.rtl).toBe(true);
  });

  test('a repaint that moves the site moves the balloon; no move keeps the same object', () => {
    const { scroller, rail, paint, move } = scene();
    const anchor = anchorFromRevisionElement(paint(), rail, false);
    // Repaint at the same place: a new element, the same geometry.
    paint();
    expect(remeasureBalloonAnchor(anchor, scroller, rail, null)).toBe(anchor);
    // Repaint after an edit or a zoom moved the text.
    move(260);
    paint();
    const moved = remeasureBalloonAnchor(anchor, scroller, rail, null);
    expect(moved).not.toBe(anchor);
    expect(moved.left).toBe(260);
    // A site that is not painted keeps the last position rather than jumping.
    scroller.querySelector('[data-revision-id]')!.remove();
    expect(remeasureBalloonAnchor(moved, scroller, rail, null)).toBe(moved);
  });
});

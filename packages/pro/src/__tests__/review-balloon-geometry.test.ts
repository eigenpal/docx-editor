/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { describe, expect, test } from 'bun:test';
import { placeReviewBalloon, type BalloonRect } from '../review/balloon-geometry.ts';

const rail: BalloonRect = { left: 500, right: 800, top: 0, bottom: 1000 };
const viewport: BalloonRect = { left: 100, right: 600, top: 50, bottom: 450 };

describe('review balloon geometry', () => {
  test('keeps the full card inside an embedded scroll viewport', () => {
    const rightEdge = placeReviewBalloon(
      { left: 550, right: 570, top: 200, bottom: 220 },
      rail,
      viewport
    );
    expect(rightEdge.left).toBe(-192);

    const leftEdge = placeReviewBalloon(
      { left: 0, right: 20, top: 200, bottom: 220 },
      rail,
      viewport
    );
    expect(leftEdge.left).toBe(-388);
  });

  test('uses the editor viewport to select the vertical side', () => {
    expect(
      placeReviewBalloon({ left: 300, right: 320, top: 300, bottom: 320 }, rail, viewport).above
    ).toBe(true);

    expect(
      placeReviewBalloon({ left: 300, right: 320, top: 80, bottom: 100 }, rail, viewport).above
    ).toBe(false);
  });

  test('uses the roomier side when neither side fits the estimate', () => {
    expect(
      placeReviewBalloon({ left: 300, right: 320, top: 170, bottom: 190 }, rail, {
        left: 100,
        right: 600,
        top: 100,
        bottom: 280,
      }).above
    ).toBe(false);
  });
});

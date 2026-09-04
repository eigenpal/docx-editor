/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/** The part of a client rect needed to position a review balloon. */
export interface BalloonRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The balloon position in rail-local coordinates. */
export interface BalloonPlacement {
  readonly left: number;
  readonly above: boolean;
}

/** A scroll viewport that can publish its visible client box. */
export interface BalloonViewport {
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getBoundingClientRect(): BalloonRect;
}

/** Matches `.docx-review__balloon` in the shared editor stylesheet. */
const BALLOON_WIDTH = 280;
/** Keeps the floating card clear of the scroll viewport's edges. */
const BALLOON_INSET = 12;
/** Approximate card height used only to select the better vertical side. */
const BALLOON_ESTIMATED_HEIGHT = 220;

/**
 * Place a review balloon inside an editor's visible scroll viewport.
 *
 * The rail and anchor can extend outside that viewport. This is common in embedded editors
 * that cannot reserve the full review column. The horizontal clamp keeps the complete card
 * visible. The vertical choice uses the editor viewport, not the browser window.
 */
export function placeReviewBalloon(
  anchor: BalloonRect,
  rail: BalloonRect,
  viewport: BalloonRect
): BalloonPlacement {
  const minimumLeft = viewport.left - rail.left + BALLOON_INSET;
  const maximumLeft = viewport.right - rail.left - BALLOON_INSET - BALLOON_WIDTH;
  const desiredLeft = anchor.left - rail.left;
  const left =
    maximumLeft < minimumLeft
      ? minimumLeft
      : Math.min(Math.max(desiredLeft, minimumLeft), maximumLeft);

  const roomAbove = anchor.top - viewport.top;
  const roomBelow = viewport.bottom - anchor.bottom;
  const above =
    roomBelow < BALLOON_ESTIMATED_HEIGHT &&
    (roomAbove >= BALLOON_ESTIMATED_HEIGHT || roomAbove > roomBelow);

  return { left, above };
}

/** Place a review balloon from a scroll element's visible client box. */
export function placeReviewBalloonInViewport(
  anchor: BalloonRect,
  rail: BalloonRect,
  viewport: BalloonViewport
): BalloonPlacement {
  const box = viewport.getBoundingClientRect();
  const left = box.left + viewport.clientLeft;
  const top = box.top + viewport.clientTop;
  return placeReviewBalloon(anchor, rail, {
    left,
    right: left + viewport.clientWidth,
    top,
    bottom: top + viewport.clientHeight,
  });
}

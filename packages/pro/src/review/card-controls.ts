/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * The controls inside a review card that handle their own presses: the packaged ones, and
 * anything a host passes in as a card child. A click on one must not activate the card.
 */
export const CARD_OWN_CONTROLS =
  'a[href], button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), ' +
  '.docx-review__reply-box';

/** True when a click on `target` belongs to a control inside the card, not to the card. */
export function isCardControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CARD_OWN_CONTROLS) !== null;
}

/**
 * True when a mousedown on `target` must leave focus where the browser puts it: a control,
 * or card text the reader may be selecting. Refocusing the card there would blur the host's
 * input or drop the selection.
 */
export function keepsPressFocus(target: EventTarget | null): boolean {
  return (
    isCardControl(target) ||
    (target instanceof Element && target.closest('[data-review-selectable]') !== null)
  );
}

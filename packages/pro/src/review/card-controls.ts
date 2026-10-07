/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * What inside a review card handles its own presses: the packaged controls, and anything a
 * host passes in as a card child. A press here must not refocus the card (that blurs the
 * host's input) or re-activate it.
 */
export const CARD_OWN_CONTROLS =
  'a[href], button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), ' +
  '.docx-review__reply-box, [data-review-selectable]';

/** True when a press on `target` belongs to a control inside the card, not to the card. */
export function isCardControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CARD_OWN_CONTROLS) !== null;
}

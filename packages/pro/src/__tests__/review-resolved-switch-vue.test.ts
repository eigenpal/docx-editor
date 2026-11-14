/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of review-resolved-switch.test.tsx.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { flush, mountReview, waitFor } from './review-vue-harness.ts';
import { openSecondWhileFirstOpen, TWO_RESOLVED_COMMENTS } from './review-resolved-pair-fixture.ts';

test('opening a second resolved card from the keyboard keeps it open', async () => {
  const mounted = mountReview(TWO_RESOLVED_COMMENTS);
  try {
    const cards = () => [
      ...mounted.container.querySelectorAll<HTMLDetailsElement>('[data-testid="review-card"]'),
    ];
    await waitFor(() => cards().length === 2);
    cards()[0]!
      .querySelector<HTMLElement>('.docx-review__resolved-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(cards()[0]!.open).toBe(true);

    await openSecondWhileFirstOpen(cards, flush);

    expect(cards()[0]!.open).toBe(false);
    expect(cards()[1]!.open).toBe(true);
    expect(cards()[1]!.hasAttribute('data-active')).toBe(true);
  } finally {
    mounted.unmount();
  }
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { flush, mountReview } from './review-vue-harness.ts';

test('names the nested review region without adding a complementary landmark', async () => {
  const mounted = mountReview();
  try {
    await flush();
    const region = mounted.container.querySelector('[data-testid="review-rail"]')!;
    expect(region.tagName).toBe('ASIDE');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Review');
    expect(region.closest('[data-testid="docx-editor-scroll"]')).not.toBeNull();
    expect(mounted.container.querySelector('[role="complementary"]')).toBeNull();
  } finally {
    mounted.unmount();
  }
});

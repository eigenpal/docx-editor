/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { test } from 'bun:test';
import { mountReview, flush } from './review-vue-harness.ts';
import { source, checkFormattingPageBalloons } from './formatting-page-balloon-harness.ts';

test('Vue: paragraph and empty-mark formatting opens page balloons without sidebar cards or pilcrows', async () => {
  const mounted = mountReview(source);
  try {
    await flush();
    await checkFormattingPageBalloons(mounted.container, mounted.editor(), async (run) => {
      run();
      await flush();
    });
  } finally {
    mounted.unmount();
  }
});

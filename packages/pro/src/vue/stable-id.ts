/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { getCurrentInstance } from 'vue';

const appCounters = new WeakMap<object, number>();

/** Stable, hydration-safe id for review chrome controls (Vue 3.3+). */
export function useReviewStableId(suffix: string): string {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('useReviewStableId must run during component setup');
  }
  const appContext = instance.appContext;
  const sequence = appCounters.get(appContext) ?? 0;
  appCounters.set(appContext, sequence + 1);
  return `docx-review-${sequence}-${suffix}`;
}

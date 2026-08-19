/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { expect } from 'bun:test';
import type { App } from 'vue';

export interface VueWarningTracker {
  refOwnerWarnings(): string[];
  all(): string[];
}

export function trackVueWarnings(app: App): VueWarningTracker {
  const warnings: string[] = [];
  const prior = app.config.warnHandler;
  app.config.warnHandler = (message, ...args) => {
    warnings.push(typeof message === 'string' ? message : String(message));
    prior?.(message, ...args);
  };
  return {
    refOwnerWarnings: () => warnings.filter((message) => message.includes('Missing ref owner')),
    all: () => [...warnings],
  };
}

export function assertNoRefOwnerWarnings(tracker: VueWarningTracker): void {
  expect(tracker.refOwnerWarnings()).toEqual([]);
}

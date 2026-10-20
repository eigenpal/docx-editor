/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The documented call, `sentryExporter(Sentry)`, must type-check against a real Sentry SDK
// module. Every browser and Node SDK re-exports these functions from `@sentry/core`.
import { expect, test } from 'bun:test';
import * as Sentry from '@sentry/core';
import { dropEditorBreadcrumbs, EDITOR_SELECTORS, sentryExporter } from '../sentry/index.ts';

test('a Sentry SDK module is a SentryLike', () => {
  expect(sentryExporter(Sentry).name).toBe('sentry');
});

test('dropEditorBreadcrumbs is a Sentry beforeBreadcrumb', () => {
  const options: Pick<Sentry.Options, 'beforeBreadcrumb'> = {
    beforeBreadcrumb: dropEditorBreadcrumbs,
  };
  expect(options.beforeBreadcrumb).toBe(dropEditorBreadcrumbs);
});

test('dropEditorBreadcrumbs drops clicks inside the editor and keeps the rest', () => {
  const inside = {
    closest: (selectors: string) => (selectors.includes('.docx-pages') ? {} : null),
  };
  const outside = { closest: () => null };
  const text = { parentElement: inside };
  const click = { category: 'ui.click', message: 'img[alt="Merger structure"]' };
  expect(dropEditorBreadcrumbs(click, { event: { target: inside } })).toBeNull();
  expect(dropEditorBreadcrumbs(click, { event: { target: text } })).toBeNull();
  expect(dropEditorBreadcrumbs(click, {})).toBeNull();
  expect(dropEditorBreadcrumbs(click, { event: { target: outside } })).toBe(click);
  const fetch = { category: 'fetch' };
  expect(dropEditorBreadcrumbs(fetch, { event: { target: inside } })).toBe(fetch);
  expect(EDITOR_SELECTORS).toContain('.docx-editor');
});

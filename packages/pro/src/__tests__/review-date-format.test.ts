/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { reviewDateFormat } from '../review/review-date-format.ts';

const when = new Date(Date.UTC(2026, 9, 25, 9, 5));
const browser = () => new Intl.DateTimeFormat().resolvedOptions().locale;

test('a translated rail formats dates in its language', () => {
  expect(reviewDateFormat('ar').resolvedOptions().locale).toStartWith('ar');
  expect(reviewDateFormat('ar').format(when)).not.toMatch(/Oct/u);
  expect(reviewDateFormat('ar')).toBe(reviewDateFormat('ar'));
});

test('the default English catalog keeps the browser locale', () => {
  expect(reviewDateFormat('en').resolvedOptions().locale).toBe(browser());
});

test('an invalid language tag falls back to the browser locale', () => {
  expect(reviewDateFormat('not a tag!').resolvedOptions().locale).toBe(browser());
});

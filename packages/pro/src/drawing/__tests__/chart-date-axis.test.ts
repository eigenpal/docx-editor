/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A date axis steps by its base time unit, so months and years sit at even steps.

import { expect, test } from 'bun:test';
import { categoryPosition, categorySlot, timeUnitPositions } from '../chart-axes.ts';
import type { ChartAxis } from '../chart-model.ts';

// 1 January, 1 February and 1 March 2023 as 1900-system serials.
const MONTHLY = [44927, 44958, 44986];
const axis = (baseTimeUnit: ChartAxis['baseTimeUnit']) => ({ baseTimeUnit }) as ChartAxis;

test('a monthly axis places each month one step apart', () => {
  const months = timeUnitPositions(MONTHLY, axis('months'), false);
  expect(months.map((month) => month - months[0]!)).toEqual([0, 1, 2]);
  const info = { axis: null, count: 3, labels: [], serials: months, between: true };
  expect(categoryPosition(info, 0, 0, 300)).toBeCloseTo(50, 6);
  expect(categoryPosition(info, 2, 0, 300)).toBeCloseTo(250, 6);
  expect(categorySlot(info, 300)).toBeCloseTo(100, 6);
});

test('without a base unit the largest unit that separates the dates picks it', () => {
  expect(timeUnitPositions(MONTHLY, axis(null), false)).toEqual(
    timeUnitPositions(MONTHLY, axis('months'), false)
  );
  expect(timeUnitPositions([44927, 44928], axis(null), false)).toEqual([44927, 44928]);
});

test('dates four weeks apart stay on a day scale, so no two share a slot', () => {
  const fourWeekly = [45292, 45320, 45348, 45376];
  expect(new Set(timeUnitPositions(fourWeekly, axis(null), false)).size).toBe(4);
  // Yearly data with a 365-day step in a leap year keeps one year per slot.
  expect(timeUnitPositions([45292, 45658, 46023], axis(null), false)).toEqual([2024, 2025, 2026]);
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { MAX_OPERATIONS, MAX_OUTPUT_BYTES, PdfWorkLimitError, Work } from '../src/context.ts';

function ticksUntilLimit(work: Work, cap: number): number {
  for (let count = 1; count <= cap; count += 1) {
    try {
      work.tick();
    } catch (error) {
      expect(error).toBeInstanceOf(PdfWorkLimitError);
      return count;
    }
  }
  return Infinity;
}

describe('PDF work budgets', () => {
  test('a short document keeps the fixed budgets', () => {
    const work = new Work(new AbortController().signal);
    work.allowPages(25);
    expect(ticksUntilLimit(work, MAX_OPERATIONS + 1)).toBe(MAX_OPERATIONS + 1);
    expect(() => work.reserveContent(MAX_OUTPUT_BYTES + 1)).toThrow(PdfWorkLimitError);
  });

  test('a long document gets a budget for each page', () => {
    const work = new Work(new AbortController().signal);
    work.allowPages(1_400);
    for (let count = 0; count < MAX_OPERATIONS + 1_000; count += 1) work.tick();
    work.reserveContent(MAX_OUTPUT_BYTES * 2);
    expect(ticksUntilLimit(work, 10_000_000)).toBe(1_400 * 6_000 - MAX_OPERATIONS - 1_000 + 1);
  });

  test('the per-page budgets stop at a ceiling', () => {
    const work = new Work(new AbortController().signal);
    work.allowPages(1_000_000);
    expect(() => work.reserveContent(8 * MAX_OUTPUT_BYTES + 1)).toThrow(PdfWorkLimitError);
  });
});

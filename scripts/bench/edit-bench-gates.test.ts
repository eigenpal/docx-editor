import { expect, test } from 'bun:test';
import { cache, runBench, workByName, type Work } from './edit-bench-gates-shared';

// 200-page, 4-section committed fixture: every editing scenario — including the two
// structural keyboard edits, Enter and Backspace-join — stays bounded, and the break
// cache survives across passes (nonzero hits, zero evictions). The cold pass checks the
// terminal section mark ahead of placement, which adds one hit. Edit-pass work is unchanged.
const EXPECTED_DEFAULT: Readonly<Record<string, Work>> = {
  'steady-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3201, 3201),
  },
  'wrap-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3201, 3201),
  },
  'forced-middle-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3201, 3201),
  },
  'forced-early-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 155,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3201, 3201),
  },
  'enter-split-middle': {
    placed: 14,
    total: 3201,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3202, 3202),
  },
  'backspace-join-middle': {
    placed: 12,
    total: 3199,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3201, 3201),
  },
  'enter-split-early': {
    placed: 14,
    total: 3201,
    reusedPages: 155,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(13, 3202, 3202),
  },
  'page-break-middle': {
    placed: 13,
    total: 3200,
    reusedPages: 99,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 205,
    cache: cache(13, 3201, 3201),
  },
};

test('long-document edit work stays bounded', () => {
  const report = runBench(null);
  expect(report.fixtureSha256).toBe(
    'ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321'
  );
  expect(workByName(report)).toEqual(EXPECTED_DEFAULT);
}, 120_000);

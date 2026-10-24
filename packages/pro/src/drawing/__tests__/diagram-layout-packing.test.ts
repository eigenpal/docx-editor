/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How hierarchies pack their subtrees and how lists grow boxes their line scaled down,
// against the drawings saved for synthetic diagrams.

import { describe, expect, test } from 'bun:test';
import { loadLayoutFixtures, scoreCase } from './smartart-layout-harness.ts';

const fixtures = loadLayoutFixtures(
  new URL('./fixtures/smartart-layout-cases.json.gz', import.meta.url).pathname
);

function score(id: string) {
  const item = fixtures.cases.find((entry) => entry.id === id);
  if (!item) throw new Error(`no fixture ${id}`);
  return scoreCase(fixtures, item);
}

describe('SmartArt hierarchy packing', () => {
  // A leaf sibling nests beside a deeper subtree's children instead of below them.
  for (const id of ['probe-p6-horg-nest-1', 'probe-p6-horg-nest2-1', 'probe-p6-hier1-nest-1']) {
    test(`${id} places every box where the saved drawing does`, () => {
      const result = score(id);
      expect(result.misses).toEqual([]);
      expect(result.boxes).toBe(result.shapes);
    });
  }
});

describe('SmartArt list growth', () => {
  // Custom text sizes: the unbounded heights grow in the units the line scales down.
  for (const id of ['probe-p6-vlist2-cust-1', 'probe-p6-vlist2-cust2-1']) {
    test(`${id} sizes each box for its text`, () => {
      const result = score(id);
      expect(result.misses).toEqual([]);
    });
  }
});

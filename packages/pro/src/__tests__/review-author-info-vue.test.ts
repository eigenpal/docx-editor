/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The author entries the rail builds for authors outside the roster: kept while the queue
// needs them, dropped once the author leaves the queue or joins the roster.

import { expect, test } from 'bun:test';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import { resolveReviewAuthorInfo } from '../vue/review-author-styles.ts';

type Item = Parameters<typeof resolveReviewAuthorInfo>[1][number];
const item = (author: string) => ({ author }) as Item;

test('built author entries follow the queue and the roster', () => {
  const synthetic = new Map<string, ReviewAuthorInfo>();
  const slots = new Map([['Grace', 1]]);
  const first = resolveReviewAuthorInfo([], [item('Grace')], slots, null, synthetic);
  expect(synthetic.get('Grace')).toBe(first.get('Grace'));
  // The same values answer the same entry.
  const again = resolveReviewAuthorInfo([], [item('Grace')], slots, null, synthetic);
  expect(again.get('Grace')).toBe(first.get('Grace'));

  const rostered: ReviewAuthorInfo = { author: 'Grace', slot: 1, color: 'red' };
  const withRoster = resolveReviewAuthorInfo([rostered], [item('Grace')], slots, null, synthetic);
  expect(withRoster.get('Grace')).toBe(rostered);
  expect(synthetic.has('Grace')).toBe(false);

  resolveReviewAuthorInfo([], [item('Grace')], slots, null, synthetic);
  resolveReviewAuthorInfo([], [], slots, null, synthetic);
  expect(synthetic.size).toBe(0);
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `useReview().adopt`: a reviewer adopts tracked changes as their own, and they stay pending.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { useReviewOf, type UseReviewReturn } from '../react/useReview.ts';
import {
  destroyTrackedEditors,
  mountTrackedEditor,
  revisionAuthors,
} from './review-adopt-support.ts';

afterEach(() => {
  cleanup();
  destroyTrackedEditors();
});

function probe(editor: ReturnType<typeof mountTrackedEditor>): () => UseReviewReturn {
  let review!: UseReviewReturn;
  function Probe() {
    review = useReviewOf(editor);
    return null;
  }
  render(<Probe />);
  return () => review;
}

test('adopt records the editor author, in one undo step per call', async () => {
  const editor = mountTrackedEditor('Ada');
  const review = probe(editor);

  let landed = false;
  await act(async () => {
    landed = review().adopt(
      review().items.filter((item) => item.kind === 'revision' && item.author === 'AI')
    );
  });
  expect(landed).toBe(true);
  expect(revisionAuthors(review().items)).toEqual(['Ada', 'Ada', 'Grace']);

  // One card, an explicit author.
  await act(async () => {
    landed = review().adopt(review().items[2]!, { author: 'Lin' });
  });
  expect(landed).toBe(true);
  expect(revisionAuthors(review().items)).toEqual(['Ada', 'Ada', 'Lin']);

  await act(async () => {
    editor.exec({ type: 'undo' });
  });
  expect(revisionAuthors(review().items)).toEqual(['Ada', 'Ada', 'Grace']);
  await act(async () => {
    editor.exec({ type: 'undo' });
  });
  expect(revisionAuthors(review().items)).toEqual(['AI', 'AI', 'Grace']);

  expect(review().adopt([])).toBe(false);
});

test('adopt reports false when no author is known', () => {
  const editor = mountTrackedEditor();
  const review = probe(editor);
  expect(review().adopt(review().items)).toBe(false);
  expect(revisionAuthors(review().items)).toEqual(['AI', 'AI', 'Grace']);
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-adopt.test.tsx`: the same `adopt` contract.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { useReviewOf, type UseReviewReturn } from '../vue/useReview.ts';
import {
  destroyTrackedEditors,
  mountTrackedEditor,
  revisionAuthors,
} from './review-adopt-support.ts';

afterEach(() => destroyTrackedEditors());

test('adopt records the editor author, or the author and date passed', async () => {
  const editor = mountTrackedEditor('Ada');
  const editorRef = shallowRef<DocxEditorInstance | null>(editor);
  let review!: UseReviewReturn;
  const Probe = defineComponent({
    setup() {
      review = useReviewOf(editorRef);
      return () => h('div');
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(Probe);
  app.mount(container);
  try {
    const ai = review.items.value.filter(
      (item) => item.kind === 'revision' && item.author === 'AI'
    );
    expect(review.adopt(ai)).toBe(true);
    expect(review.adopt(review.items.value[2]!, { author: 'Lin' })).toBe(true);
    expect(revisionAuthors(editor.getReviewItems())).toEqual(['Ada', 'Ada', 'Lin']);
    // Keys include the author, so read the refreshed items before the next call.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await nextTick();
    const date = new Date('2026-10-08T09:30:00Z');
    expect(review.adopt(review.items.value[0]!, { date })).toBe(true);
    const first = editor.getReviewItems()[0]!;
    expect(first.kind === 'revision' && first.date).toBe(date.toISOString());
    expect(review.adopt(review.items.value[0]!, { date: new Date('soon') })).toBe(false);
    expect(review.adopt([])).toBe(false);
  } finally {
    app.unmount();
  }
});

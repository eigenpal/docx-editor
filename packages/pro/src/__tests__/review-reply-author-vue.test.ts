/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reply inside a thread draws in its own author's colour, as the React rail does.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { TRACKED, waitFor } from './review-vue-harness.ts';
import { DocxEditorReview } from '../vue/DocxEditorReview.tsx';
import { reviewModule } from '../index.ts';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { DocxEditorAuthorStyle } from '../../../vue/src/editor/DocxEditorAuthorStyle.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

test("a reply draws in its own author's colour, not the thread author's", async () => {
  const mounted = mountEditorTree(
    () => [
      h(DocxEditorAuthorStyle, { author: 'Sam Reyes', color: 'var(--brand-sam)' }),
      h(DocxEditorAuthorStyle, { author: 'Rae Kim', color: 'var(--brand-rae)' }),
    ],
    TRACKED,
    () => [h(DocxEditorReview)],
    [reviewModule()],
    { author: 'Sam Reyes' }
  );
  try {
    await flush();
    const editor = mounted.editor();
    editor.surface!.selectAll();
    expect(editor.addComment('please review', 'Sam Reyes').ok).toBe(true);
    const thread = editor.getReviewItems().find((item) => item.kind === 'comment')!;
    expect(editor.replyToReviewItem(thread.key, 'done', 'Rae Kim').ok).toBe(true);
    editor.setActiveReviewItem(thread.key);
    await flush();
    await waitFor(() => mounted.container.querySelector('[data-testid="review-reply"]') !== null);
    const reply = mounted.container.querySelector<HTMLElement>('[data-testid="review-reply"]')!;
    expect(reply.dataset.reviewAuthor).toBe('Rae Kim');
    expect(reply.style.getPropertyValue('--doc-review-author-current')).toBe('var(--brand-rae)');
    const card = reply.closest<HTMLElement>('[data-testid="review-card"]')!;
    expect(card.style.getPropertyValue('--doc-review-author-current')).toBe('var(--brand-sam)');
  } finally {
    mounted.unmount();
  }
});

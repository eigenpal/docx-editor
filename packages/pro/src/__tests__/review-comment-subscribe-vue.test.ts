/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A Vue comment card subscribes to its edit draft once per comment, not once per review
// change: each review change passes the card a new item object for the same comment.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { COMMENTED_SOURCE, flush, mountReview, waitFor } from './review-vue-harness.ts';
import { commentEditDrafts } from '../review/comment-edit-drafts.ts';

test('review changes keep the comment card draft subscriptions', async () => {
  const mounted = mountReview(COMMENTED_SOURCE, {}, { author: 'Ada' });
  try {
    await flush();
    await waitFor(() => mounted.container.querySelector('[data-testid="review-card"]') !== null);
    const editor = mounted.editor();
    const drafts = commentEditDrafts(editor);
    const subscribe = drafts.subscribe.bind(drafts);
    let subscriptions = 0;
    drafts.subscribe = (...args: Parameters<typeof drafts.subscribe>) => {
      subscriptions += 1;
      return subscribe(...args);
    };
    const card = mounted.container.querySelector<HTMLElement>('[data-testid="review-card"]')!;
    card.click();
    await flush();
    // Typing inside the commented range changes the item's text, so the rail passes the
    // card a new item object for the same comment on each keystroke.
    const [first] = editor.surface!.session.paragraphIds();
    editor.exec({
      type: 'setSelection',
      range: { anchor: { blockId: first!, offset: 2 }, head: { blockId: first!, offset: 2 } },
    });
    await flush();
    const before = subscriptions;
    for (const text of ['a', 'b', 'c']) {
      editor.surface!.type(text);
      await flush();
    }
    expect(mounted.container.querySelector('[data-testid="review-card"]')).not.toBeNull();
    expect(subscriptions).toBe(before);
  } finally {
    mounted.unmount();
  }
});

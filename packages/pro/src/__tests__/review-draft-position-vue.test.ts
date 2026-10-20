/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Where the comment compose box sits when the host renders its own cards: a `top` it passes
// wins, and a Draft inside host content renders only while a draft is open.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { DocxEditorReview } from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { TRACKED, selectAllWithPlacement, waitFor } from './review-vue-harness.ts';

function addComment(container: HTMLElement): void {
  (container.querySelector('[data-testid="review-add-comment"]') as HTMLButtonElement).click();
}

describe('Vue review draft position', () => {
  test('a Draft root part takes the host position from top', async () => {
    const mounted = mountEditorTree(
      () => [],
      TRACKED,
      () => [
        h(
          DocxEditorReview,
          { preset: false },
          {
            default: () => [
              h(DocxEditorReview.AddComment),
              h(DocxEditorReview.Draft, { top: 123 }),
            ],
          }
        ),
      ],
      [reviewModule()],
      { author: 'Reviewer' }
    );
    try {
      await flush();
      await selectAllWithPlacement(mounted.editor());
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-add-comment"]') !== null
      );
      addComment(mounted.container);
      await flush();
      const draft = mounted.container.querySelector('[data-testid="review-draft"]') as HTMLElement;
      expect(draft.parentElement!.style.top).toBe('123px');
    } finally {
      mounted.unmount();
    }
  });

  test('a Draft inside host content renders only while a draft is open', async () => {
    const HostCards = defineComponent({
      setup() {
        return () =>
          h('div', { 'data-testid': 'host-cards' }, [h(DocxEditorReview.Draft, { top: 40 })]);
      },
    });
    const mounted = mountEditorTree(
      () => [],
      TRACKED,
      () => [
        h(
          DocxEditorReview,
          { preset: false },
          { default: () => [h(DocxEditorReview.AddComment), h(HostCards)] }
        ),
      ],
      [reviewModule()],
      { author: 'Reviewer' }
    );
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-testid="host-cards"]') !== null);
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeNull();
      await selectAllWithPlacement(mounted.editor());
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-add-comment"]') !== null
      );
      addComment(mounted.container);
      await flush();
      const draft = mounted.container.querySelector('[data-testid="review-draft"]') as HTMLElement;
      const host = mounted.container.querySelector('[data-testid="host-cards"]') as HTMLElement;
      expect(host.contains(draft)).toBe(true);
      expect(draft.parentElement!.style.top).toBe('40px');
      (
        mounted.container.querySelector('[data-testid="review-draft-cancel"]') as HTMLButtonElement
      ).click();
      await flush();
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });
});

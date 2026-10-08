/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { describe, expect, test } from 'bun:test';
import { h } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { DocxEditorReview } from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { flush, mountReview, waitFor } from './review-vue-harness.ts';
import {
  BALLOON_SOURCE,
  checkChangeBalloons,
  checkCommentMarkers,
  checkReadOnlyBalloon,
} from './review-balloons-harness.ts';

const change = async (run: () => void) => {
  run();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flush();
};

async function ready(mounted: { container: HTMLElement }) {
  await flush();
  await waitFor(() => mounted.container.querySelector('[data-testid="review-card"]') !== null);
}

describe('Vue review layout preferences', () => {
  test('comment markers draw initials badges by default and icons on request', async () => {
    const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' });
    try {
      await ready(mounted);
      await checkCommentMarkers(mounted.container, mounted.editor() as DocxEditorInstance, change);
    } finally {
      mounted.unmount();
    }
  });

  test('a host Markers icon overrides the badge', async () => {
    const mounted = mountEditorTree(
      () => [],
      BALLOON_SOURCE,
      () => [
        h(DocxEditorReview, null, {
          default: () => [
            h(DocxEditorReview.Markers, {
              icon: () => h('span', { 'data-testid': 'host-glyph' }),
            }),
          ],
        }),
      ],
      [reviewModule()]
    );
    try {
      await ready(mounted);
      await change(() => mounted.editor().exec({ type: 'toggleReviewPane' }));
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-marker"]') !== null
      );
      const marker = mounted.container.querySelector('[data-testid="review-marker"]')!;
      expect(marker.querySelector('[data-testid="host-glyph"]')).not.toBeNull();
      expect(marker.querySelector('[data-testid="review-badge"]')).toBeNull();
      expect(marker.hasAttribute('data-marker')).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  test('balloons hold tracked changes while the rail holds comments', async () => {
    const mounted = mountReview(
      BALLOON_SOURCE,
      {},
      { author: 'Grace Hopper', revisionMarkup: { revisionsIn: 'balloons' } }
    );
    try {
      await ready(mounted);
      await checkChangeBalloons(mounted.container, mounted.editor() as DocxEditorInstance, change);
    } finally {
      mounted.unmount();
    }
  }, 20000);

  test('switching revisionsIn live moves changes between the rail and balloons', async () => {
    const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' });
    try {
      await ready(mounted);
      const kinds = () =>
        [...mounted.container.querySelectorAll<HTMLElement>('[data-testid="review-card"]')].map(
          (card) => card.dataset.kind
        );
      expect(kinds()).toContain('insert');
      await change(() => mounted.editor().setRevisionMarkup({ revisionsIn: 'balloons' }));
      expect(kinds().every((kind) => kind === 'comment')).toBe(true);
      await change(() => mounted.editor().setRevisionMarkup({ revisionsIn: 'pane' }));
      expect(kinds()).toContain('insert');
    } finally {
      mounted.unmount();
    }
  });

  test('viewing mode keeps balloon decisions unavailable', async () => {
    const mounted = mountReview(
      BALLOON_SOURCE,
      {},
      { author: 'Grace Hopper', revisionMarkup: { revisionsIn: 'balloons' } }
    );
    try {
      await ready(mounted);
      await checkReadOnlyBalloon(mounted.container, mounted.editor() as DocxEditorInstance, change);
    } finally {
      mounted.unmount();
    }
  });
});

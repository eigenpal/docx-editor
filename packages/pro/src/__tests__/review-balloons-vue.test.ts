/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { describe, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { useEditorEvent } from '@docx-editor.dev/vue';
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
  checkBalloonFollowsLayout,
  checkRevealOpensPane,
  checkRevealReopensBalloon,
  checkStructuralCaret,
  ROW_SOURCE,
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
      { author: 'Grace Hopper' },
      { revisionsIn: 'balloons' }
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
      await change(() => mounted.editor().setReviewPaneOptions({ revisionsIn: 'balloons' }));
      expect(kinds().every((kind) => kind === 'comment')).toBe(true);
      await change(() => mounted.editor().setReviewPaneOptions({ revisionsIn: 'pane' }));
      expect(kinds()).toContain('insert');
    } finally {
      mounted.unmount();
    }
  });

  test('a caret inside a tracked row opens no balloon', async () => {
    const mounted = mountReview(
      ROW_SOURCE,
      {},
      { author: 'Grace Hopper' },
      { revisionsIn: 'balloons' }
    );
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-paragraph-id]') !== null);
      await checkStructuralCaret(mounted.container, mounted.editor() as DocxEditorInstance, change);
    } finally {
      mounted.unmount();
    }
  });

  test('the card reply line shows Cancel only with text and closes on Escape', async () => {
    const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' });
    try {
      await ready(mounted);
      const editor = mounted.editor() as DocxEditorInstance;
      const thread = editor
        .getReviewItems({ placement: false })
        .find((item) => item.kind === 'comment' && item.text === 'Check this.')!;
      await change(() => {
        editor.setActiveReviewItem(thread.key);
      });
      const line = mounted.container.querySelector<HTMLElement>('[data-reply-line]')!;
      expect(line).not.toBeNull();
      expect(line.querySelector('[data-testid="review-reply-avatar"]')?.textContent).toBe('GH');
      expect(line.querySelector('[data-testid="review-reply-cancel"]')).toBeNull();
      const input = line.querySelector('[data-testid="review-reply-input"]')!;
      await change(() =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      );
      expect(mounted.container.querySelector('[data-reply-line]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test("overflow: 'scroll' keeps the full column on a narrow viewport", async () => {
    // happy-dom lays nothing out; stand in a 1000px viewport, too narrow for the column.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1000,
    });
    const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' });
    try {
      await ready(mounted);
      const editor = mounted.editor() as DocxEditorInstance;
      const scroller = mounted.container.querySelector<HTMLElement>(
        '.docx-editor__scroll-container'
      )!;
      const gutter = () => scroller.style.getPropertyValue('--docx-review-gutter');
      expect(gutter()).toBe('44px');
      await change(() => editor.setReviewPaneOptions({ overflow: 'scroll' }));
      expect(gutter()).toBe('316px');
      expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('24px');
      // The rail shows its full card column, not the compact strip.
      expect(
        mounted.container.querySelector('[data-testid="review-rail"]')?.hasAttribute('data-compact')
      ).toBe(false);
      await change(() => editor.setReviewPaneOptions({ overflow: 'float' }));
      expect(gutter()).toBe('44px');
    } finally {
      mounted.unmount();
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  }, 20000);

  test("overflow: 'scroll' fits inside the marker strip and keeps one size when toggled", async () => {
    // The stylesheet's padding rule, which the fit measures; this file loads no CSS.
    const style = document.createElement('style');
    style.textContent =
      '.docx-editor__scroll-container { padding-right: var(--docx-review-gutter); ' +
      'padding-left: var(--docx-review-gutter-start); }';
    document.head.append(style);
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
    const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' });
    try {
      await ready(mounted);
      const editor = mounted.editor() as DocxEditorInstance;
      await change(() => {
        editor.setReviewPaneOptions({ overflow: 'scroll' });
        if (editor.snapshot().reviewPaneOpen) editor.exec({ type: 'toggleReviewPane' });
      });
      // Leave the fit and come back, so it measures the settled paddings now.
      await change(() => {
        editor.setZoomMode({ type: 'fixed' });
      });
      await change(() => {
        editor.setZoomMode('auto');
      });
      expect(editor.snapshot().reviewPaneOpen).toBe(false);
      expect(editor.getZoom() * 816).toBeLessThanOrEqual(800 - 88);
      // One page size: opening and closing the pane leaves the fit where it was.
      const closed = editor.getZoom();
      for (let toggle = 0; toggle < 2; toggle += 1) {
        await change(() => editor.exec({ type: 'toggleReviewPane' }));
        await change(() => {
          editor.setZoomMode({ type: 'fixed' });
        });
        await change(() => {
          editor.setZoomMode('auto');
        });
        expect(editor.getZoom()).toBe(closed);
      }
    } finally {
      mounted.unmount();
      style.remove();
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  }, 20000);

  test('an open balloon follows its change and stays inside the viewport', async () => {
    const mounted = mountReview(
      BALLOON_SOURCE,
      {},
      { author: 'Grace Hopper' },
      { revisionsIn: 'balloons' }
    );
    try {
      await ready(mounted);
      await checkBalloonFollowsLayout(
        mounted.container,
        mounted.editor() as DocxEditorInstance,
        change
      );
    } finally {
      mounted.unmount();
    }
  });

  test('Next Change reopens a closed balloon on the change it lands on again', async () => {
    const mounted = mountReview(
      ROW_SOURCE,
      {},
      { author: 'Grace Hopper' },
      { revisionsIn: 'balloons' }
    );
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-paragraph-id]') !== null);
      await checkRevealReopensBalloon(
        mounted.container,
        mounted.editor() as DocxEditorInstance,
        change
      );
    } finally {
      mounted.unmount();
    }
  });

  for (const overflow of ['float', 'scroll'] as const) {
    test(`Next Change opens a closed pane at its card (overflow: '${overflow}')`, async () => {
      const mounted = mountReview(BALLOON_SOURCE, {}, { author: 'Grace Hopper' }, { overflow });
      try {
        await ready(mounted);
        await checkRevealOpensPane(
          mounted.container,
          mounted.editor() as DocxEditorInstance,
          change
        );
      } finally {
        mounted.unmount();
      }
    });
  }

  test('useEditorEvent hears reviewItemReveal', async () => {
    const heard: { key: string; source: string }[] = [];
    const Listener = defineComponent({
      setup() {
        useEditorEvent('reviewItemReveal', (event) => heard.push({ ...event }));
        return () => null;
      },
    });
    const mounted = mountEditorTree(
      () => [],
      BALLOON_SOURCE,
      () => [h(DocxEditorReview), h(Listener)],
      [reviewModule()]
    );
    try {
      await ready(mounted);
      const editor = mounted.editor() as DocxEditorInstance;
      await change(() => editor.exec({ type: 'navigateReviewChange', direction: 'next' }));
      const key = editor.getReviewItems({ placement: false }).find((item) => item.isActive)!.key;
      expect(heard).toEqual([{ key, source: 'navigate' }]);
    } finally {
      mounted.unmount();
    }
  });

  test('viewing mode keeps balloon decisions unavailable', async () => {
    const mounted = mountReview(
      BALLOON_SOURCE,
      {},
      { author: 'Grace Hopper' },
      { revisionsIn: 'balloons' }
    );
    try {
      await ready(mounted);
      await checkReadOnlyBalloon(mounted.container, mounted.editor() as DocxEditorInstance, change);
    } finally {
      mounted.unmount();
    }
  });
});

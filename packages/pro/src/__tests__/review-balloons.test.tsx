/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocxEditorInstance, ReviewPaneOptions } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
  useEditorEvent,
} from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';
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

function mount(
  pane?: ReviewPaneOptions,
  review: ReactNode = <DocxEditorReview />,
  source: Uint8Array = BALLOON_SOURCE
) {
  let editor: DocxEditorInstance | undefined;
  const view = render(
    <DocxEditorRoot
      document={source}
      author="Grace Hopper"
      modules={[reviewModule(pane ? { pane } : {})]}
      onReady={(instance) => {
        editor = instance as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {review}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => editor! };
}

const change = async (run: () => void) => {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('React review layout preferences', () => {
  test('comment markers draw initials badges by default and icons on request', async () => {
    const { view, editor } = mount();
    try {
      await checkCommentMarkers(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  test('a host Markers icon overrides the badge', async () => {
    const { view, editor } = mount(
      undefined,
      <DocxEditorReview>
        <DocxEditorReview.Markers icon={() => <span data-testid="host-glyph" />} />
      </DocxEditorReview>
    );
    try {
      await change(() => editor().exec({ type: 'toggleReviewPane' }));
      const marker = view.container.querySelector('[data-testid="review-marker"]')!;
      expect(marker.querySelector('[data-testid="host-glyph"]')).not.toBeNull();
      expect(marker.querySelector('[data-testid="review-badge"]')).toBeNull();
      expect(marker.hasAttribute('data-marker')).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test('balloons hold tracked changes while the rail holds comments', async () => {
    const { view, editor } = mount({ revisionsIn: 'balloons' });
    try {
      await checkChangeBalloons(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  test('an open balloon follows its change and stays inside the viewport', async () => {
    const { view, editor } = mount({ revisionsIn: 'balloons' });
    try {
      await checkBalloonFollowsLayout(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  test('switching revisionsIn live moves changes between the rail and balloons', async () => {
    const { view, editor } = mount();
    try {
      const kinds = () =>
        [...view.container.querySelectorAll<HTMLElement>('[data-testid="review-card"]')].map(
          (card) => card.dataset.kind
        );
      expect(kinds()).toContain('insert');
      await change(() => editor().setReviewPane({ revisionsIn: 'balloons' }));
      expect(kinds().every((kind) => kind === 'comment')).toBe(true);
      expect(() => editor().setReviewPane({ revisionsIn: 'sidebar' as never })).toThrow(TypeError);
      await change(() => editor().setReviewPane({ revisionsIn: 'pane' }));
      expect(kinds()).toContain('insert');
    } finally {
      view.unmount();
    }
  });

  test('a caret inside a tracked row opens no balloon', async () => {
    const { view, editor } = mount({ revisionsIn: 'balloons' }, <DocxEditorReview />, ROW_SOURCE);
    try {
      await checkStructuralCaret(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  test('Next Change reopens a closed balloon on the change it lands on again', async () => {
    const { view, editor } = mount({ revisionsIn: 'balloons' }, <DocxEditorReview />, ROW_SOURCE);
    try {
      await checkRevealReopensBalloon(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  for (const overflow of ['float', 'scroll'] as const) {
    test(`Next Change opens a closed pane at its card (overflow: '${overflow}')`, async () => {
      const { view, editor } = mount({ overflow });
      try {
        await checkRevealOpensPane(view.container, editor(), change);
      } finally {
        view.unmount();
      }
    });
  }

  test('useEditorEvent hears reviewItemReveal', async () => {
    const heard: { key: string; source: string }[] = [];
    function Listener() {
      useEditorEvent('reviewItemReveal', (event) => heard.push({ ...event }));
      return null;
    }
    const { view, editor } = mount(
      undefined,
      <>
        <DocxEditorReview />
        <Listener />
      </>
    );
    try {
      await change(() => editor().exec({ type: 'navigateReviewChange', direction: 'next' }));
      const key = editor()
        .getReviewItems({ placement: false })
        .find((item) => item.isActive)!.key;
      expect(heard).toEqual([{ key, source: 'navigate' }]);
    } finally {
      view.unmount();
    }
  });

  test('viewing mode keeps balloon decisions unavailable', async () => {
    const { view, editor } = mount({ revisionsIn: 'balloons' });
    try {
      await checkReadOnlyBalloon(view.container, editor(), change);
    } finally {
      view.unmount();
    }
  });

  test('the card reply line shows Cancel only while there is text', async () => {
    const { view, editor } = mount();
    try {
      const thread = editor()
        .getReviewItems({ placement: false })
        .find((item) => item.kind === 'comment' && item.text === 'Check this.')!;
      await change(() => {
        editor().setActiveReviewItem(thread.key);
      });
      const line = view.container.querySelector<HTMLElement>('[data-reply-line]')!;
      expect(line).not.toBeNull();
      expect(line.querySelector('[data-testid="review-reply-avatar"]')?.textContent).toBe('GH');
      expect(line.querySelector('[data-testid="review-reply-cancel"]')).toBeNull();
      expect(
        (line.querySelector('[data-testid="review-reply-submit"]') as HTMLButtonElement).disabled
      ).toBe(true);
      // Escape on an empty line closes the card: the keyboard path Cancel offers with text.
      const input = line.querySelector('[data-testid="review-reply-input"]')!;
      await change(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(view.container.querySelector('[data-reply-line]')).toBeNull();
    } finally {
      view.unmount();
    }
  });
});

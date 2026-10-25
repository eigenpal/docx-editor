/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `useReviewRailMetrics` gives a custom review column the packaged rail's geometry. The Vue
// twin is review-rail-metrics-vue.test.ts; both assert the same numbers for the same layout.
//
// These tests paint through the BUILT react adapter (`@docx-editor.dev/react` resolves to
// packages/react/dist) — rebuild it before trusting a failure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { useContext, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import {
  DocxEditorContent,
  DocxEditorLoading,
  DocxEditorRoot,
  DocxEditorToolbar,
  DocxEditorViewport,
  LocaleProvider,
  ReviewRailContext,
  useDocxEditor,
} from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
  type UseReviewRailMetricsOptions,
} from '../react/index.ts';
import {
  BANNER_HEIGHT,
  COMMENTED_SOURCE,
  EXPECTED_AT_100,
  insertBanner,
  installRailGeometry,
  railGeometry,
  readMetrics,
} from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  railGeometry.surfaceRight = 1116;
  railGeometry.clientWidth = 1400;
});

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(predicate: () => boolean, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts && !predicate(); i++) await settle(25);
}

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();
let captured: DocxEditorInstance | null = null;

function CaptureEditor() {
  captured = useDocxEditor() as DocxEditorInstance | null;
  return null;
}

/** Reads the packaged rail's measurement from inside `preset={false}`. */
function InsideProbe() {
  const metrics = useReviewRailMetrics();
  return <div data-testid="inside-probe" data-metrics={JSON.stringify(metrics)} />;
}

/** A host's own column, placed only from the public hooks. */
function CustomColumn({
  position = 'absolute',
  options,
}: {
  position?: CSSProperties['position'];
  options?: UseReviewRailMetricsOptions;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const metrics = useReviewRailMetrics(railRef, options);
  const { items } = useReview();
  const positions = useStackedReviewPositions(items, NO_HEIGHTS, { scale: metrics.scale });
  return (
    <div
      ref={railRef}
      data-testid="custom-rail"
      data-metrics={JSON.stringify(metrics)}
      style={{
        position,
        top: 0,
        left: metrics.left ?? 0,
        visibility: metrics.left === null ? 'hidden' : 'visible',
      }}
    >
      {items.map((item) => (
        <div
          key={item.key}
          data-testid="custom-card"
          data-anchor={item.anchorY ?? ''}
          style={{
            position: 'absolute',
            top: metrics.top + (positions.get(item.key) ?? 0) * metrics.scale,
          }}
        />
      ))}
    </div>
  );
}

/** A custom column that serves comment drafts, as the guide describes. */
function DraftingColumn({ onDraft }: { onDraft: () => void }) {
  const registry = useContext(ReviewRailContext);
  useEffect(() => {
    if (!registry) return undefined;
    const unregister = registry.register();
    const release = registry.registerCommentDraft(onDraft);
    return () => {
      release();
      unregister();
    };
  }, [registry, onDraft]);
  return <CustomColumn options={{ reserveGutter: false }} />;
}

function tree(children: ReactNode, loading = false) {
  return (
    <DocxEditorRoot document={COMMENTED_SOURCE} modules={[reviewModule()]}>
      <CaptureEditor />
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.AddComment />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        {loading ? <DocxEditorLoading when /> : null}
        <DocxEditorContent />
        {children}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function mount(children: ReactNode, loading = false) {
  return render(tree(children, loading));
}

const scroller = (container: HTMLElement) =>
  container.querySelector('.docx-editor__scroll-container') as HTMLElement;
const columnOf = (container: HTMLElement) => container.querySelector('[data-testid="custom-rail"]');

describe('useReviewRailMetrics (React)', () => {
  test('a preset={false} child reads the packaged rail geometry', async () => {
    const view = mount(
      <DocxEditorReview preset={false}>
        <InsideProbe />
      </DocxEditorReview>
    );
    const probe = () => view.container.querySelector('[data-testid="inside-probe"]');
    await waitFor(() => readMetrics(probe())?.left === EXPECTED_AT_100.left);
    expect(readMetrics(probe())).toEqual({ ...EXPECTED_AT_100 });
    // The same number the packaged rail places its own element with.
    const rail = view.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
    expect(rail.style.left).toBe(`${EXPECTED_AT_100.left}px`);
  });

  test('a custom column measures itself and places a card at its anchor', async () => {
    const view = mount(<CustomColumn />);
    const column = () => columnOf(view.container);
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
    await waitFor(() => view.container.querySelector('[data-testid="custom-card"]') !== null);
    const card = view.container.querySelector('[data-testid="custom-card"]') as HTMLElement;
    expect(card.getAttribute('data-anchor')).not.toBe('');
    const anchor = Number(card.getAttribute('data-anchor'));
    expect(Number.isFinite(anchor)).toBe(true);
    expect(Number.parseFloat(card.style.top)).toBeCloseTo(
      EXPECTED_AT_100.top + anchor * EXPECTED_AT_100.scale,
      5
    );
  });

  test('a zoom change updates the scale', async () => {
    const view = mount(<CustomColumn />);
    const column = () => columnOf(view.container);
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    act(() => {
      captured!.setZoom(1.5);
    });
    await waitFor(() => readMetrics(column())?.scale === 2);
    expect(readMetrics(column())?.scale).toBe(2);
  });

  test('ignores the loading placeholder and survives its removal', async () => {
    const view = mount(<CustomColumn />, true);
    const column = () => columnOf(view.container);
    expect(view.container.querySelector('.docx-editor__loading-surface')).not.toBeNull();
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
    view.rerender(tree(<CustomColumn />, false));
    await waitFor(() => view.container.querySelector('.docx-editor__loading-surface') === null);
    await settle(60);
    expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
  });

  test('follows a banner that appears above the pages', async () => {
    const view = mount(<CustomColumn />);
    const column = () => columnOf(view.container);
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    insertBanner(scroller(view.container));
    await waitFor(() => readMetrics(column())?.top === EXPECTED_AT_100.top + BANNER_HEIGHT);
    expect(readMetrics(column())?.top).toBe(EXPECTED_AT_100.top + BANNER_HEIGHT);
  });

  test('measures again after the column unmounts and mounts', async () => {
    const view = mount(<CustomColumn />);
    const column = () => columnOf(view.container);
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    view.rerender(tree(null));
    await settle();
    expect(column()).toBeNull();
    railGeometry.surfaceRight = 1016;
    view.rerender(tree(<CustomColumn />));
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left - 100);
    expect(readMetrics(column())?.left).toBe(EXPECTED_AT_100.left - 100);
  });

  test('a custom column reserves the review gutter unless told not to', async () => {
    const view = mount(<CustomColumn />);
    await waitFor(
      () => scroller(view.container).style.getPropertyValue('--docx-review-gutter') !== ''
    );
    expect(scroller(view.container).style.getPropertyValue('--docx-review-gutter')).not.toBe('');
    cleanup();
    const bare = mount(<CustomColumn options={{ reserveGutter: false }} />);
    await waitFor(() => readMetrics(columnOf(bare.container))?.left === EXPECTED_AT_100.left);
    expect(scroller(bare.container).style.getPropertyValue('--docx-review-gutter')).toBe('');
  });

  test('a custom column alone shows no Add comment control', async () => {
    const addComment = (root: HTMLElement) => root.querySelector('[data-slot="review.addComment"]');
    // The control: the packaged rail serves comment drafts, so the button shows.
    const packaged = mount(<DocxEditorReview />);
    await waitFor(() => addComment(packaged.container) !== null);
    expect(addComment(packaged.container)).not.toBeNull();
    cleanup();
    const view = mount(<CustomColumn />);
    await waitFor(
      () => scroller(view.container).style.getPropertyValue('--docx-review-gutter') !== ''
    );
    expect(scroller(view.container).style.getPropertyValue('--docx-review-gutter')).not.toBe('');
    expect(addComment(view.container)).toBeNull();
  });

  test('a column that registers a draft handler receives Add comment', async () => {
    let drafts = 0;
    const onDraft = () => {
      drafts++;
    };
    const view = mount(<DraftingColumn onDraft={onDraft} />);
    const button = () =>
      view.container.querySelector('[data-slot="review.addComment"]') as HTMLButtonElement | null;
    await waitFor(() => button() !== null);
    expect(button()).not.toBeNull();
    act(() => {
      captured!.surface!.focus();
      captured!.surface!.selectAll();
    });
    await waitFor(() => button()?.disabled === false);
    act(() => {
      button()!.click();
    });
    expect(drafts).toBe(1);
  });

  test('releases the gutter when the column unmounts', async () => {
    const view = mount(<CustomColumn />);
    const gutter = () => scroller(view.container).style.getPropertyValue('--docx-review-gutter');
    await waitFor(() => gutter() !== '');
    view.rerender(tree(null));
    await waitFor(() => gutter() === '');
    expect(gutter()).toBe('');
  });

  test('reports compact when the viewport is too narrow for a full column', async () => {
    railGeometry.clientWidth = 1000;
    const view = mount(<CustomColumn />);
    const column = () => columnOf(view.container);
    await waitFor(() => readMetrics(column())?.compact === true);
    expect(readMetrics(column())?.compact).toBe(true);
    expect(readMetrics(column())?.compactCardLeft).toBe(1000 - EXPECTED_AT_100.left - 312);
  });

  test('the packaged rail re-measures when the viewport style changes', async () => {
    const view = mount(<DocxEditorReview />);
    const rail = () => view.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
    await waitFor(() => rail()?.style.left === `${EXPECTED_AT_100.left}px`);
    railGeometry.surfaceRight = 1016;
    scroller(view.container).style.setProperty('--probe', '1');
    await waitFor(() => rail().style.left === `${EXPECTED_AT_100.left - 100}px`);
    expect(rail().style.left).toBe(`${EXPECTED_AT_100.left - 100}px`);
  });

  test('a right-to-left interface puts the column on the left of the page', async () => {
    const view = render(<LocaleProvider dir="rtl">{tree(<DocxEditorReview />)}</LocaleProvider>);
    const rail = () => view.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
    const viewport = scroller(view.container);
    await waitFor(() => rail()?.style.left !== undefined && rail().style.left !== '');
    expect(viewport.getAttribute('data-review-side')).toBe('left');
    // The full column pads the left; the right keeps what the start would have had.
    expect(viewport.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    expect(viewport.style.getPropertyValue('--docx-review-gutter-start')).toBe('0px');
    // The page starts at x 300 in a frame at x 20: the column ends one gutter before it.
    expect(rail().style.left).toBe(`${300 - 20 - 16 - rail().offsetWidth}px`);
  });

  test('warns once in development when the column is not absolutely positioned', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mount(<CustomColumn position="relative" />);
      await waitFor(() => warn.mock.calls.length > 0);
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((text) => text.includes('not absolutely positioned'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test('outside the rail and without a ref, it warns and reports the initial value', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    function Outside() {
      const metrics = useReviewRailMetrics();
      return <div data-testid="outside-probe" data-metrics={JSON.stringify(metrics)} />;
    }
    try {
      const view = mount(<Outside />);
      await settle(60);
      expect(readMetrics(view.container.querySelector('[data-testid="outside-probe"]'))).toEqual({
        scale: 96 / 72,
        top: 0,
        left: null,
        side: 'right',
        compactCardLeft: null,
        compact: false,
      });
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((text) => text.includes('without a railRef'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

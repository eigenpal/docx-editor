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

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { useRef, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import {
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
  useDocxEditor,
} from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '../react/index.ts';
import {
  COMMENTED_SOURCE,
  EXPECTED_AT_100,
  installRailGeometry,
  readMetrics,
} from './review-rail-metrics-harness.ts';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installRailGeometry();
});
afterAll(() => restore());
afterEach(cleanup);

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
function CustomColumn() {
  const railRef = useRef<HTMLDivElement>(null);
  const metrics = useReviewRailMetrics(railRef);
  const { items } = useReview();
  const positions = useStackedReviewPositions(items, NO_HEIGHTS, { scale: metrics.scale });
  return (
    <div
      ref={railRef}
      data-testid="custom-rail"
      data-metrics={JSON.stringify(metrics)}
      style={{ position: 'absolute', top: 0, left: metrics.left ?? 0 }}
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

function mount(children: ReactNode) {
  return render(
    <DocxEditorRoot document={COMMENTED_SOURCE} modules={[reviewModule()]}>
      <CaptureEditor />
      <DocxEditorViewport>
        <DocxEditorContent />
        {children}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

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
    const column = () => view.container.querySelector('[data-testid="custom-rail"]');
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    expect(readMetrics(column())).toEqual({ ...EXPECTED_AT_100 });
    await waitFor(() => view.container.querySelector('[data-testid="custom-card"]') !== null);
    const card = view.container.querySelector('[data-testid="custom-card"]') as HTMLElement;
    const anchor = Number(card.getAttribute('data-anchor'));
    expect(card.getAttribute('data-anchor')).not.toBe('');
    expect(Number.isFinite(anchor)).toBe(true);
    expect(Number.parseFloat(card.style.top)).toBeCloseTo(
      EXPECTED_AT_100.top + anchor * EXPECTED_AT_100.scale,
      5
    );
  });

  test('a zoom change updates the scale', async () => {
    const view = mount(<CustomColumn />);
    const column = () => view.container.querySelector('[data-testid="custom-rail"]');
    await waitFor(() => readMetrics(column())?.left === EXPECTED_AT_100.left);
    act(() => {
      captured!.setZoom(1.5);
    });
    await waitFor(() => readMetrics(column())?.scale === 2);
    expect(readMetrics(column())?.scale).toBe(2);
  });

  test('outside the rail and without a ref, it reports the initial value', async () => {
    function Outside() {
      const metrics = useReviewRailMetrics();
      return <div data-testid="outside-probe" data-metrics={JSON.stringify(metrics)} />;
    }
    const view = mount(<Outside />);
    await settle(60);
    expect(readMetrics(view.container.querySelector('[data-testid="outside-probe"]'))).toEqual({
      scale: 96 / 72,
      top: 0,
      left: null,
      compactCardLeft: null,
    });
  });
});

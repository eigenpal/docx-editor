// Coordinate mapper tests (interactive-paginated-editing 3.5 / 3.9).

import { describe, expect, test } from 'bun:test';
import {
  clientToContent,
  contentToClient,
  contentToPageLocal,
  invertAffine,
  pageLocalToContent,
  applyAffine,
  applyInverseAffine,
  validateHostMetrics,
  IDENTITY_HOST_METRICS,
} from '../src/coordinate-mapper.ts';
import { buildStackedPageGeometry } from '../src/interaction-frame.ts';
import { stackedFrame } from './interaction-test-helpers.ts';

describe('coordinate mapper', () => {
  test('client/content round trip under non-zero origin, scroll, and zoom', () => {
    const metrics = {
      clientOrigin: { x: 10, y: 20 },
      scrollOffset: { x: 5, y: 15 },
      zoom: 2,
    };
    const client = { x: 110, y: 220 };
    const content = clientToContent(client, metrics);
    expect(content.ok).toBe(true);
    if (!content.ok) throw new Error('content');
    const back = contentToClient(content.value, metrics);
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error('client');
    expect(back.value.x).toBeCloseTo(client.x, 8);
    expect(back.value.y).toBeCloseTo(client.y, 8);
  });

  test('rejects missing, non-finite, and invalid zoom metrics', () => {
    expect(validateHostMetrics(undefined).ok).toBe(false);
    expect(clientToContent({ x: NaN, y: 0 }, IDENTITY_HOST_METRICS).ok).toBe(false);
    expect(clientToContent({ x: 0, y: 0 }, { ...IDENTITY_HOST_METRICS, zoom: 0 }).ok).toBe(false);
  });

  test('frame pageGeometry and scrollGeometry agree on stacked tops including gaps', () => {
    const frame = stackedFrame(3, 24);
    expect(frame.pageGeometry).toHaveLength(3);
    for (let i = 0; i < frame.pageGeometry.length; i += 1) {
      expect(frame.pageGeometry[i]!.box.y).toBe(frame.scrollGeometry.pageTops[i]);
    }
    expect(frame.scrollGeometry.pageGapPx).toBe(24);
    expect(frame.scrollGeometry.contentHeight).toBe(1056 * 3 + 24 * 2);
    const rebuilt = buildStackedPageGeometry(frame.display, frame.scrollGeometry.pageGapPx);
    expect(rebuilt.pageGeometry.map((p) => p.box.y)).toEqual([...frame.scrollGeometry.pageTops]);
  });

  test('maps content to page-local coordinates using frame-authoritative tops', () => {
    const frame = stackedFrame(2, 24);
    const page1Top = frame.scrollGeometry.pageTops[1]!;
    const page1 = contentToPageLocal({ x: 100, y: page1Top + 50 }, frame);
    expect(page1.ok).toBe(true);
    if (!page1.ok) throw new Error('page1');
    expect(page1.value.pageIndex).toBe(1);
    expect(page1.value.local.y).toBeCloseTo(50, 8);
  });

  test('rejects inter-page gap coordinates from frame scroll geometry', () => {
    const frame = stackedFrame(2, 24);
    const gapY = frame.scrollGeometry.pageTops[0]! + 1056 + 10;
    const gap = contentToPageLocal({ x: 100, y: gapY }, frame);
    expect(gap.ok).toBe(false);
    if (gap.ok) throw new Error('expected gap rejection');
    expect(gap.code).toBe('outOfBounds');
  });

  test('page-local/content round trip uses frame pageGeometry only', () => {
    const frame = stackedFrame(1);
    const local = { x: 72, y: 96 };
    const content = pageLocalToContent(0, local, frame);
    expect(content.ok).toBe(true);
    if (!content.ok) throw new Error('content');
    const back = contentToPageLocal(content.value, frame);
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error('back');
    expect(back.value.local).toEqual(local);
  });

  test('valid affine apply/invert round trip', () => {
    const transform = { a: 1.2, b: 0.1, c: -0.05, d: 0.9, tx: 12, ty: -4 };
    const point = { x: 40, y: 16 };
    const mapped = applyAffine(transform, point);
    const inverse = invertAffine(transform);
    expect(inverse).not.toBeNull();
    const back = applyInverseAffine(transform, mapped);
    expect(back?.x).toBeCloseTo(point.x, 8);
    expect(back?.y).toBeCloseTo(point.y, 8);
  });

  test('detects singular transforms', () => {
    const singular = { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
    expect(invertAffine(singular)).toBeNull();
    expect(applyInverseAffine(singular, { x: 1, y: 1 })).toBeNull();
  });
});

describe('malformed host metrics reject rather than throw (re-review, LOW)', () => {
  test('a partial metrics object yields a typed rejection', () => {
    for (const bad of [
      {} as never,
      { clientOrigin: null, scrollOffset: { x: 0, y: 0 }, zoom: 1 } as never,
      { clientOrigin: { x: 0, y: 0 }, scrollOffset: undefined, zoom: 1 } as never,
    ]) {
      // The contract promises a typed rejection; this used to throw on the
      // dereference of clientOrigin.x.
      expect(() => validateHostMetrics(bad)).not.toThrow();
      const outcome = validateHostMetrics(bad);
      expect(outcome.ok).toBe(false);
    }
  });
});

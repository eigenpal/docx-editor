import { describe, expect, mock, test } from 'bun:test';

import {
  createPaintedPagesGuard,
  readCurrentPaintedPages,
  transactionNeedsDirectOverlayRequest,
} from './paintedPagesGuard';

describe('painted pages guard', () => {
  test('holds overlay reads after a document change until matching pages finish painting', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);
    const initialPaint = guard.startPaint();
    guard.finishPaint(initialPaint);
    refresh.mockClear();

    guard.noteDocumentChange();
    guard.requestOverlayRefresh();

    expect(refresh).not.toHaveBeenCalled();

    const currentPaint = guard.startPaint();
    guard.finishPaint(currentPaint);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('does not release a request when an older paint finishes', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);

    guard.noteDocumentChange();
    const olderPaint = guard.startPaint();
    guard.noteDocumentChange();
    guard.requestOverlayRefresh();
    const currentPaint = guard.startPaint();

    guard.finishPaint(olderPaint);
    expect(refresh).not.toHaveBeenCalled();

    guard.finishPaint(currentPaint);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('coalesces retained requests into one refresh after current pages paint', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);

    guard.noteDocumentChange();
    guard.requestOverlayRefresh();
    guard.requestOverlayRefresh();
    guard.requestOverlayRefresh();

    const currentPaint = guard.startPaint();
    guard.finishPaint(currentPaint);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('does not refresh when a paint completes without a pending request', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);

    const paint = guard.startPaint();
    guard.finishPaint(paint);

    expect(refresh).not.toHaveBeenCalled();
    expect(guard.pagesAreCurrent()).toBe(true);
  });

  test('consumes a retained request exactly once', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);

    guard.noteDocumentChange();
    guard.requestOverlayRefresh();
    guard.requestOverlayRefresh();
    const paint = guard.startPaint();

    guard.finishPaint(paint);
    guard.finishPaint(paint);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('runs selection-only refreshes immediately while pages are current', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);
    const initialPaint = guard.startPaint();
    guard.finishPaint(initialPaint);
    refresh.mockClear();

    guard.requestOverlayRefresh();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('suppresses an image DOM read while painted pages are stale', () => {
    const readImageGeometry = mock(() => ({ width: 10, height: 20 }));

    const result = readCurrentPaintedPages(() => false, readImageGeometry);

    expect(result).toBeNull();
    expect(readImageGeometry).not.toHaveBeenCalled();
  });

  test('uses onSelectionChange as the single request source for selection transactions', () => {
    expect(transactionNeedsDirectOverlayRequest({ docChanged: false, selectionSet: true })).toBe(
      false
    );
    expect(transactionNeedsDirectOverlayRequest({ docChanged: true, selectionSet: false })).toBe(
      false
    );
    expect(transactionNeedsDirectOverlayRequest({ docChanged: false, selectionSet: false })).toBe(
      true
    );
  });

  test('keeps requests retained after failed paints and ignores work after disposal', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);

    guard.noteDocumentChange();
    guard.requestOverlayRefresh();
    const failedPaint = guard.startPaint();
    guard.abandonPaint(failedPaint);
    expect(refresh).not.toHaveBeenCalled();

    const successfulPaint = guard.startPaint();
    guard.finishPaint(successfulPaint);
    expect(refresh).toHaveBeenCalledTimes(1);

    guard.dispose();
    expect(guard.isDisposed()).toBe(true);
    expect(guard.pagesAreCurrent()).toBe(false);
    guard.requestOverlayRefresh();
    const disposedPaint = guard.startPaint();
    guard.finishPaint(disposedPaint);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('revives after a strict-effects cleanup without losing current pages', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);
    const paint = guard.startPaint();
    guard.finishPaint(paint);

    guard.dispose();
    guard.revive();
    guard.requestOverlayRefresh();

    expect(guard.pagesAreCurrent()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

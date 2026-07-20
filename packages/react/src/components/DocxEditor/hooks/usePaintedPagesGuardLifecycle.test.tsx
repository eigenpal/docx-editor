import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { StrictMode, useEffect } from 'react';
import { cleanup, render } from '@testing-library/react';

import {
  createPaintedPagesGuard,
  type PaintedPagesGuard,
} from '@docx-editor.dev/core/internal/paintedPagesGuard';
import { usePaintedPagesGuardLifecycle } from './usePaintedPagesGuardLifecycle';

beforeAll(() => GlobalRegistrator.register());
afterEach(() => cleanup());
afterAll(() => GlobalRegistrator.unregister());

function PassivePaintChild({
  guard,
  paintResults,
}: {
  guard: PaintedPagesGuard;
  paintResults: boolean[];
}) {
  useEffect(() => {
    guard.noteDocumentChange();
    guard.requestOverlayRefresh();
    const paint = guard.startPaint();
    paintResults.push(guard.finishPaint(paint));
  }, [guard, paintResults]);
  return null;
}

function GuardParent({
  guard,
  paintResults,
}: {
  guard: PaintedPagesGuard;
  paintResults: boolean[];
}) {
  usePaintedPagesGuardLifecycle(guard);
  return <PassivePaintChild guard={guard} paintResults={paintResults} />;
}

describe('painted pages guard React lifecycle', () => {
  test('revives before child passive paint setup during Strict Effects replay', () => {
    const refresh = mock(() => {});
    const guard = createPaintedPagesGuard(refresh);
    const paintResults: boolean[] = [];

    const { unmount } = render(
      <StrictMode>
        <GuardParent guard={guard} paintResults={paintResults} />
      </StrictMode>
    );

    expect(paintResults).toEqual([true, true]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(guard.pagesAreCurrent()).toBe(true);

    unmount();
    expect(guard.isDisposed()).toBe(true);
  });
});

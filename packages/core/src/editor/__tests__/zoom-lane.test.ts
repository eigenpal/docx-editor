// The zoom lane against a surface that says no, and against a host that re-asserts.
//
// These are the two cases a mounted editor cannot easily be put into: a rescale the paginated
// surface refuses (it catches a throwing relayout, rolls back and returns false), and a host
// re-sending a value-equal mode object on every render. Both were wrong, and neither is
// reachable from `zoom-controller.test.ts`, so the lane is driven directly here.

import { describe, expect, test } from 'bun:test';
import { createZoomLane, type ZoomLaneHost } from '../docx-editor-zoom.ts';
import { AUTO_ZOOM_MODE } from '../zoom-fit.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

interface Harness {
  readonly lane: ReturnType<typeof createZoomLane>;
  readonly bumps: () => number;
  readonly emits: () => number;
  /** Make the next and every later rescale fail, as a surface that cannot lay out would. */
  readonly refuseRescale: () => void;
}

/**
 * A lane over a surface stub.
 *
 * `setPaginatedSurfaceScale` calls `surface.setScale`, so returning false from that is exactly
 * what a real refusal looks like from here. No container and no scroller, so the fit itself is
 * inert — which is the point: these tests are about the state transitions, not the arithmetic.
 */
function harness(config: Parameters<typeof createZoomLane>[0] = {}): Harness {
  let bumps = 0;
  let emits = 0;
  let accept = true;
  const surface = {
    setScale: () => accept,
    layout: () => ({ pages: [] }),
  } as unknown as PaginatedSurface;
  const host: ZoomLaneHost = {
    container: () => null,
    surface: () => surface,
    bump: () => {
      bumps += 1;
    },
    emitSelectionChange: () => {
      emits += 1;
    },
  };
  return {
    lane: createZoomLane(config, host),
    bumps: () => bumps,
    emits: () => emits,
    refuseRescale: () => {
      accept = false;
    },
  };
}

describe('a rescale the surface refuses', () => {
  // The mode used to be dropped to `fixed` and the observer detached BEFORE the apply, and the
  // failure branch returned without publishing. The editor then reported `fixed` from
  // `getZoomMode()` and `fit` from the snapshot — which nothing had invalidated — so a toolbar
  // kept "Automatic" ticked over an editor that had silently stopped tracking, and the caller
  // had been told `ok: false` so had no reason to re-assert anything.
  test('leaves the mode exactly where it was', () => {
    const { lane, refuseRescale } = harness();
    expect(lane.mode()).toEqual(AUTO_ZOOM_MODE);

    refuseRescale();
    const result = lane.setZoom(1.5);

    expect(result).toMatchObject({ ok: false, code: 'unsupported' });
    expect(lane.mode()).toEqual(AUTO_ZOOM_MODE);
    expect(lane.zoom()).toBe(1);
  });

  test('publishes nothing, because nothing changed', () => {
    const { lane, refuseRescale, bumps, emits } = harness();
    refuseRescale();

    lane.setZoom(1.5);

    expect(bumps()).toBe(0);
    expect(emits()).toBe(0);
  });

  test('a later attempt that succeeds still ends the fit', () => {
    const { lane, refuseRescale } = harness();
    refuseRescale();
    lane.setZoom(1.5);

    const retry = harness();
    expect(retry.lane.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(retry.lane.mode()).toEqual({ type: 'fixed' });
  });
});

describe('a mode re-sent by value', () => {
  // The documented prop spelling is an object literal, so a host re-renders with a fresh one
  // every time. Compared by identity, each of those reinstalled the observer, refitted, bumped
  // the tick and re-rendered every snapshot consumer — on a render that changed nothing.
  test('is not a change, however many times it arrives', () => {
    const { lane, bumps, emits } = harness();
    const literal = () => ({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 }) as const;

    expect(lane.setZoomMode(literal())).toEqual({ ok: true, changed: false });
    expect(lane.setZoomMode(literal())).toEqual({ ok: true, changed: false });
    expect(lane.setZoomMode('auto')).toEqual({ ok: true, changed: false });

    expect(bumps()).toBe(0);
    expect(emits()).toBe(0);
  });

  test('the held object survives, so the snapshot stays reference-equal', () => {
    const { lane } = harness();
    const before = lane.mode();

    lane.setZoomMode({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 });

    expect(lane.mode()).toBe(before);
  });

  test('a genuinely different bound IS a change', () => {
    const { lane, bumps } = harness();

    expect(lane.setZoomMode({ type: 'fit', fit: 'pageWidth' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(bumps()).toBe(1);
    expect(lane.mode()).toEqual({ type: 'fit', fit: 'pageWidth' });
  });
});

describe('the default mode', () => {
  test('a configured zoom means the embedder pinned it', () => {
    expect(harness({ zoom: 1.5 }).lane.mode()).toEqual({ type: 'fixed' });
    expect(harness({ zoom: 1.5 }).lane.zoom()).toBe(1.5);
  });

  test('an out-of-range configured zoom falls back to 100% rather than being applied', () => {
    expect(harness({ zoom: 42 }).lane.zoom()).toBe(1);
  });
});

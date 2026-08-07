// The facade's zoom lane: the scale, where it came from, and the two members that move it.
//
// Kept out of `docx-editor.ts` because that file sits against the max-lines gate, and because
// the three pieces belong together: the number, the mode, and the one path that applies both.
// `zoom-fit.ts` has the arithmetic and `zoom-controller.ts` the measuring; this is the part
// that owns the state and answers the contract.
//
// ONE APPLY PATH is the load-bearing rule here. A fit and a toolbar click are
// indistinguishable downstream — both rescale the surface, both bump the tick, both emit — so
// a host that listens rather than polls sees an automatic refit exactly as it sees a click. An
// earlier shape that only wrote the variable on a refit left every such host showing the old
// percentage.

import type { ExecResult, ZoomMode } from '../contracts/editor.ts';
import { setPaginatedSurfaceScale, type PaginatedSurface } from './paginated-surface.ts';
import { createZoomController } from './zoom-controller.ts';
import {
  AUTO_ZOOM_MODE,
  FIXED_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  isFitMode,
  resolveZoomMode,
} from './zoom-fit.ts';

/** What the lane reads from, and writes back to, the facade around it. */
export interface ZoomLaneHost {
  /** The element the surface mounted into, or null while detached. */
  container(): HTMLElement | null;
  /** The mounted surface, or null. Read every call — it is rebuilt on load and font remount. */
  surface(): PaginatedSurface | null;
  /** Move the state tick, so `snapshot()` re-derives. */
  bump(): void;
  emitSelectionChange(): void;
}

/** The zoom half of `createDocxEditor`. */
export interface ZoomLane {
  zoom(): number;
  mode(): ZoomMode;
  /** Points to CSS pixels: zoom 1 paints at the browser's 96dpi reading of a 72dpi point. */
  scale(): number;
  setZoom(next: number): ExecResult;
  setZoomMode(next: ZoomMode | 'auto'): ExecResult;
  /** Start tracking the viewport, if the mode says to. Called after every mount. */
  attach(): void;
  detach(): void;
  /** Recompute now, for a change to the page's own size. */
  refit(): void;
}

export interface ZoomLaneConfig {
  readonly zoom?: number;
  readonly zoomMode?: ZoomMode | 'auto';
}

export function createZoomLane(config: ZoomLaneConfig, host: ZoomLaneHost): ZoomLane {
  let zoom =
    config.zoom !== undefined &&
    Number.isFinite(config.zoom) &&
    config.zoom >= ZOOM_MIN &&
    config.zoom <= ZOOM_MAX
      ? config.zoom
      : 1;
  /**
   * Where the scale comes from. A configured `zoom` and no configured `zoomMode` means the
   * embedder pinned a number, so honour it: only an editor that asked for neither gets the
   * `'auto'` default. Reference-stable, because `snapshotsEqual` compares it by identity.
   */
  let mode: ZoomMode =
    resolveZoomMode(config.zoomMode ?? (config.zoom !== undefined ? FIXED_ZOOM_MODE : 'auto')) ??
    AUTO_ZOOM_MODE;

  /** Move the scale, whoever asked. Returns whether the surface accepted it. */
  function applyZoom(next: number): boolean {
    if (next === zoom) return true;
    const surface = host.surface();
    if (surface && !setPaginatedSurfaceScale(surface, next * (96 / 72))) return false;
    zoom = next;
    host.bump();
    host.emitSelectionChange();
    return true;
  }

  // Reads `mode` and `zoom` through closures rather than being handed them, so `setZoomMode`
  // takes effect without re-installing the observer.
  const controller = createZoomController({
    container: host.container,
    mode: () => mode,
    // Page ONE, in content pixels at 100%. Every page in a document may have its own size;
    // fitting the first is the same choice the horizontal ruler already makes, and a fit that
    // changed scale as the reader scrolled past a landscape page would be worse than one that
    // does not.
    pageWidthPx: () => {
      const box = host.surface()?.layout().pages[0]?.box;
      return box ? box.width * (96 / 72) : null;
    },
    zoom: () => zoom,
    applyZoom: (next) => {
      applyZoom(next);
    },
  });

  return {
    zoom: () => zoom,
    mode: () => mode,
    scale: () => zoom * (96 / 72),
    attach: () => controller.attach(),
    detach: () => controller.detach(),
    refit: () => controller.refit(),

    setZoom(next: number): ExecResult {
      // Refused rather than clamped: a caller that asked for
      // 0 or NaN has a bug, and silently substituting 1 hides it.
      if (!Number.isFinite(next) || next < ZOOM_MIN || next > ZOOM_MAX) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX}, got ${next}`,
        };
      }
      // A picked number ENDS the fit, and it does so even when the number is the one the fit
      // had already landed on. Leaving the mode alone there meant picking "100%" while auto
      // happened to read 100% did nothing, and the next window resize moved the page again.
      const wasFit = isFitMode(mode);
      if (wasFit) {
        mode = FIXED_ZOOM_MODE;
        controller.detach();
      }
      if (next === zoom) {
        if (!wasFit) return { ok: true, changed: false };
        // Zoom: 1 -> 1, mode: fit -> fixed. Nothing moved on screen and the whole change is
        // in the snapshot, so this has to publish or a zoom menu keeps "Automatic" ticked.
        host.bump();
        host.emitSelectionChange();
        return { ok: true, changed: true };
      }
      if (!applyZoom(next)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: `the mounted surface could not apply zoom ${next}`,
        };
      }
      return { ok: true, changed: true };
    },

    setZoomMode(next: ZoomMode | 'auto'): ExecResult {
      const resolved = resolveZoomMode(next);
      if (!resolved) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `unknown zoom mode ${JSON.stringify(next)}`,
        };
      }
      if (resolved === mode) return { ok: true, changed: false };
      mode = resolved;
      if (isFitMode(resolved)) {
        // Installs the observer AND fits once, so switching to a fit takes effect on the
        // click rather than on the next window resize.
        controller.attach();
      } else {
        controller.detach();
      }
      // Whether or not the fit moved the scale — `applyZoom` publishes when it does — the MODE
      // moved, and a zoom menu renders its tick from the mode.
      host.bump();
      host.emitSelectionChange();
      return { ok: true, changed: true };
    },
  };
}

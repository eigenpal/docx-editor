export const MIN_SOURCE_PERCENT = 28;
export const MAX_SOURCE_PERCENT = 72;

const MIN_DESKTOP_PANE_PX = 320;
const DIVIDER_PX = 1;

export interface SplitBounds {
  readonly min: number;
  readonly max: number;
}

/** Percentage bounds that keep both desktop panes physically usable. */
export function desktopSplitBounds(width: number): SplitBounds {
  if (!Number.isFinite(width) || width <= 0) {
    return { min: MIN_SOURCE_PERCENT, max: MAX_SOURCE_PERCENT };
  }
  const min = Math.max(MIN_SOURCE_PERCENT, (MIN_DESKTOP_PANE_PX / width) * 100);
  const max = Math.min(
    MAX_SOURCE_PERCENT,
    ((width - DIVIDER_PX - MIN_DESKTOP_PANE_PX) / width) * 100
  );
  return min <= max ? { min, max } : { min: 50, max: 50 };
}

export function clampSplit(value: number, bounds: SplitBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

// The font size ladder that growing and shrinking text walks.
//
// One rule for every writer: the editor's toolbar steppers and keyboard shortcuts, and any
// automation surface that steps a size. Each run steps from its own size, so a selection with
// several sizes keeps its proportions instead of collapsing to one value.
//
// Pure arithmetic over half-points (`w:sz`), so the store, layout-free servers, and the editor
// reach the same answer.

/**
 * The preset font sizes, in points, that the size list offers and the steppers walk.
 *
 * @public
 */
export const FONT_SIZE_PRESETS_PT: readonly number[] = Object.freeze([
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
]);

/** Which way a font size step moves. */
export type FontSizeStepDirection = 'increase' | 'decrease';

/** `w:sz` bounds in half-points: 1 pt to 1638 pt (ECMA-376 `ST_HpsMeasure` as edited). */
export const FONT_SIZE_MIN_HALF_POINTS = 2;
export const FONT_SIZE_MAX_HALF_POINTS = 3276;

/** Above the last preset, sizes step to the next multiple of this many points. */
const LARGE_STEP_PT = 10;

const FIRST_PRESET_PT = FONT_SIZE_PRESETS_PT[0]!;
const LAST_PRESET_PT = FONT_SIZE_PRESETS_PT[FONT_SIZE_PRESETS_PT.length - 1]!;

function nextPoints(points: number): number {
  // Below the ladder, whole points: 7.5 and 7 both grow to 8.
  if (points < FIRST_PRESET_PT) return Math.floor(points) + 1;
  for (const preset of FONT_SIZE_PRESETS_PT) if (preset > points) return preset;
  // Past the ladder, the next multiple of ten: 72 grows to 80, and 75 also grows to 80.
  return (Math.floor(points / LARGE_STEP_PT) + 1) * LARGE_STEP_PT;
}

function previousPoints(points: number): number {
  // Past the ladder, the previous multiple of ten, but never below the last preset.
  if (points > LAST_PRESET_PT) {
    return Math.max(LAST_PRESET_PT, (Math.ceil(points / LARGE_STEP_PT) - 1) * LARGE_STEP_PT);
  }
  // Below the ladder, whole points: 8 shrinks to 7, and 7.5 also shrinks to 7.
  if (points <= FIRST_PRESET_PT) return Math.ceil(points) - 1;
  for (let index = FONT_SIZE_PRESETS_PT.length - 1; index >= 0; index -= 1) {
    const preset = FONT_SIZE_PRESETS_PT[index]!;
    if (preset < points) return preset;
  }
  return FIRST_PRESET_PT;
}

/**
 * The size, in half-points, one step up or down from `halfPoints`, clamped to the `w:sz`
 * bounds. A size between presets steps to the nearest preset in that direction, so 13 pt grows
 * to 14 pt and shrinks to 12 pt. Returns `halfPoints` unchanged at a bound, for a value outside
 * the bounds that the step would move the wrong way, and for a value that is not a positive
 * finite number.
 */
export function steppedFontSizeHalfPoints(
  halfPoints: number,
  direction: FontSizeStepDirection
): number {
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return halfPoints;
  const points = halfPoints / 2;
  const stepped = direction === 'increase' ? nextPoints(points) : previousPoints(points);
  const clamped = Math.min(
    FONT_SIZE_MAX_HALF_POINTS,
    Math.max(FONT_SIZE_MIN_HALF_POINTS, Math.round(stepped * 2))
  );
  // A file can state a size outside the bounds, such as `w:sz="1"`. Clamping must not turn a
  // shrink into a grow, or a grow into a shrink.
  const wrongWay = direction === 'increase' ? clamped < halfPoints : clamped > halfPoints;
  return wrongWay ? halfPoints : clamped;
}

/**
 * How an autofit table shares its width among columns that its cells size by content, and
 * how a cell spanning several columns widens them. Pure arithmetic over points; the cell
 * measuring lives in `table-autofit-widths.ts`.
 */

const EPSILON_PT = 0.01;
/** No column collapses below a hairline, whatever its content. */
const MIN_COLUMN_PT = 1;

/** What a cell spanning `count` columns from `from` needs across them, in points. */
export interface SpanRequirement {
  readonly from: number;
  readonly count: number;
  readonly minimum: number;
  /** The requirement with the insets the cell has now, before any widening. */
  readonly current?: number;
}

/**
 * Column minimums raised so every spanning cell's content fits the columns it spans.
 *
 * A spanned group that already holds the cell keeps its minimums. Otherwise the group settles
 * at exactly the cell's minimum, shared in proportion to each column's preferred width (at
 * least its minimum) plus its widest content; a column whose share falls below its own minimum
 * keeps that and the rest share what remains. Narrower spans settle first, so a wider one sees
 * the columns they raised.
 */
export function spanAdjustedMinimums(
  widths: readonly number[],
  minimums: readonly number[],
  maximums: readonly number[],
  spans: readonly SpanRequirement[]
): readonly number[] {
  if (spans.length === 0) return minimums;
  const raised = [...minimums];
  for (const span of [...spans].sort((a, b) => a.count - b.count)) {
    const columns: number[] = [];
    for (
      let column = span.from;
      column < span.from + span.count && column < raised.length;
      column++
    )
      columns.push(column);
    if (columns.length < 2) continue;
    let held = 0;
    for (const column of columns) held += Math.max(widths[column]!, raised[column]!);
    if (span.minimum <= held + EPSILON_PT) continue;
    const weightOf = (column: number): number =>
      Math.max(widths[column]!, raised[column]!) + Math.max(maximums[column]!, raised[column]!);
    const pinned = new Set<number>();
    for (;;) {
      let remaining = span.minimum;
      let weight = 0;
      for (const column of columns) {
        if (pinned.has(column)) remaining -= raised[column]!;
        else weight += weightOf(column);
      }
      const shareOf = (column: number): number =>
        weight > 0
          ? (remaining * weightOf(column)) / weight
          : remaining / (columns.length - pinned.size);
      const short = columns.filter(
        (column) => !pinned.has(column) && shareOf(column) < raised[column]! - EPSILON_PT
      );
      if (short.length > 0 && pinned.size + short.length < columns.length) {
        for (const column of short) pinned.add(column);
        continue;
      }
      for (const column of columns)
        if (!pinned.has(column)) raised[column] = Math.max(raised[column]!, shareOf(column));
      break;
    }
  }
  return raised;
}

/**
 * Column widths for an autofit table some of whose columns no cell gives a preferred width.
 *
 * Those columns are sized by content: each holds its widest unwrapped line when the table
 * has room, and room beyond that is shared in proportion to those widths. Columns with a
 * preferred width keep it while the content-sized ones get their widest lines; past that they
 * give way down to their minimums, and then the content-sized columns wrap, each moving from
 * its minimum toward its widest line by the same fraction. A table whose minimums do not fit
 * its room scales every column above a hairline by the same factor.
 *
 * `targetPt` is the table's settled width; for a table with no width of its own, pass
 * `undefined` and it takes what its content asks for, up to `availablePt`.
 */
export function contentSizedWidths(
  widths: readonly number[],
  sizedByContent: readonly boolean[],
  minimums: readonly number[],
  maximums: readonly number[],
  targetPt: number | undefined,
  availablePt: number,
  /** What the table measured before; overflowing minimums never fit into less than this. */
  currentPt = 0
): readonly number[] {
  const count = widths.length;
  const result = new Array<number>(count);
  let preferred = 0;
  let preferredFloor = 0;
  let widest = 0;
  let narrowest = 0;
  for (let index = 0; index < count; index++) {
    const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
    if (sizedByContent[index]) {
      widest += Math.max(maximums[index]!, minimum);
      narrowest += minimum;
    } else {
      preferred += Math.max(widths[index]!, minimum);
      preferredFloor += minimum;
    }
  }
  const target = targetPt ?? Math.min(preferred + widest, availablePt);
  if (preferred + widest <= target + EPSILON_PT) {
    // Every column fits; the content-sized ones share the room left, by their widest lines.
    const extra = target - preferred - widest;
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      if (!sizedByContent[index]) {
        result[index] = Math.max(widths[index]!, minimum);
        continue;
      }
      const max = Math.max(maximums[index]!, minimum);
      result[index] = widest > 0 ? max + (extra * max) / widest : max;
    }
    return result;
  }
  if (preferredFloor + widest <= target + EPSILON_PT) {
    // Content-sized columns keep their widest lines; preferred ones give way by their slack.
    const need = preferred + widest - target;
    let slack = 0;
    for (let index = 0; index < count; index++) {
      if (sizedByContent[index]) continue;
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      slack += Math.max(widths[index]!, minimum) - minimum;
    }
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      if (sizedByContent[index]) {
        result[index] = Math.max(maximums[index]!, minimum);
        continue;
      }
      const width = Math.max(widths[index]!, minimum);
      result[index] = slack > 0 ? width - (need * (width - minimum)) / slack : width;
    }
    return result;
  }
  const room = target - preferredFloor;
  if (room >= narrowest - EPSILON_PT) {
    // Preferred columns at their minimums; content-sized ones wrap by the same fraction.
    const fraction = widest > narrowest ? (room - narrowest) / (widest - narrowest) : 0;
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      result[index] = sizedByContent[index]
        ? minimum + (Math.max(maximums[index]!, minimum) - minimum) * fraction
        : minimum;
    }
    return result;
  }
  // The minimums alone overflow: scale what each column holds above its hairline.
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const needed = floor.reduce((sum, value) => sum + value, 0);
  // Never narrower than the table already was: an indent can leave the text column no room.
  const fitTo = Math.max(target, availablePt, currentPt);
  if (!Number.isFinite(fitTo) || needed <= fitTo) return floor;
  const hairlines = count * MIN_COLUMN_PT;
  const scale = Math.max(0, fitTo - hairlines) / Math.max(needed - hairlines, EPSILON_PT);
  return floor.map((width) => MIN_COLUMN_PT + (width - MIN_COLUMN_PT) * scale);
}

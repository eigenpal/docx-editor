import {
  mergeAvailableIntervalsAtY,
  topAndBottomSkipBeforeLine,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { shiftInlineDrawingRecord } from './drawing-layout.ts';
import { narrowRectangularWrapSkip } from './narrow-wrap-clearance.ts';
import type { PendingLine } from './pending-line.ts';
import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** A taller run must not pull already placed text into a newly intersected rectangle. */
export function relocateLineForExclusionGrowth(
  line: PendingLine,
  y: number,
  height: number,
  zones: readonly ExclusionZone[],
  left: number,
  right: number,
  spacing: ParagraphLineSpacing,
  candidateWidth: number
): number | null {
  const oldHeight = applyLineSpacing(spacing, line.height, line.baseline).height;
  if (height <= oldHeight + 0.001 || (line.spans.length === 0 && line.drawings.length === 0))
    return 0;
  const before = mergeAvailableIntervalsAtY(y, zones, left, right, oldHeight);
  const after = mergeAvailableIntervalsAtY(y, zones, left, right, height);
  const fits = (box: { x: number; width: number }, intervals: typeof before) =>
    intervals.some(
      (interval) => box.x >= interval.start - 0.001 && box.x + box.width <= interval.end + 0.001
    );
  const blocksText = line.spans.some(
    (span) => span.text.trim() && fits(span.box, before) && !fits(span.box, after)
  );
  const blocksDrawing = line.drawings.some(
    (drawing) => fits(drawing, before) && !fits(drawing, after)
  );
  if (!blocksText && !blocksDrawing) return 0;
  // Tabs own absolute stops and cannot be translated with ordinary text.
  if (line.spans.some((span) => span.text.includes('\t'))) return null;
  let first = Infinity,
    last = -Infinity;
  for (const span of line.spans) {
    first = Math.min(first, span.box.x);
    last = Math.max(last, span.box.x + span.box.width);
  }
  for (const drawing of line.drawings) {
    first = Math.min(first, drawing.x);
    last = Math.max(last, drawing.x + drawing.width);
  }
  const passage = after.find(
    (interval) =>
      Math.max(first, interval.start) + last - first + candidateWidth <= interval.end + 0.001
  );
  if (!passage) return null;
  const shift = Math.max(0, passage.start - first);
  for (let index = 0; index < line.spans.length; index++) {
    const span = line.spans[index]!;
    line.spans[index] = { ...span, box: { ...span.box, x: span.box.x + shift } };
  }
  for (let index = 0; index < line.drawings.length; index++)
    line.drawings[index] = shiftInlineDrawingRecord(line.drawings[index]!, shift, 0);
  line.width += shift;
  return shift;
}

/** Keep clearance on the pending line so placement and pagination consume it once. */
export function createLineExclusionClearance(context: {
  line: () => PendingLine;
  top: () => number;
  zones: () => readonly ExclusionZone[];
  left: () => number;
  right: number;
  emptyStyle: ResolvedRunStyle;
  measurer: TextMeasurer;
  lineSpacing: ParagraphLineSpacing;
}) {
  let appliedLine: PendingLine | undefined;
  const applyTopAndBottomSkipIfNeeded = (): void => {
    const line = context.line();
    if (appliedLine === line || line.spans.length > 0 || line.drawings.length > 0) return;
    const zones = context.zones();
    if (zones.length === 0) return;
    const metrics = context.measurer.lineMetrics(context.emptyStyle);
    const skip = topAndBottomSkipBeforeLine(
      context.top(),
      line.height > 0 ? line.height : metrics.height,
      zones
    );
    if (skip > 0.001) {
      appliedLine = line;
      line.exclusionSkipBefore = skip;
    }
  };
  const applyNarrowWrapSkipIfNeeded = (text: string, style: ResolvedRunStyle): void => {
    const line = context.line();
    if (line.spans.length > 0 || line.drawings.length > 0) return;
    applyTopAndBottomSkipIfNeeded();
    const zones = context.zones();
    if (zones.length === 0) return;
    const metrics = context.measurer.lineMetrics(style);
    const firstCodePoint = text.codePointAt(0);
    const glyph = firstCodePoint === undefined ? '' : String.fromCodePoint(firstCodePoint);
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      Math.max(
        metrics.height,
        applyLineSpacing(context.lineSpacing, metrics.height, metrics.baseline).height
      ),
      zones,
      context.left(),
      context.right,
      context.measurer.measure(displayText(glyph, style), style)
    );
    if (skip > 0.001) {
      line.exclusionSkipBefore = (line.exclusionSkipBefore ?? 0) + skip;
      line.width = 0;
      appliedLine = line;
    }
  };
  const applyInlineObjectSkipIfNeeded = (width: number, height: number): void => {
    const line = context.line();
    const hasContent = line.spans.length > 0 || line.drawings.length > 0;
    applyTopAndBottomSkipIfNeeded();
    const zones = context.zones();
    if (zones.length === 0) return;
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      Math.max(line.height, height + Math.max(0, line.height - line.baseline)),
      zones,
      context.left(),
      context.right,
      // An oversized inline object still has to clear a blocked column. This
      // clips only its clearance footprint, never its authored paint geometry.
      Math.min(line.width + width, Math.max(0, context.right - context.left()))
    );
    if (skip > 0.001) {
      line.exclusionSkipBefore = (line.exclusionSkipBefore ?? 0) + skip;
      if (!hasContent) line.width = 0;
      appliedLine = line;
    }
  };
  const finalizeTopAndBottomClearance = (): void => {
    const line = context.line();
    const zones = context.zones();
    if (zones.length === 0) return;
    const skip = Math.max(
      topAndBottomSkipBeforeLine(context.top(), line.height, zones),
      line.exclusionSkipBefore ?? 0
    );
    if (skip > 0.001) line.exclusionSkipBefore = skip;
    else delete (line as { exclusionSkipBefore?: number }).exclusionSkipBefore;
  };
  return {
    applyTopAndBottomSkipIfNeeded,
    applyNarrowWrapSkipIfNeeded,
    applyInlineObjectSkipIfNeeded,
    finalizeTopAndBottomClearance,
  };
}

/** Keep prospective metrics separate from the line until the candidate is actually placed. */
export function createLineExclusionProbe(context: {
  line: () => PendingLine;
  top: () => number;
  left: number;
  right: number;
  lineSpacing: ParagraphLineSpacing;
  initialMetrics: ReturnType<TextMeasurer['lineMetrics']>;
}) {
  let candidate = context.initialMetrics;
  let candidateWidth = Infinity;
  const y = () => context.top() + (context.line().exclusionSkipBefore ?? 0) + 0.001;
  const height = () => {
    const line = context.line();
    const baseline = Math.max(line.baseline, candidate.baseline);
    const extent =
      baseline + Math.max(line.height - line.baseline, candidate.height - candidate.baseline);
    return applyLineSpacing(context.lineSpacing, extent, baseline).height;
  };
  return {
    setMetrics: (metrics: ReturnType<TextMeasurer['lineMetrics']>, width = Infinity) => {
      candidate = metrics;
      candidateWidth = width;
    },
    setWidth: (width: number) => {
      candidateWidth = width;
    },
    intervals: (zones: readonly ExclusionZone[]) =>
      mergeAvailableIntervalsAtY(y(), zones, context.left, context.right, height()),
    relocate: (zones: readonly ExclusionZone[]) =>
      relocateLineForExclusionGrowth(
        context.line(),
        y(),
        height(),
        zones,
        context.left,
        context.right,
        context.lineSpacing,
        candidateWidth
      ),
  };
}

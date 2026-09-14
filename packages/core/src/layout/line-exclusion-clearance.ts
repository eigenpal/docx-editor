import { topAndBottomSkipBeforeLine, type ExclusionZone } from './drawing-exclusion.ts';
import { narrowRectangularWrapSkip } from './narrow-wrap-clearance.ts';
import type { PendingLine } from './pending-line.ts';
import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

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
  let checkedLine: PendingLine | undefined;
  let checkedSpans = 0;
  let hasAdvance = false;
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
    if (line.drawings.length > 0) return;
    if (line !== checkedLine || line.spans.length < checkedSpans) {
      checkedLine = line;
      checkedSpans = 0;
      hasAdvance = false;
    }
    if (hasAdvance) return;
    const zones = context.zones();
    if (zones.length === 0) return;
    // Pending spans append or coalesce into the last span. Recheck that tail,
    // without rescanning every earlier zero-width run for each new candidate.
    for (let index = Math.max(0, checkedSpans - 1); index < line.spans.length; index++) {
      if (line.spans[index]!.box.width !== 0) hasAdvance = true;
    }
    checkedSpans = line.spans.length;
    if (hasAdvance) return;
    applyTopAndBottomSkipIfNeeded();
    const metrics = context.measurer.lineMetrics(style);
    const height = Math.max(line.height, metrics.height);
    const baseline = Math.max(line.baseline, metrics.baseline);
    // Controls and unattached marks can precede the first visible glyph, including
    // across run boundaries. Their zero advance must not settle its passage width.
    let glyphWidth = 0;
    for (const glyph of text) {
      glyphWidth = context.measurer.measure(displayText(glyph, style), style);
      if (glyphWidth !== 0) break;
    }
    const skip = narrowRectangularWrapSkip(
      context.top() + (line.exclusionSkipBefore ?? 0),
      Math.max(height, applyLineSpacing(context.lineSpacing, height, baseline).height),
      zones,
      context.left(),
      context.right,
      glyphWidth
    );
    if (skip > 0.001) {
      line.exclusionSkipBefore = (line.exclusionSkipBefore ?? 0) + skip;
      line.width = 0;
      for (let index = 0; index < line.spans.length; index++) {
        const span = line.spans[index]!;
        line.spans[index] = { ...span, box: { ...span.box, x: context.left() } };
      }
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
    finalizeTopAndBottomClearance,
  };
}

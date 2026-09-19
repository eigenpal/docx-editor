// Shared rule placement for separator atoms within authored note stories.
import type { LayoutBox, LineRecord, StyleSpanRecord } from './semantic-records.ts';
import { baselineShiftPtOf } from './run-style.ts';

/** Story-relative rule box for a measured separator span. @public */
export function noteSeparatorRuleBox(span: StyleSpanRecord, line: LineRecord): LayoutBox {
  return {
    x: span.box.x,
    y: Math.max(
      line.box.y,
      line.box.y + line.baseline - baselineShiftPtOf(span.style) - span.style.fontSizePt / 4
    ),
    width: span.box.width,
    height: 0.5,
  };
}

import type { PendingLine } from './pending-line.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const HEX_FILL = /^[0-9A-Fa-f]{6}$/;

/** True when the span paints a character fill: a highlight or character shading. */
function hasCharacterFill(span: StyleSpanRecord): boolean {
  const { highlight, shading } = span.style;
  return (!!highlight && highlight !== 'none') || (!!shading && HEX_FILL.test(shading));
}

/**
 * Publish the band that character highlight and shading fill on `line`, when its runs share one.
 *
 * Exact spacing fills the whole line box, whatever the run sizes. An inline drawing taller than
 * the text raises the line's content, and the fill then covers the natural content band beside
 * it: from where the content starts (below any room that line spacing or a line grid adds above
 * it) through the content's natural height. Auto spacing extra below the content stays clear.
 * Every other line, including one whose drawings fit inside its text band, publishes no band,
 * and each run fills its own box.
 *
 * `natural` is the line's height and baseline before line spacing applied.
 */
export function setCharacterFillBand(
  line: PendingLine,
  exact: boolean,
  natural: { readonly height: number; readonly baseline: number }
): void {
  if ((!exact && line.drawings.length === 0) || !line.spans.some(hasCharacterFill)) return;
  if (exact) {
    line.characterFillBand = { top: 0, height: line.height };
    return;
  }
  // A drawing that fits inside the tallest text box raises nothing.
  const textBand = line.spans.reduce((tallest, span) => Math.max(tallest, span.box.height), 0);
  if (natural.height <= textBand + 0.01) return;
  const top = Math.min(Math.max(0, line.baseline - natural.baseline), line.height);
  line.characterFillBand = { top, height: Math.min(natural.height, line.height - top) };
}

// Justified paragraph wrap and space stretch/shrink.
//
// Word hangs collapsible U+0020 at wrap time, then on a non-last `w:jc both` line may
// compress expandable ordinary spaces so a word that is only slightly over still fits.
// Expansion is unchanged: slack still lands after expandable U+0020 only. NBSP is never a
// shrink/stretch slot and never a wrap boundary.

import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

/**
 * How far past the line's right edge a span may reach before it counts as overflow.
 *
 * A right/centre/decimal tab computes its advance in ABSOLUTE x — `destination - currentX -
 * segmentWidth` — while wrapping is decided in line-local width. Converting between the two
 * subtracts and re-adds the paragraph origin, so a segment the tab placed to end EXACTLY at
 * the edge lands a fraction of an ulp beyond it. Without a tolerance that hairline decides a
 * line break, and a right-aligned tab is built to reach the edge exactly. A thousandth of a
 * point is far below one device pixel, so nothing a reader could see wraps because of this.
 */
export const OVERFLOW_TOLERANCE_PT = 0.001;

/**
 * True when this span's trailing U+0020 is an inter-word slot Word can stretch or shrink.
 *
 * Paint reapplies justification as CSS `word-spacing` on those same spaces. Inserting layout
 * slack at every style-span boundary (tabs, run splits mid-phrase) put gaps where paint has
 * none and shifted every later span — caret mid-word drifted by a multiple of the step while
 * the highlight (DOM) stayed on the glyphs.
 */
export function endsWithExpandableSpace(text: string): boolean {
  return text.endsWith(' ');
}

/**
 * Minimum advance of an expandable U+0020 under justified shrink.
 *
 * Word compresses inter-word spaces, not below the larger of half the space glyph and 1/6 em.
 * The floor is per space, from that run's own metrics, never a document-wide constant.
 */
export function minExpandableSpaceWidth(spaceWidth: number, fontSizePt: number): number {
  if (!(spaceWidth > 0) || !(fontSizePt > 0)) return 0;
  return Math.min(spaceWidth, Math.max(spaceWidth * 0.5, fontSizePt / 6));
}

/** Strip trailing U+0020 only. NBSP stays, so a glued word remains one unit. */
export function stripTrailingOrdinarySpaces(text: string): string {
  return text.replace(/ +$/u, '');
}

/**
 * Width that decides whether a candidate overflows, omitting hanging U+0020.
 *
 * A connector that is only U+0020 contributes nothing. Trailing U+0020 on a visible word
 * does not decide whether that word fits.
 */
export function visibleCandidateWidth(
  candidate: string,
  measuredWidth: number,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): number {
  if (!candidate.endsWith(' ')) return measuredWidth;
  const visible = stripTrailingOrdinarySpaces(candidate);
  if (visible.length === 0) return 0;
  return measureDisplayText(visible, style, measurer);
}

/**
 * Trailing U+0020 width on a span that also holds visible text.
 *
 * A span that is only U+0020 is left intact: it may be a connector before an inline
 * drawing, and hanging it would shift the drawing. Line-end fill runs stay on the
 * `lineEndWhitespace` path instead.
 */
export function trailingCollapsibleSpaceWidth(
  span: StyleSpanRecord,
  measurer: TextMeasurer
): number {
  if (!endsWithExpandableSpace(span.text)) return 0;
  const visible = stripTrailingOrdinarySpaces(span.text);
  if (visible.length === 0) return 0;
  const face = styleForFontSlot(span.style, span.fontSlot);
  return Math.max(0, span.box.width - measureDisplayText(visible, face, measurer));
}

/** Advance of hanging/collapsible U+0020 already at the end of the line. */
export function hangingBoundarySpaceWidth(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): number {
  let hanging = 0;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]!;
    if (span.lineEndWhitespace === true) {
      hanging += span.box.width;
      continue;
    }
    if (!endsWithExpandableSpace(span.text)) break;
    const visible = stripTrailingOrdinarySpaces(span.text);
    if (visible.length === 0) {
      hanging += span.box.width;
      continue;
    }
    if (visible === span.text) break;
    const face = styleForFontSlot(span.style, span.fontSlot);
    hanging += Math.max(0, span.box.width - measureDisplayText(visible, face, measurer));
    break;
  }
  return hanging;
}

/** How far one candidate's trailing U+0020 may shrink before it hits the floor. */
export function expandableSpaceCapacity(
  candidate: string,
  measuredWidth: number,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): number {
  if (!endsWithExpandableSpace(candidate)) return 0;
  const visible = stripTrailingOrdinarySpaces(candidate);
  const spaceWidth =
    visible.length === 0
      ? measuredWidth
      : Math.max(0, measuredWidth - measureDisplayText(visible, style, measurer));
  return Math.max(0, spaceWidth - minExpandableSpaceWidth(spaceWidth, style.fontSizePt));
}

/** How far expandable U+0020 on this line may shrink before they hit the floor. */
export function expandableShrinkBudget(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): number {
  let budget = 0;
  for (let index = 0; index < spans.length; index += 1) {
    if (!endsWithExpandableSpace(spans[index]!.text)) continue;
    // A line-end hang is not an inter-word slot. A connector U+0020 still is.
    if (spans[index]!.lineEndWhitespace === true) continue;
    budget += shrinkCapacityOf(spans[index]!, measurer);
  }
  return budget;
}

/**
 * Whether adding `visibleWidth` overflows `available` after hanging spaces and shrink.
 *
 * `lineWidth` includes committed connectors. `visibleWidth` omits trailing U+0020.
 * Shrink applies only when the caller knows this will not be the last justified line.
 */
export function candidateNeedsWrap(input: {
  readonly lineWidth: number;
  readonly visibleWidth: number;
  readonly available: number;
  readonly allowShrink: boolean;
  readonly shrinkBudget: number;
  readonly tolerance?: number;
}): boolean {
  const tolerance = input.tolerance ?? OVERFLOW_TOLERANCE_PT;
  const natural = input.lineWidth + input.visibleWidth;
  if (natural <= input.available + tolerance) return false;
  const needed = natural - input.available;
  return !(input.allowShrink && needed <= input.shrinkBudget + tolerance);
}

/**
 * Shift a line's spans to satisfy the paragraph alignment.
 *
 * Layout is the only geometry authority: hit testing and the caret read published span boxes
 * and measure intra-span prefixes on demand. Paint starts the line at `LineRecord.contentX` —
 * the first span's x whenever there is one — and flows inline, so justification slack must
 * land on the same inter-word spaces `word-spacing` expands, not on every style-span boundary.
 *
 * A line with NO spans returns unchanged; its alignment is published as `contentX` by the
 * callers, which is the only place an empty paragraph's caret x can come from.
 */
export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth?: number
): readonly StyleSpanRecord[] {
  if (spans.length === 0) return spans;
  if (alignment === 'left') return spans;

  let trailingEnd = spans.length;
  while (
    trailingEnd > 0 &&
    spans[trailingEnd - 1]!.box.width === 0 &&
    (spans[trailingEnd - 1]!.text === '\n' || spans[trailingEnd - 1]!.text === PAGE_BREAK_CHAR)
  ) {
    trailingEnd -= 1;
  }
  let trailingStart = trailingEnd;
  while (trailingStart > 0 && spans[trailingStart - 1]!.lineEndWhitespace) {
    trailingStart -= 1;
  }
  const lastContentSpan = spans[trailingEnd - 1];
  const spansReachLineEnd =
    lineUsedWidth !== undefined &&
    lastContentSpan !== undefined &&
    Math.abs(lastContentSpan.box.x + lastContentSpan.box.width - indentLeft - lineUsedWidth) <=
      OVERFLOW_TOLERANCE_PT;
  if (
    trailingStart < trailingEnd &&
    spansReachLineEnd &&
    (alignment === 'center' || alignment === 'right')
  ) {
    const used = spans[trailingStart]!.box.x - indentLeft;
    const slack = available - used;
    if (slack <= 0) return spans;
    const offset = alignment === 'center' ? slack / 2 : slack;
    const clipsAtMargin = (lineUsedWidth ?? 0) >= available - OVERFLOW_TOLERANCE_PT;
    let fillX = spans[trailingStart]!.box.x + offset;
    return spans.map((span, index) => {
      if (index < trailingStart) return { ...span, box: { ...span.box, x: span.box.x + offset } };
      if (!clipsAtMargin) return { ...span, box: { ...span.box, x: span.box.x + offset } };
      const width = Math.min(span.box.width, Math.max(0, indentLeft + available - fillX));
      const aligned = { ...span, box: { ...span.box, x: fillX, width } };
      fillX += width;
      return aligned;
    });
  }

  // Trailing whitespace hangs into the margin rather than pushing the text off-centre, which
  // is what Word does and what stops a line ending in a space from looking misaligned.
  const last = spans[spans.length - 1]!;
  const visible = last.text.replace(/\s+$/u, '');
  // `box.width` was reserved from the DRAWN text, so the visible part has to be measured the
  // same way: the difference is what the trailing whitespace measures, and mixing a drawn
  // total with a source-measured visible part reports nearly the whole span as whitespace.
  // Justify still uses that price when `lineUsedWidth` is absent. Centre and right always
  // subtract collapsible trailing U+0020, including when the caller passes `lineUsedWidth`.
  const trailing =
    visible === last.text
      ? 0
      : last.box.width -
        measureDisplayText(visible, styleForFontSlot(last.style, last.fontSlot), measurer);
  const geometricUsed = last.box.x - indentLeft + last.box.width;
  const lastContent = spans[trailingEnd - 1] ?? last;
  const used =
    alignment === 'center' || alignment === 'right'
      ? (lineUsedWidth ?? geometricUsed) - trailingCollapsibleSpaceWidth(lastContent, measurer)
      : (lineUsedWidth ?? geometricUsed - trailing);
  const slack = available - used;

  // The last line of a justified paragraph is set flush left, never stretched or compressed.
  if (alignment === 'both') {
    if (isLastLine || Math.abs(slack) <= OVERFLOW_TOLERANCE_PT) return spans;
    return applyJustifySlack(spans, slack, measurer);
  }

  if (slack <= 0) return spans;
  const offset = alignment === 'center' ? slack / 2 : slack;
  return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } }));
}

function shrinkCapacityOf(span: StyleSpanRecord, measurer: TextMeasurer): number {
  const face = styleForFontSlot(span.style, span.fontSlot);
  const visible = stripTrailingOrdinarySpaces(span.text);
  const spaceWidth =
    visible.length === 0
      ? span.box.width
      : Math.max(0, span.box.width - measureDisplayText(visible, face, measurer));
  const floor = minExpandableSpaceWidth(spaceWidth, face.fontSizePt);
  return Math.max(0, spaceWidth - floor);
}

function applyJustifySlack(
  spans: readonly StyleSpanRecord[],
  slack: number,
  measurer: TextMeasurer
): readonly StyleSpanRecord[] {
  const gapBefore: number[] = [];
  for (let index = 1; index < spans.length; index += 1) {
    if (endsWithExpandableSpace(spans[index - 1]!.text)) gapBefore.push(index);
  }
  if (gapBefore.length === 0) return spans;
  if (slack > 0) {
    const step = slack / gapBefore.length;
    const gapSet = new Set(gapBefore);
    let shift = 0;
    return spans.map((span, index) => {
      if (gapSet.has(index)) shift += step;
      return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
    });
  }
  const capacities = gapBefore.map((index) => shrinkCapacityOf(spans[index - 1]!, measurer));
  const shrinks = distributeCappedShrink(-slack, capacities);
  const shrinkAt = new Array<number>(spans.length).fill(0);
  for (let slot = 0; slot < gapBefore.length; slot += 1) {
    shrinkAt[gapBefore[slot]! - 1] = shrinks[slot]!;
  }
  let xShift = 0;
  return spans.map((span, index) => {
    const shrink = shrinkAt[index]!;
    if (xShift === 0 && shrink === 0) return span;
    const next = {
      ...span,
      box: { ...span.box, x: span.box.x + xShift, width: span.box.width - shrink },
    };
    xShift -= shrink;
    return next;
  });
}

/** Take `needed` uniformly, never more than each slot's remaining capacity. */
export function distributeCappedShrink(needed: number, capacities: readonly number[]): number[] {
  const shrinks = capacities.map(() => 0);
  let remaining = Math.max(0, needed);
  const active = capacities.map((_, index) => index);
  let guard = 0;
  while (remaining > OVERFLOW_TOLERANCE_PT && active.length > 0 && guard < capacities.length + 2) {
    guard += 1;
    const step = remaining / active.length;
    for (let cursor = active.length - 1; cursor >= 0; cursor -= 1) {
      const index = active[cursor]!;
      const room = capacities[index]! - shrinks[index]!;
      const take = Math.min(step, room);
      shrinks[index] += take;
      remaining -= take;
      if (room - take <= OVERFLOW_TOLERANCE_PT) active.splice(cursor, 1);
    }
  }
  return shrinks;
}

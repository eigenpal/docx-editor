// The room a character border takes on its line.
//
// A run border (`w:bdr`, CT_Border, ECMA-376 Part 1, 17.3.2.4) is drawn around its text, the
// border's `w:space` away from it. The border takes room in the line: each side of a
// bordered passage advances the pen by the space plus the line width, so the border never
// covers the text beside it and never leaves the line. Adjacent runs with the same border
// share one passage and one outline; every line a passage wraps onto closes its own outline.
//
// The room is a gap before a span, as the automatic East Asian spacing is, so alignment, hit
// testing and both painters place it without a rule of their own. The side that closes a line
// has no span after it: it is added to the line's width when the line closes.

import {
  borderStrokeWidthPt,
  runBorderStart,
  sameBorderEdge,
  withRunBorderJoin,
} from './border-metrics.ts';
import type { ParagraphBorderEdge } from './paragraph-style.ts';
import type { PendingLine } from './pending-line.ts';
import { growRunBorderLineMetrics } from './run-border-strokes.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Whether text of this style paints a character border: visible, and more than a break. */
export function paintsRunBorder(style: BorderedText['style'], text: string): boolean {
  return !!style.border && !style.hidden && text !== '' && !/^[\r\n\f]+$/.test(text);
}

/** The room one side of a border takes: its space plus its line width, in points. */
export function runBorderPad(edge: ParagraphBorderEdge): number {
  return Math.max(0, edge.spacePt + borderStrokeWidthPt(edge.val, edge.widthPt));
}

/** The fields of a placed span that decide its border room. A `StyleSpanRecord` is one. */
export interface BorderedText {
  readonly style: Pick<ResolvedRunStyle, 'border' | 'hidden'>;
  readonly text: string;
  readonly range: { readonly paragraphId: string; readonly start: number; readonly end: number };
}
type Placed = BorderedText;

/**
 * The room the borders take between the last span on a line and the text placed after it: the
 * closing side of the border around `last` plus the opening side of the border around `next`.
 * Zero where the two share one outline, and where neither has a border. `last` is undefined at
 * the start of a line.
 */
export function runBorderGapBetween(last: Placed | undefined, next: Placed): number {
  const closes = !!last && paintsRunBorder(last.style, last.text);
  const opens = paintsRunBorder(next.style, next.text);
  if (
    closes &&
    opens &&
    sameBorderEdge(last!.style.border!, next.style.border!) &&
    last!.range.paragraphId === next.range.paragraphId &&
    last!.range.end === runBorderStart(next)
  )
    return 0;
  return (
    (closes ? runBorderPad(last!.style.border!) : 0) +
    (opens ? runBorderPad(next.style.border!) : 0)
  );
}

/**
 * {@link runBorderGapBetween} for two spans that sit side by side after bidi reordering: text
 * that continues on either side shares the outline, as the strokes group it.
 */
export function runBorderGapBeside(left: Placed | undefined, right: Placed): number {
  if (
    left &&
    runBorderStart(left) === right.range.end &&
    left.range.paragraphId === right.range.paragraphId
  )
    return runBorderGapBetween(right, left);
  return runBorderGapBetween(left, right);
}

type Gap = (text?: string, start?: number) => number;

/** The border room of one paragraph while its lines break. */
export interface RunBorderAdvance {
  /**
   * The room the line keeps free past the text being placed: the closing side of its border.
   * A bordered word fits a line only together with the side that closes it there.
   */
  trailing: number;
  /** `gap` with the border room before the candidate text of `style` added. */
  readonly gapBefore: (
    gap: Gap,
    style: ResolvedRunStyle,
    candidate: string,
    candidateStart: number
  ) => Gap;
  /**
   * Close the border before an inline object: a picture, an equation or a placeholder. The
   * object is outside the border, so the side closes before it and takes its room there.
   */
  readonly beforeObject: () => void;
  /**
   * Close the border the line ends in: reserve the border's height, and add its closing side
   * to the line's width. Where the line wraps inside the bordered text, the spaces at the wrap
   * hang outside the border, so the side closes after the last visible character and takes the
   * room of those spaces first.
   */
  readonly closeLine: (line: PendingLine) => void;
}

const BREAK_ONLY = /^[\r\n\f]+$/;
const SPACES_ONLY = /^ +$/;

/**
 * The border room of a paragraph with these pieces. A paragraph without a character border
 * takes none and keeps its gaps as they are. The gaps follow the logical order; a line with
 * right-to-left text places them again in its visual order ({@link runBorderGapBeside}).
 */
export function runBorderAdvance(
  pieces: readonly {
    readonly style: ResolvedRunStyle;
    readonly start: number;
    readonly end: number;
  }[],
  paragraphId: string,
  line: () => PendingLine,
  measurer: TextMeasurer
): RunBorderAdvance {
  const bordered = pieces.some((piece) => piece.style.border);
  if (!bordered) {
    return { trailing: 0, gapBefore: (gap) => gap, beforeObject: () => {}, closeLine: () => {} };
  }
  const paragraphEnd = pieces.at(-1)?.end ?? 0;
  const joins = new Map<number, number>();
  for (let index = 1; index < pieces.length; index++) {
    const [before, piece] = [pieces[index - 1]!, pieces[index]!];
    if (piece.start > before.end) joins.set(piece.start, before.end);
  }
  const joined = <T extends Placed>(value: T): T => {
    const from = joins.get(value.range.start);
    return from === undefined ? value : withRunBorderJoin(value, from);
  };
  // The model offset where a border closed before an inline object. The span that ends there
  // has its closing side on the line already.
  let closedAt = -1;
  const open = (last: StyleSpanRecord | undefined): StyleSpanRecord | undefined =>
    last && last.range.end === closedAt ? undefined : last;
  const advance: RunBorderAdvance = {
    trailing: 0,
    gapBefore: (gap, style, candidate, candidateStart) => {
      advance.trailing = paintsRunBorder(style, candidate) ? runBorderPad(style.border!) : 0;
      return (text = candidate, start = candidateStart) =>
        gap(text, start) +
        runBorderGapBetween(
          open(line().spans.at(-1)),
          joined({ style, text, range: { paragraphId, start, end: start + text.length } })
        );
    },
    beforeObject: () => {
      advance.trailing = 0;
      const current = line();
      const last = open(current.spans.at(-1));
      const pad = closingRunBorderPad(last);
      if (pad === 0) return;
      current.width += pad;
      closedAt = last!.range.end;
    },
    closeLine: (closing) => {
      growRunBorderLineMetrics(closing, measurer);
      const spans = closing.spans;
      if (joins.size > 0) for (const [at, span] of spans.entries()) spans[at] = joined(span);
      let index = spans.length - 1;
      // A break that ends the line is no text: the border closes before it, with its spaces.
      const endsInBreak = index >= 0 && BREAK_ONLY.test(spans[index]!.text);
      while (index >= 0 && BREAK_ONLY.test(spans[index]!.text)) index -= 1;
      const last = open(spans[index]);
      if (!last || !paintsRunBorder(last.style, last.text)) return;
      const pad = runBorderPad(last.style.border!);
      if (endsInBreak || closing.end >= paragraphEnd) {
        closing.width += pad;
        return;
      }
      // Spaces in spans of their own hang whole; the last word hangs the spaces it ends in.
      let hang = 0;
      while (
        index > 0 &&
        SPACES_ONLY.test(spans[index]!.text) &&
        runBorderGapBetween(spans[index - 1], spans[index]!) === 0
      ) {
        const space = spans[index]!;
        hang += space.box.width;
        spans[index] = { ...space, borderEndTrimPt: space.box.width };
        index -= 1;
      }
      const word = spans[index]!;
      const visible = word.text.replace(/ +$/, '');
      if (visible !== word.text && visible !== '') {
        const style = styleForFontSlot(word.style, word.fontSlot);
        const trim = Math.max(
          0,
          word.box.width - measurer.measure(displayText(visible, style), style)
        );
        if (trim > 0.001) spans[index] = { ...word, borderEndTrimPt: trim };
        hang += trim;
      }
      closing.width += Math.max(0, pad - hang);
    },
  };
  return advance;
}

/**
 * The closing side of the border a justified line ends in, in points: room the line keeps
 * free after its last visible character, as {@link RunBorderAdvance.closeLine} gives it.
 */
export function closingRunBorderPad(last: Placed | undefined): number {
  return last && paintsRunBorder(last.style, last.text) ? runBorderPad(last.style.border!) : 0;
}

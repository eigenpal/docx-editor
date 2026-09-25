import { shrinkJustifiedSpans } from './paragraph-space-shrink.ts';
import { PAGE_BREAK_CHAR, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphIsRtl, reorderBidiSpans, splitBidiTrailingWhitespace } from './rtl-paragraph.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { justifyCjkSpans } from './cjk-justify.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';

const OVERFLOW_TOLERANCE_PT = 0.001;

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

/**
 * The PHYSICAL alignment of a paragraph.
 *
 * In a bidi paragraph Word reads `left` and `right` as the leading and trailing edges, the
 * same as `start` and `end`: `<w:bidi/><w:jc w:val="left"/>` sits at the right margin
 * (verified against Word 16 PDF output). The kashida and Thai variants justify.
 */
export function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
  const rtl = paragraphIsRtl(props);
  const leading: Alignment = rtl ? 'right' : 'left';
  const trailing: Alignment = rtl ? 'left' : 'right';
  let alignment: Alignment = leading;
  for (const property of props) {
    if (property.localName !== 'jc') continue;
    switch (property.attributes?.val) {
      case 'center':
        alignment = 'center';
        break;
      case 'right':
      case 'end':
        alignment = trailing;
        break;
      case 'both':
      case 'distribute':
      case 'lowKashida':
      case 'mediumKashida':
      case 'highKashida':
      case 'thaiDistribute':
        alignment = 'both';
        break;
      default:
        alignment = leading;
    }
  }
  return alignment;
}

/**
 * The `w:jc` value that puts a paragraph at a PHYSICAL edge, the inverse of
 * {@link paragraphAlignment}: a bidi paragraph reaches its right margin with `left`.
 */
export function jcValueForAlignment(
  alignment: 'left' | 'center' | 'right' | 'justify' | 'both',
  rtl: boolean
): string {
  if (alignment === 'center') return 'center';
  if (alignment === 'justify' || alignment === 'both') return 'both';
  if (!rtl) return alignment;
  return alignment === 'left' ? 'right' : 'left';
}

/**
 * True when this span's trailing U+0020 is an inter-word slot Word can stretch.
 *
 * Paint reapplies justification as CSS `word-spacing` on those same spaces. Inserting layout
 * slack at every style-span boundary (tabs, run splits mid-phrase) put gaps where paint has
 * none and shifted every later span — caret mid-word drifted by a multiple of the step while
 * the highlight (DOM) stayed on the glyphs.
 */
function endsWithExpandableSpace(text: string): boolean {
  return text.endsWith(' ');
}

/**
 * Align logical spans before bidi reordering. Layout publishes the shared geometry.
 * Justification expands inter-word spaces, matching paint's CSS word-spacing.
 * Empty lines stay unchanged; callers publish their aligned origin as contentX.
 */
function alignLogicalSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth: number | undefined,
  paragraphRtl: boolean
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
  // Clipped whitespace runs hang past the content: with two of them the last one is a
  // zero-width span AT the measure, so last-span arithmetic reports no slack at all. The
  // content ends where the first hanging span starts, whatever hangs after it.
  const hangingStart =
    trailingStart < spans.length ? spans[trailingStart]!.box.x - indentLeft : undefined;
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
    const slack = available - hangingStart!;
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
  // `box.width` was reserved from the DRAWN text, so the visible part has to be measured the
  // same way: the difference is what the trailing whitespace measures, and mixing a drawn
  // total with a source-measured visible part reports nearly the whole span as whitespace.
  // Centre and right pass `lineUsedWidth` and never read this; the path that does is a
  // JUSTIFIED non-last line, where an over-reported `trailing` inflates `slack` and
  // over-stretches the line. Measured only on that path.
  // `trimEnd` strips exactly the `\s` set, in linear time; `/\s+$/` is quadratic on a
  // long whitespace run that does not reach the end.
  const trailingWhitespaceOf = (span: StyleSpanRecord, visible = span.text.trimEnd()): number =>
    visible === span.text
      ? 0
      : span.box.width -
        measureDisplayText(visible, styleForFontSlot(span.style, span.fontSlot), measurer);
  const contentEndWithoutTrailingWhitespace = (): number =>
    last.box.x - indentLeft + last.box.width - trailingWhitespaceOf(last);
  // A justified line's hanging spaces may follow a word that keeps its own space (a double
  // space split across runs). That space hangs too: it is neither content nor a slot.
  // Only U+0020 hangs; a tab or a no-break space before the hanging spaces is content.
  const hangsAfterOwnSpace =
    alignment === 'both' &&
    !paragraphRtl &&
    lineUsedWidth === undefined &&
    trailingStart > 0 &&
    trailingStart < trailingEnd;
  let used =
    lineUsedWidth ??
    (hangingStart !== undefined && hangsAfterOwnSpace
      ? hangingStart -
        trailingWhitespaceOf(
          spans[trailingStart - 1]!,
          withoutTrailingSpaces(spans[trailingStart - 1]!.text)
        )
      : hangingStart) ??
    contentEndWithoutTrailingWhitespace();
  let rtlTrailingAdvance = 0;
  // A space retained at a natural wrap still owns its model/caret advance, but Word
  // centers/right-aligns the visible text. Do not subtract from drawing-owned width,
  // tabs or nonbreaking spaces: only a text span reaching the measured line end qualifies.
  if (
    (alignment === 'center' || alignment === 'right') &&
    spansReachLineEnd &&
    lastContentSpan?.text.endsWith(' ') &&
    !lastContentSpan.lineEndWhitespace
  ) {
    const visible = withoutTrailingSpaces(lastContentSpan.text);
    const width = measureDisplayText(
      visible,
      styleForFontSlot(lastContentSpan.style, lastContentSpan.fontSlot),
      measurer
    );
    const trailing = Math.max(0, lastContentSpan.box.width - width);
    used -= trailing;
    // Bidi puts these spaces before the visible text. Move the full line back by
    // their advance, so right/center alignment still anchors the visible glyphs.
    if (paragraphRtl) rtlTrailingAdvance = trailing;
  }
  const slack = available - used;
  if (slack < -0.001 && alignment === 'both' && !isLastLine)
    return shrinkJustifiedSpans(
      spans,
      -slack,
      measurer,
      hangsAfterOwnSpace ? trailingStart - 1 : spans.length - 1
    );
  if (slack <= 0) return spans;

  // The last line of a justified paragraph is set flush left, never stretched.
  if (alignment === 'both') {
    if (isLastLine) return spans;
    const justified = justifyCjkSpans(spans, measurer, slack);
    if (justified) return justified;
    // Only boundaries after an expandable space receive slack — the same slots paint stretches
    // with `word-spacing`. A uniform step across every span pair invented gaps before tabs and
    // run splits and drifted every later caret by N×step. Hanging whitespace runs are not
    // slots either: a boundary between two of them took a share of the slack from the words.
    const gapBefore: number[] = [];
    for (let index = 1; index < trailingStart; index += 1) {
      if (endsWithExpandableSpace(spans[index - 1]!.text)) gapBefore.push(index);
    }
    if (gapBefore.length === 0) return spans;
    const step = slack / gapBefore.length;
    const gapSet = new Set(gapBefore);
    let shift = 0;
    return spans.map((span, index) => {
      if (gapSet.has(index)) shift += step;
      return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
    });
  }

  const offset = (alignment === 'center' ? slack / 2 : slack) - rtlTrailingAdvance;
  return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } }));
}

export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth?: number,
  paragraphRtl = spans.some((span) => span.style.shaping?.baseLevel === 1)
): readonly StyleSpanRecord[] {
  const effective = alignment === 'both' && isLastLine && paragraphRtl ? 'right' : alignment;
  return reorderBidiSpans(
    alignLogicalSpans(
      splitBidiTrailingWhitespace(spans, measurer),
      measurer,
      indentLeft,
      available,
      effective,
      isLastLine,
      lineUsedWidth,
      paragraphRtl
    ),
    paragraphRtl
  );
}

/**
 * The horizontal box a line aligns inside: the passage a float left it, or the paragraph's
 * own measure when no float shortens the line.
 *
 * `used` is the line's content extent measured from that box's left edge, so the snap advance
 * a float forced before the first glyph is not mistaken for content and does not push a
 * centred line off toward the far margin.
 */
export function lineAlignmentMeasure(
  line: {
    readonly width: number;
    readonly wrapSegment?: { readonly start: number; readonly end: number };
  },
  columnX: number,
  lineIndent: number,
  lineAvailableWidth: number
): { readonly indent: number; readonly available: number; readonly used: number } {
  const segment = line.wrapSegment;
  if (!segment) {
    return { indent: lineIndent, available: lineAvailableWidth, used: line.width };
  }
  return {
    indent: columnX + segment.start,
    available: Math.max(1, segment.end - segment.start),
    used: lineIndent - columnX + line.width - segment.start,
  };
}

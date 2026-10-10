import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { StyleSpanRecord } from './semantic-records.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';

/** Spaces Word may hang/clip at a line end instead of wrapping onto a new line. */
export function isCollapsibleLineEndWhitespace(text: string): boolean {
  if (text.length === 0) return false;
  for (const char of text) {
    if (char !== ' ' && char !== '\u3000') return false;
  }
  return true;
}

/**
 * Whether the space that opens `pieces[index]` is the trailing space of the word before the
 * ignored page breaks in front of it. A table cell lays its text out as though the breaks
 * were absent, and then the word and its space are one candidate with one style, so the
 * space hangs only when it overflows, not because it ends the paragraph.
 */
export function endsWordAcrossIgnoredBreaks(
  pieces: readonly { readonly text: string; readonly style: object }[],
  index: number,
  candidate: string,
  lastEmitted: string
): boolean {
  if (candidate !== ' ' || !/\S$/u.test(lastEmitted)) return false;
  let before = index - 1;
  while (pieces[before]?.text === PAGE_BREAK_CHAR) before--;
  return before < index - 1 && pieces[before]?.style === pieces[index]!.style;
}

interface ClippedWordEnd {
  readonly length: number;
  readonly visibleWidth: number;
  readonly width: number;
}

/** The advance of a word without its trailing spaces; undefined when it has none, or no ink. */
export function wordInkWidth(text: string, measure: (text: string) => number): number | undefined {
  const ink = withoutTrailingSpaces(text);
  return ink.length === 0 || ink.length === text.length ? undefined : measure(ink);
}

/** Price only the ink when a word fits but its trailing separator crosses the margin. */
export function clipWordEnd(
  text: string,
  width: number,
  remaining: number,
  measure: (text: string) => number,
  tolerance: number
): ClippedWordEnd | undefined {
  if (width <= remaining + tolerance) return undefined;
  let length = text.length;
  // U+3000 participates in kinsoku groups; leave those authored groups to the CJK breaker.
  while (length > 0 && text[length - 1] === ' ') length--;
  if (length === 0 || length === text.length) return undefined;
  const visibleWidth = measure(text.slice(0, length));
  if (visibleWidth > remaining + tolerance) return undefined;
  return { length, visibleWidth, width: Math.max(visibleWidth, remaining) };
}

/** Only the fill receives the clipping flag; alignment still sees the whole visible word. */
export function appendWordEnd(
  spans: StyleSpanRecord[],
  span: StyleSpanRecord,
  clipped: ClippedWordEnd | undefined
): void {
  if (!clipped) {
    spans.push(span);
    return;
  }
  const split = span.range.start + clipped.length;
  spans.push(
    {
      ...span,
      text: span.text.slice(0, clipped.length),
      range: { ...span.range, end: split },
      box: { ...span.box, width: clipped.visibleWidth },
    },
    {
      ...span,
      text: span.text.slice(clipped.length),
      range: { ...span.range, start: split },
      box: {
        ...span.box,
        x: span.box.x + clipped.visibleWidth,
        width: Math.max(0, span.box.width - clipped.visibleWidth),
      },
      lineEndWhitespace: true,
    }
  );
}

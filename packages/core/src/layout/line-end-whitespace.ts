import type { StyleSpanRecord } from './semantic-records.ts';

/** Spaces Word may hang/clip at a line end instead of wrapping onto a new line. */
export function isCollapsibleLineEndWhitespace(text: string): boolean {
  if (text.length === 0) return false;
  for (const char of text) {
    if (char !== ' ' && char !== '\u3000') return false;
  }
  return true;
}

interface ClippedWordEnd {
  readonly length: number;
  readonly visibleWidth: number;
  readonly width: number;
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

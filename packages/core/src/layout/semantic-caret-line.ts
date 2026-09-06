import type { LineSegment } from './line-segments.ts';
import type { LineRecord, SemanticLayout } from './semantic-records.ts';
import { paragraphLinesIndex } from './paragraph-lines.ts';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';

/**
 * Whether a LATER line of the same paragraph starts at this offset, and so owns it.
 *
 * Asked across the whole paragraph rather than the current fragment: a paragraph split by a
 * page boundary continues on the next page, and the line that owns the position may live in
 * a different fragment. `caretAt` resolves against the same paragraph-wide index, so both
 * lanes answer with the same line. When nothing later claims it — a layout that produced no
 * line after the break — the break's own line keeps the stop rather than losing the position.
 */
export function laterLineOwns(layout: SemanticLayout, line: LineRecord, offset: number): boolean {
  const lines = paragraphLinesIndex(layout).get(line.range.paragraphId) ?? [];
  let seen = false;
  for (const placed of lines) {
    if (placed.line === line) {
      seen = true;
      continue;
    }
    if (seen && placed.line.range.start === offset) return true;
  }
  return false;
}

/** The continuation line when a soft wrap opens on an inline drawing atom. */
export function laterLineWithDrawingAt(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): LineRecord | null {
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    if (line.range.start !== offset) continue;
    if (line.drawings?.some((drawing) => drawing.start === offset)) return line;
  }
  return null;
}

/**
 * True when `offset` sits strictly inside a span that is not a 1:1 model↔paint mapping
 * (projected PAGE digits, leaders) — those interiors are not navigable caret stops.
 * Tabs keep a 1:1 `\t` range; their wide box is still only two stops (before/after).
 */
export function isNonNavigableInterior(
  line: LineRecord,
  offset: number,
  segment?: LineSegment
): boolean {
  for (const span of segment ? segment.spans : line.spans) {
    if (offset <= span.range.start || offset >= span.range.end) continue;
    if (span.projected) return true;
    if (span.text.length !== span.range.end - span.range.start) return true;
  }
  return false;
}

/**
 * Whether an authored break is what ended this line.
 *
 * The break OCCUPIES a model offset and is published as a zero-width span, so a line that a
 * Shift+Enter terminated carries it as its last span. That is the one case where a position
 * shared by two lines is not ambiguous — see `caretAt`.
 *
 * A PAGE break counts for exactly the same reason, and leaving it out was worse than the
 * hard-break case rather than milder: the line it opens is on the NEXT PAGE, so reporting
 * the end of the line the break closed put the caret on a different page from the text that
 * would be typed at it. Click below the last line, type, and the letters appear a page
 * later. A column break already arrives here as `\n` — only `w:type="page"` projects its
 * own character.
 */
export function endsWithLineBreak(line: {
  readonly spans: readonly { readonly text: string }[];
}): boolean {
  const last = line.spans[line.spans.length - 1]?.text;
  return last === '\n' || last === PAGE_BREAK_CHAR;
}

/**
 * Whether this paragraph's slice of the line is ONE inline drawing and nothing else — a
 * picture too wide to share its line, painted as a block in text clothing.
 *
 * That is the other case where the position shared by two lines is not ambiguous, and it is
 * the hard-break case wearing an image: the drawing is what ended the line, so the caret at
 * the offset after it belongs before the text that follows. Painting it at the picture's
 * right edge instead meant a click before that text resolved the right offset but drew the
 * caret a full picture away — the caret looked stuck beside the following words, and there
 * was no click that showed one at the text's start.
 */
export function isDrawingOnlySegment(line: LineRecord, segment: LineSegment): boolean {
  if (segment.end - segment.start !== 1) return false;
  if (!line.drawings?.some((drawing) => drawing.start === segment.start)) return false;
  for (const span of segment.spans) {
    if (span.range.end > span.range.start) return false;
  }
  return true;
}

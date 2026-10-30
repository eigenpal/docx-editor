// The word a caret format or a format painter click reaches.
//
// A format picked at a caret strictly inside a word formats the whole word; at a word's edge
// it only arms the next typed text. The word here is letters, digits, combining marks, and
// apostrophes: a hyphen, an underscore, a period, or a comma ends it. Text a revision view
// hides (a tracked deletion in the proposed view) owns offsets but paints nothing, so it
// joins the visible letters on either side instead of splitting the word.

import { paragraphLinesFor } from './paragraph-lines.ts';
import { lineSegmentFor } from './line-segments.ts';
import { paragraphTextFromLayout } from './semantic-interaction.ts';
import type { SemanticLayout } from './semantic-records.ts';
import { inlineControlEdges } from './word-navigation-boundaries.ts';

const CARET_WORD_CHARACTER = /[\p{L}\p{M}\p{N}'’]/u;
/** Scripts written without spaces between words, segmented by dictionary. */
const DICTIONARY_SCRIPT = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** A word as canonical offsets: `start` inclusive, `end` exclusive. */
export interface CaretWordRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Paragraph text for word walks, with hidden revision text bridged.
 *
 * An offset no span paints reads as a word character when the painted characters on both
 * sides of its gap are word characters, so a walk crosses it. Every other offset reads as
 * `paragraphTextFromLayout` gives it.
 */
export function wordTextFromLayout(layout: SemanticLayout, paragraphId: string): string {
  const text = paragraphTextFromLayout(layout, paragraphId);
  const painted = new Uint8Array(text.length);
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      const end = Math.min(span.range.end, text.length);
      for (let offset = span.range.start; offset < end; offset += 1) painted[offset] = 1;
    }
  }
  const characters = text.split('');
  let index = 0;
  while (index < characters.length) {
    if (painted[index]) {
      index += 1;
      continue;
    }
    let gapEnd = index;
    while (gapEnd < characters.length && !painted[gapEnd]) gapEnd += 1;
    const joins =
      CARET_WORD_CHARACTER.test(text[index - 1] ?? ' ') &&
      CARET_WORD_CHARACTER.test(text[gapEnd] ?? ' ');
    if (joins) for (let offset = index; offset < gapEnd; offset += 1) characters[offset] = 'a';
    index = gapEnd;
  }
  return characters.join('');
}

/**
 * The word a format at a collapsed caret reaches, or null when the caret is not inside one.
 *
 * Inside means a word character on both sides of the caret, with no stop at the caret. A
 * stop (an inline control edge) also ends the word on either side.
 */
export function caretWordRange(
  text: string,
  offset: number,
  stops: ReadonlySet<number>
): CaretWordRange | null {
  const isWord = (index: number) => CARET_WORD_CHARACTER.test(text[index] ?? ' ');
  if (offset <= 0 || offset >= text.length || stops.has(offset)) return null;
  if (!isWord(offset - 1) || !isWord(offset)) return null;
  let start = offset - 1;
  while (start > 0 && isWord(start - 1) && !stops.has(start)) start -= 1;
  let end = offset + 1;
  while (end < text.length && isWord(end) && !stops.has(end)) end += 1;
  const narrowed = dictionaryWord(text, start, end, offset);
  return narrowed === undefined ? { start, end } : narrowed;
}

/**
 * The word a format at a collapsed caret formats in a laid-out paragraph, or null.
 *
 * Null as well when the caret sits inside tracked deleted text: a format picked there is for
 * the text typed next, which lands past the deletion, not for the deleted word.
 */
export function caretWordAt(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): CaretWordRange | null {
  if (insideDeletion(layout, paragraphId, offset)) return null;
  return caretWordRange(
    wordTextFromLayout(layout, paragraphId),
    offset,
    inlineControlEdges(layout, paragraphId)
  );
}

function insideDeletion(layout: SemanticLayout, paragraphId: string, offset: number): boolean {
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      // A span touching the character on either side of the caret.
      const { start, end } = span.range;
      if (start === end || start > offset || end < offset) continue;
      if (span.revisions?.some((entry) => entry.kind === 'delete' || entry.kind === 'moveFrom')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Narrow a run of dictionary-script text to the dictionary word holding the caret.
 *
 * Undefined when the run has no such script; null when the caret falls on a word boundary
 * inside the run, which is an edge rather than the inside of a word.
 */
function dictionaryWord(
  text: string,
  start: number,
  end: number,
  offset: number
): CaretWordRange | null | undefined {
  const run = text.slice(start, end);
  if (!DICTIONARY_SCRIPT.test(run) || typeof Intl.Segmenter !== 'function') return undefined;
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(run)) {
    const segmentStart = start + segment.index;
    const segmentEnd = segmentStart + segment.segment.length;
    if (offset === segmentStart) return null;
    if (offset > segmentStart && offset < segmentEnd)
      return { start: segmentStart, end: segmentEnd };
  }
  return null;
}

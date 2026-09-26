// Moves a word that overflows at a run boundary inside it. Extracted from paragraph-flow so
// that module stays inside its line budget; it is the only consumer.

import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { growLineMetricsForText, type PendingLine } from './pending-line.ts';
import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Where the word being placed opened on its line, and the line state before it. */
export interface WordStart {
  /** Index of the word's first span on the line. */
  readonly span: number;
  /** Pen position when the word opened. */
  readonly width: number;
  readonly end: number;
  /** Line metrics before the word, including drawings and equations it cannot regrow. */
  readonly height: number;
  readonly baseline: number;
}

/** The placement steps of the paragraph being broken, shared with its ordinary words. */
export interface WordCarryContext {
  readonly line: () => PendingLine;
  readonly measurer: TextMeasurer;
  readonly pageBreaksIgnored: boolean;
  /** Whether the line holds anything a word must follow. */
  readonly holdsContent: () => boolean;
  readonly closeLine: () => void;
  readonly ensurePlacementWidth: (width: number) => boolean;
  readonly tryAdvanceToNextPassage: () => boolean;
  readonly lineAvailable: () => number;
  readonly lineOrigin: () => number;
  readonly applyNarrowWrapSkipIfNeeded: (
    text: string,
    style: PendingLine['spans'][number]['style']
  ) => void;
  readonly setProbeWidth: (width: number) => void;
}

/** The word start of a line that holds nothing yet. */
export function wordStartOf(line: PendingLine, span = 0, width = 0): WordStart {
  return { span, width, end: line.end, height: line.height, baseline: line.baseline };
}

/**
 * Place a word again, as a whole, when the run being added to it overflows.
 *
 * A run boundary is not a break opportunity, so the word must land where the same text in
 * one run would: the next passage on this line when the whole word fits there, otherwise
 * the next line, in the first passage wide enough for it. `pendingWidth` is the overflowing
 * candidate, which the caller places after the word's earlier spans.
 */
export function carryPartialWord(
  context: WordCarryContext,
  start: WordStart,
  pendingWidth: number
): WordStart {
  let line = context.line();
  const carried = line.spans.splice(start.span);
  line.width = start.width;
  line.end = start.end;
  line.height = start.height;
  line.baseline = start.baseline;
  const wordWidth = carried.reduce((sum, span) => sum + span.box.width, pendingWidth);
  context.setProbeWidth(wordWidth);
  let next = start;
  if (context.holdsContent()) {
    if (
      !context.tryAdvanceToNextPassage() ||
      line.width + wordWidth > context.lineAvailable() + 0.001
    ) {
      context.closeLine();
      line = context.line();
      context.ensurePlacementWidth(wordWidth);
      next = wordStartOf(line);
    }
  } else if (wordWidth > context.lineAvailable() + 0.001) {
    context.ensurePlacementWidth(wordWidth);
  }
  const first = carried[0];
  if (first) {
    context.applyNarrowWrapSkipIfNeeded(first.text, styleForFontSlot(first.style, first.fontSlot));
  }
  // Snaps the pen into the passage the word takes.
  context.lineAvailable();
  for (const span of carried) {
    line.spans.push({ ...span, box: { ...span.box, x: context.lineOrigin() + line.width } });
    line.width += span.box.width;
    line.end = span.range.end;
    // An ignored cell page break adds no height, as when first placed.
    if (context.pageBreaksIgnored && span.text === PAGE_BREAK_CHAR) continue;
    const style = styleForFontSlot(span.style, span.fontSlot);
    const text = span.noteSeparator ? undefined : displayText(span.text, style);
    growLineMetricsForText(line, context.measurer.lineMetrics(style, text), span.text);
  }
  context.setProbeWidth(pendingWidth);
  return next;
}

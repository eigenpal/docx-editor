/**
 * Text search within paragraphs.
 * Handles text spanning multiple runs and tracked change wrappers.
 */

import type { Paragraph, Run } from '@eigenpal/docx-core/headless';
import { TextNotFoundError } from './errors';
import { getRunText, isTrackedChange } from './utils';

export interface TextSearchResult {
  /** Index of the run where the match starts */
  startRunIndex: number;
  /** Character offset within the start run */
  startOffset: number;
  /** Index of the run where the match ends */
  endRunIndex: number;
  /** Character offset within the end run (exclusive) */
  endOffset: number;
}

interface FlattenedRun {
  /** Index in the paragraph's content array */
  contentIndex: number;
  /** Index within a tracked change's content array, or -1 if top-level */
  innerIndex: number;
  run: Run;
  text: string;
  /** Cumulative start offset in the concatenated paragraph text */
  startPos: number;
}

/**
 * Flatten a paragraph's content into a list of runs with their positions,
 * walking into tracked change wrappers (Insertion, Deletion, etc.).
 */
function flattenRuns(paragraph: Paragraph): FlattenedRun[] {
  const result: FlattenedRun[] = [];
  let pos = 0;

  for (let ci = 0; ci < paragraph.content.length; ci++) {
    const item = paragraph.content[ci];

    if (item.type === 'run') {
      const text = getRunText(item);
      result.push({ contentIndex: ci, innerIndex: -1, run: item, text, startPos: pos });
      pos += text.length;
    } else if (item.type === 'hyperlink') {
      for (let hi = 0; hi < item.children.length; hi++) {
        const child = item.children[hi];
        if (child.type === 'run') {
          const text = getRunText(child);
          result.push({ contentIndex: ci, innerIndex: hi, run: child, text, startPos: pos });
          pos += text.length;
        }
      }
    } else if (isTrackedChange(item)) {
      for (let ri = 0; ri < item.content.length; ri++) {
        const child = item.content[ri];
        if (child.type === 'run') {
          const text = getRunText(child);
          result.push({ contentIndex: ci, innerIndex: ri, run: child, text, startPos: pos });
          pos += text.length;
        } else if (child.type === 'hyperlink') {
          for (const hc of child.children) {
            if (hc.type === 'run') {
              const text = getRunText(hc);
              result.push({ contentIndex: ci, innerIndex: ri, run: hc, text, startPos: pos });
              pos += text.length;
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * Get the full plain text of a paragraph (including tracked change content).
 */
export function getParagraphPlainText(paragraph: Paragraph): string {
  const runs = flattenRuns(paragraph);
  return runs.map((r) => r.text).join('');
}

/**
 * Find text within a paragraph. Returns the run indices and offsets.
 * Throws TextNotFoundError if not found.
 */
export function findTextInParagraph(
  paragraph: Paragraph,
  search: string,
  paragraphIndex?: number
): TextSearchResult {
  const runs = flattenRuns(paragraph);
  const fullText = runs.map((r) => r.text).join('');

  const matchStart = fullText.indexOf(search);
  if (matchStart === -1) {
    throw new TextNotFoundError(search, paragraphIndex);
  }
  const matchEnd = matchStart + search.length;

  // Find start run
  let startRunIdx = -1;
  let startOffset = 0;
  for (let i = 0; i < runs.length; i++) {
    const runEnd = runs[i].startPos + runs[i].text.length;
    if (matchStart < runEnd) {
      startRunIdx = i;
      startOffset = matchStart - runs[i].startPos;
      break;
    }
  }

  // Find end run
  let endRunIdx = -1;
  let endOffset = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (matchEnd > runs[i].startPos) {
      endRunIdx = i;
      endOffset = matchEnd - runs[i].startPos;
      break;
    }
  }

  if (startRunIdx === -1 || endRunIdx === -1) {
    throw new TextNotFoundError(search, paragraphIndex);
  }

  return {
    startRunIndex: runs[startRunIdx].contentIndex,
    startOffset,
    endRunIndex: runs[endRunIdx].contentIndex,
    endOffset,
  };
}

/**
 * Split paragraph content so the matched text is isolated into its own run(s).
 * Returns the content index range of the isolated matched runs.
 *
 * This mutates the paragraph's content array by splitting runs at match boundaries.
 */
export function isolateMatchedText(
  paragraph: Paragraph,
  search: string,
  paragraphIndex?: number
): { startIndex: number; endIndex: number } {
  const result = findTextInParagraph(paragraph, search, paragraphIndex);
  let { startRunIndex, endRunIndex } = result;
  const { startOffset, endOffset } = result;

  // Split the end run first (so indices don't shift for start)
  const endItem = paragraph.content[endRunIndex];
  if (endItem.type === 'run') {
    const endText = getRunText(endItem);
    if (endOffset < endText.length) {
      // Need to split: [matched...endOffset][rest]
      const afterRun = makeRunWithText(endText.slice(endOffset), endItem);
      setRunText(endItem, endText.slice(0, endOffset));
      paragraph.content.splice(endRunIndex + 1, 0, afterRun as Run);
    }
  }

  // Split the start run
  const startItem = paragraph.content[startRunIndex];
  if (startItem.type === 'run' && startOffset > 0) {
    const startText = getRunText(startItem);
    const beforeRun = makeRunWithText(startText.slice(0, startOffset), startItem);
    setRunText(startItem, startText.slice(startOffset));
    paragraph.content.splice(startRunIndex, 0, beforeRun as Run);
    startRunIndex++;
    endRunIndex++;
  }

  return { startIndex: startRunIndex, endIndex: endRunIndex };
}

function makeRunWithText(text: string, template: Run): Run {
  return {
    type: 'run',
    content: [{ type: 'text', text }],
    formatting: template.formatting ? { ...template.formatting } : undefined,
  } as Run;
}

function setRunText(run: Run, text: string): void {
  const textContent = run.content.find((c) => c.type === 'text');
  if (textContent) {
    (textContent as { type: 'text'; text: string }).text = text;
  }
}

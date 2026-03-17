/**
 * Text search within paragraphs.
 * Handles text spanning multiple runs and tracked change wrappers.
 */

import type { Paragraph, Run } from '@eigenpal/docx-core/headless';
import { TextNotFoundError } from './errors';
import { getRunText, isTrackedChange } from './utils';

export interface TextSearchResult {
  startRunIndex: number;
  startOffset: number;
  endRunIndex: number;
  /** Character offset within the end run (exclusive) */
  endOffset: number;
}

interface FlattenedRun {
  contentIndex: number;
  innerIndex: number;
  run: Run;
  text: string;
  startPos: number;
}

/**
 * Flatten paragraph content into runs with cumulative positions.
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

export function getParagraphPlainText(paragraph: Paragraph): string {
  return flattenRuns(paragraph)
    .map((r) => r.text)
    .join('');
}

/**
 * Find text within a paragraph. Throws TextNotFoundError if not found.
 */
export function findTextInParagraph(
  paragraph: Paragraph,
  search: string,
  paragraphIndex?: number
): TextSearchResult {
  const runs = flattenRuns(paragraph);
  const fullText = runs.map((r) => r.text).join('');

  const match = findMatch(fullText, search);
  if (!match) throw new TextNotFoundError(search, paragraphIndex);

  let startRunIdx = -1;
  let startOffset = 0;
  for (let i = 0; i < runs.length; i++) {
    if (match.start < runs[i].startPos + runs[i].text.length) {
      startRunIdx = i;
      startOffset = match.start - runs[i].startPos;
      break;
    }
  }

  let endRunIdx = -1;
  let endOffset = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (match.end > runs[i].startPos) {
      endRunIdx = i;
      endOffset = match.end - runs[i].startPos;
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
 * Isolate matched text into its own runs by splitting at boundaries.
 * Mutates paragraph.content.
 */
export function isolateMatchedText(
  paragraph: Paragraph,
  search: string,
  paragraphIndex?: number
): { startIndex: number; endIndex: number } {
  const result = findTextInParagraph(paragraph, search, paragraphIndex);
  let { startRunIndex, endRunIndex } = result;
  const { startOffset, endOffset } = result;

  // Split end run first (so indices don't shift for start)
  const endItem = paragraph.content[endRunIndex];
  if (endItem.type === 'run') {
    const endText = getRunText(endItem);
    if (endOffset < endText.length) {
      const afterRun = makeRunWithText(endText.slice(endOffset), endItem);
      setRunText(endItem, endText.slice(0, endOffset));
      paragraph.content.splice(endRunIndex + 1, 0, afterRun as Run);
    }
  }

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

// ============================================================================
// MATCHING — exact, then normalized (case + quotes + whitespace)
// ============================================================================

/**
 * Normalize text for matching: lowercase, collapse whitespace,
 * straighten smart quotes/dashes, strip zero-width chars.
 */
function normalize(original: string): { text: string; posMap: number[] } {
  const chars: string[] = [];
  const posMap: number[] = [];
  let prevSpace = true;

  for (let i = 0; i < original.length; i++) {
    let ch = original[i];

    // Skip zero-width chars
    if ('\u200B\u200C\u200D\uFEFF\u00AD'.includes(ch)) continue;

    // Smart quotes → straight
    if ('\u201C\u201D\u201E\u201F'.includes(ch)) ch = '"';
    if ('\u2018\u2019\u201A\u201B'.includes(ch)) ch = "'";

    // Dashes → hyphen
    if ('\u2013\u2014\u2012\u2015'.includes(ch)) ch = '-';

    // Ellipsis → dots
    if (ch === '\u2026') {
      chars.push('.', '.', '.');
      posMap.push(i, i, i);
      prevSpace = false;
      continue;
    }

    // Collapse all whitespace (including \n, \t, non-breaking space)
    if (/\s/.test(ch) || ch === '\u00A0') {
      if (!prevSpace) {
        chars.push(' ');
        posMap.push(i);
        prevSpace = true;
      }
      continue;
    }

    chars.push(ch.toLowerCase());
    posMap.push(i);
    prevSpace = false;
  }

  // Trim trailing space
  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    posMap.pop();
  }

  return { text: chars.join(''), posMap };
}

/**
 * Find search text within paragraph text.
 * 1. Exact match
 * 2. Normalized match (case-insensitive, smart quotes, collapsed whitespace)
 */
function findMatch(text: string, search: string): { start: number; end: number } | null {
  if (!search || !text) return null;

  // 1. Exact
  const exact = text.indexOf(search);
  if (exact !== -1) return { start: exact, end: exact + search.length };

  // 2. Normalized
  const normText = normalize(text);
  const normSearch = normalize(search);
  if (!normSearch.text) return null;

  const idx = normText.text.indexOf(normSearch.text);
  if (idx !== -1) {
    const start = normText.posMap[idx];
    let end = normText.posMap[idx + normSearch.text.length - 1] + 1;
    // Skip trailing zero-width chars
    while (end < text.length && '\u200B\u200C\u200D\uFEFF\u00AD'.includes(text[end])) end++;
    return { start, end };
  }

  return null;
}

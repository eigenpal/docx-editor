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

  const match = fuzzyFind(fullText, search);
  if (match === null) {
    throw new TextNotFoundError(search, paragraphIndex);
  }
  const matchStart = match.start;
  const matchEnd = match.end;

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

// ============================================================================
// NORMALIZED MATCHING -- handles LLM text mangling (quotes, dashes, unicode)
// ============================================================================

interface NormalizedText {
  text: string;
  /** posMap[i] = index in original string that normalized char i came from */
  posMap: number[];
}

const ZERO_WIDTH = new Set([
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\uFEFF', // BOM / zero-width no-break space
  '\u00AD', // soft hyphen
]);

/**
 * Build normalized text with position map back to original.
 * Normalizes: smart quotes, dashes, ellipsis, whitespace, zero-width chars, case.
 */
function buildNormalized(original: string): NormalizedText {
  const chars: string[] = [];
  const posMap: number[] = [];
  let prevWasSpace = true;

  for (let i = 0; i < original.length; i++) {
    let ch = original[i];

    if (ZERO_WIDTH.has(ch)) continue;

    // Smart quotes -> straight
    if (ch === '\u201C' || ch === '\u201D' || ch === '\u201E' || ch === '\u201F') ch = '"';
    if (ch === '\u2018' || ch === '\u2019' || ch === '\u201A' || ch === '\u201B') ch = "'";

    // Dashes -> hyphen
    if (ch === '\u2013' || ch === '\u2014' || ch === '\u2012' || ch === '\u2015') ch = '-';

    // Ellipsis -> three dots
    if (ch === '\u2026') {
      chars.push('.', '.', '.');
      posMap.push(i, i, i);
      prevWasSpace = false;
      continue;
    }

    // Collapse whitespace (including non-breaking space)
    if (/\s/.test(ch) || ch === '\u00A0') {
      if (!prevWasSpace) {
        chars.push(' ');
        posMap.push(i);
        prevWasSpace = true;
      }
      continue;
    }

    chars.push(ch.toLowerCase());
    posMap.push(i);
    prevWasSpace = false;
  }

  // Trim trailing space
  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    posMap.pop();
  }

  return { text: chars.join(''), posMap };
}

function mapToOriginal(
  norm: NormalizedText,
  normStart: number,
  normLen: number,
  original: string
): { start: number; end: number } {
  const origStart = norm.posMap[normStart];
  let origEnd = norm.posMap[normStart + normLen - 1] + 1;
  while (origEnd < original.length && ZERO_WIDTH.has(original[origEnd])) {
    origEnd++;
  }
  return { start: origStart, end: origEnd };
}

/**
 * Find search in text. Returns { start, end } in the ORIGINAL text, or null.
 *
 * 1. Exact match (fast path)
 * 2. Full normalized match (quotes, dashes, whitespace, case, unicode)
 * 3. Drop words from start/end (LLM copied extra context or truncated)
 */
function fuzzyFind(text: string, search: string): { start: number; end: number } | null {
  if (!search || !text) return null;

  // 1. Exact
  const exact = text.indexOf(search);
  if (exact !== -1) {
    return { start: exact, end: exact + search.length };
  }

  // 2. Normalized
  const normText = buildNormalized(text);
  const normSearch = buildNormalized(search);
  if (normSearch.text.length === 0) return null;

  const normIdx = normText.text.indexOf(normSearch.text);
  if (normIdx !== -1) {
    return mapToOriginal(normText, normIdx, normSearch.text.length, text);
  }

  // 3. Drop words from boundaries
  const words = normSearch.text.split(' ');
  if (words.length >= 3) {
    const maxDrop = Math.min(3, words.length - 2);

    for (let drop = 1; drop <= maxDrop; drop++) {
      const sub = words.slice(drop).join(' ');
      const idx = normText.text.indexOf(sub);
      if (idx !== -1) return mapToOriginal(normText, idx, sub.length, text);
    }

    for (let drop = 1; drop <= maxDrop; drop++) {
      const sub = words.slice(0, -drop).join(' ');
      const idx = normText.text.indexOf(sub);
      if (idx !== -1) return mapToOriginal(normText, idx, sub.length, text);
    }

    for (let ds = 1; ds <= Math.min(2, words.length - 2); ds++) {
      for (let de = 1; de <= Math.min(2, words.length - ds - 1); de++) {
        const sub = words.slice(ds, -de).join(' ');
        if (sub.length < 10) continue;
        const idx = normText.text.indexOf(sub);
        if (idx !== -1) return mapToOriginal(normText, idx, sub.length, text);
      }
    }
  }

  return null;
}

// Document text search over the canonical tree, for the navigation pane's Find tab.
//
// Sibling of `document-outline.ts` and under the same discipline: the derivation reads the
// CANONICAL TREE — never the DOM, never the layout — and every string that leaves this
// module is bounded here at the derivation boundary. A match's text and its surrounding
// context are authored file content, and the panel rows that render them are chrome, so
// downstream sinks only ever receive strings this module has already bounded.
//
// NO REGEX ON THE HAYSTACK OR THE NEEDLE. Both are attacker-influenced (the document is a
// zip of XML the author controls; the query is host input), and a pattern built from either
// is a catastrophic-backtracking hazard. Scanning is `indexOf` only. The one regex here
// runs against a SINGLE character at a time for the whole-word test, where there is no
// backtracking to trigger.
//
// OFFSETS ARE `paragraphTextOf`'s VOCABULARY — UTF-16 offsets with tabs and hard breaks
// counted as one character each — the same offsets the tree ops and the surface selection
// use. That is what lets `selectMatch` hand a match straight to `setSelection` without
// re-deriving anything.
//
// WHAT IS SEARCHED: body-story paragraphs (direct children of `w:body`), matching the
// contract's `TextMatch.paragraphIndex` definition — "ordinal among PARAGRAPHS in the body,
// skipping tables and other non-paragraph blocks". Table-cell text is therefore not found
// yet; widening to `allParagraphs` needs the contract's ordinal to be redefined first.

import {
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
  findOccurrences,
  isSearchableQuery,
  paragraphTextOf,
} from '@docx-editor.dev/core/store';
import {
  contentControlContentOf,
  isContentControl,
  walkParagraphInline,
} from '../store/package/content-control-walk.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { bodyParagraphs } from './tree-binding.ts';

export { SEARCH_MATCH_LIMIT, SEARCH_QUERY_MAX };

/** Characters of surrounding paragraph text carried on each side of a match. */
const CONTEXT_RADIUS = 48;

/** Control characters are flattened to spaces in every string that leaves this module. */
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

/** How a search is narrowed. Both flags default to off, matching Word's initial state. */
export interface DocumentSearchOptions {
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
  /** Override the default {@link SEARCH_MATCH_LIMIT}. Clamped to it; never raised past it. */
  readonly limit?: number;
}

/**
 * One occurrence of a query in the body story.
 *
 * Carries the engine's own address (`blockId` + `start`) and the positional one a find UI
 * needs (`paragraphIndex` / `runIndex` / `runOffset`), both derived from the SAME walk —
 * a caller reconstructing run boundaries itself is where an off-by-one would come from.
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS.
 */
export interface DocumentSearchMatch {
  readonly blockId: string;
  readonly start: number;
  readonly length: number;
  readonly paragraphIndex: number;
  readonly runIndex: number;
  readonly runOffset: number;
  /** The matched text as it appears in the document, control characters flattened. */
  readonly text: string;
  /** Paragraph text immediately before the match, bounded and flattened. */
  readonly contextBefore: string;
  /** Paragraph text immediately after the match, bounded and flattened. */
  readonly contextAfter: string;
}

/**
 * What one search answers with.
 *
 * `truncated` says the scan stopped at the cap with matches still ahead of it, so a caller
 * can show "2000+" honestly instead of claiming an exact total it does not have.
 */
export interface DocumentSearchResult {
  readonly matches: readonly DocumentSearchMatch[];
  readonly truncated: boolean;
}

function isElement(node: OoxmlNode): node is Exclude<OoxmlNode, { kind: 'textValue' }> {
  return node.kind !== 'textValue';
}

/**
 * The measurable length of one inline node, in `paragraphTextOf`'s vocabulary: text
 * contributes its characters, a tab and a hard break contribute one each, and properties
 * contribute nothing.
 */
function inlineLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  if (node.kind === 'runProperties' || node.kind === 'generic') return 0;
  if (node.kind === 'hyperlink' || isContentControl(node)) {
    let total = 0;
    const children =
      node.kind === 'hyperlink' ? node.children : (contentControlContentOf(node) ?? []);
    for (const child of children) total += inlineLength(child);
    return total;
  }
  let total = 0;
  for (const child of node.children) total += inlineLength(child);
  return total;
}

/**
 * Where each run starts, in paragraph-text offsets, in document order. Runs nested inside
 * a `w:hyperlink` are flattened in place: a link's runs are runs, and a find UI addressing
 * "the third run" means the third one you would meet reading the paragraph.
 */
function runStarts(paragraph: OoxmlNode): number[] {
  const starts: number[] = [];
  let offset = 0;
  if (!isElement(paragraph)) return starts;
  walkParagraphInline(paragraph.children, 0, (node) => {
    if (node.kind === 'run') {
      starts.push(offset);
      offset += inlineLength(node);
      return;
    }
    // Everything else at paragraph level (properties, bookmarks, unmodelled content)
    // contributes its own measurable length without being addressable as a run.
    offset += inlineLength(node);
  });
  return starts;
}

/** The run a paragraph offset falls in, and the offset inside it. */
function runAddressAt(
  starts: readonly number[],
  offset: number
): { index: number; offset: number } {
  if (starts.length === 0) return { index: 0, offset };
  // Linear from the end: a paragraph has few runs, and a binary search here would be
  // more code than the walk it replaces.
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index]!;
    if (offset >= start) return { index, offset: offset - start };
  }
  return { index: 0, offset };
}

/** Bound and flatten one file-derived string on its way out of this module. */
function bounded(raw: string, max: number): string {
  return raw.replace(CONTROL_CHARS_ALL, ' ').slice(0, max);
}

/**
 * Every occurrence of `query` in the body story, in document order.
 *
 * Matches are NON-OVERLAPPING, which is what a find dialog counts: searching `aa` in
 * `aaaa` finds two, not three. An empty or over-long query finds nothing rather than
 * everything — "find nothing typed" is not a document-wide selection.
 */
export function collectTextMatches(
  part: OoxmlPart,
  query: string,
  options: DocumentSearchOptions = {}
): DocumentSearchResult {
  const empty: DocumentSearchResult = { matches: [], truncated: false };
  if (!isSearchableQuery(query)) return empty;

  const limit =
    options.limit !== undefined && Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, SEARCH_MATCH_LIMIT)
      : SEARCH_MATCH_LIMIT;
  const scan = {
    ...(options.matchCase === undefined ? {} : { matchCase: options.matchCase }),
    ...(options.wholeWord === undefined ? {} : { wholeWord: options.wholeWord }),
  };

  const matches: DocumentSearchMatch[] = [];
  let paragraphIndex = 0;

  for (const paragraph of bodyParagraphs(part)) {
    if (!isElement(paragraph)) continue;
    const index = paragraphIndex;
    paragraphIndex += 1;
    const text = paragraphTextOf(part, paragraph.id) ?? '';
    if (text.length === 0) continue;

    // One global budget, not one per paragraph: the cap is on the whole search.
    const found = findOccurrences(text, query, limit - matches.length, scan);
    // Run starts are derived once per paragraph that has a hit, not per paragraph:
    // most paragraphs in a document do not match, and the walk is the expensive half.
    let starts: number[] | null = null;
    for (const occurrence of found.matches) {
      const end = occurrence.start + occurrence.length;
      starts ??= runStarts(paragraph);
      const address = runAddressAt(starts, occurrence.start);
      matches.push({
        blockId: paragraph.id,
        start: occurrence.start,
        length: occurrence.length,
        paragraphIndex: index,
        runIndex: address.index,
        runOffset: address.offset,
        text: bounded(text.slice(occurrence.start, end), SEARCH_QUERY_MAX),
        contextBefore: bounded(
          text.slice(Math.max(0, occurrence.start - CONTEXT_RADIUS), occurrence.start),
          CONTEXT_RADIUS
        ),
        contextAfter: bounded(text.slice(end, end + CONTEXT_RADIUS), CONTEXT_RADIUS),
      });
    }
    if (found.truncated) return { matches, truncated: true };
  }

  return { matches, truncated: false };
}

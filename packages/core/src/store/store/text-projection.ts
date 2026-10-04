// Visible paragraph text with exact links to the model offset space.
//
// A piece can preserve text one-for-one or expand one atomic field offset into its cached
// result. Every visible range maps back to one editable model range.

import { atomicFieldSpansOf, FIELD_ATOM_CHAR } from '../package/field-nodes.ts';
import {
  fieldResultProjectionsOf,
  type FieldResultRunBoundary,
  type FieldResultTextView,
} from '../package/field-result-text.ts';
import type { OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import {
  foldCase,
  isSearchableQuery,
  isWholeWord,
  type TextMatchOptions,
  type TextOccurrence,
} from './text-match.ts';
import { segmentsOfWithFieldSpans } from './tree-op-segments.ts';
import {
  isSymbolElement,
  NON_BREAKING_HYPHEN_TEXT,
  OPTIONAL_HYPHEN_TEXT,
  SYMBOL_TEXT,
} from '../package/hyphen-text.ts';

/** One visible interval linked to one raw model interval. */
export interface VisiblePiece {
  readonly text: string;
  readonly rawStart: number;
  readonly rawEnd: number;
  /** Result-run intervals for a simple-field expansion. */
  readonly resultRuns?: readonly FieldResultRunBoundary[];
  /** A `w:sym`: read as "(", but search matches it with nothing. */
  readonly symbol?: true;
  /** Offsets in `text` of the symbols a field result holds, which search never matches. */
  readonly symbolOffsets?: readonly number[];
}

/** One paragraph projection with lossless links to model offsets. */
export interface ProjectedParagraphText {
  readonly text: string;
  /** Map one model boundary into the projected UTF-16 offset space. */
  projectedOffset(rawOffset: number): number;
  /** Map a non-empty projected range back to one editable model range. */
  rawRange(
    start: number,
    end: number
  ): {
    readonly start: number;
    readonly end: number;
  } | null;
  /** Read a model range through this projection. */
  sliceRaw(start: number, end: number): string;
  /** Resolve a displayed offset inside a simple field to its visible result run. */
  resultRunAddressAt(projectedOffset: number): {
    readonly runId: string;
    readonly offset: number;
  } | null;
  /** Find distinct editable ranges in the displayed text. */
  findOccurrences(
    query: string,
    limit: number,
    options?: TextMatchOptions
  ): ProjectedTextOccurrences;
}

/** One displayed occurrence and its editable model range. */
export interface ProjectedTextOccurrence extends TextOccurrence {
  readonly rawStart: number;
  readonly rawEnd: number;
}

/** Distinct projected occurrences, bounded by the caller's limit. */
export interface ProjectedTextOccurrences {
  readonly matches: readonly ProjectedTextOccurrence[];
  readonly truncated: boolean;
}

interface PositionedPiece extends VisiblePiece {
  readonly projectedStart: number;
  readonly projectedEnd: number;
  readonly expansion: boolean;
}

function positionedPieces(pieces: readonly VisiblePiece[]): PositionedPiece[] {
  const result: PositionedPiece[] = [];
  let projected = 0;
  for (const piece of pieces) {
    const projectedEnd = projected + piece.text.length;
    if (piece.resultRuns) {
      result.push({
        text: piece.text,
        rawStart: piece.rawStart,
        rawEnd: piece.rawEnd,
        resultRuns: piece.resultRuns,
        ...(piece.symbolOffsets ? { symbolOffsets: piece.symbolOffsets } : {}),
        projectedStart: projected,
        projectedEnd,
        expansion: piece.text.length !== piece.rawEnd - piece.rawStart,
      });
    } else {
      result.push({
        text: piece.text,
        rawStart: piece.rawStart,
        rawEnd: piece.rawEnd,
        ...(piece.symbol ? { symbol: true as const } : {}),
        ...(piece.symbolOffsets ? { symbolOffsets: piece.symbolOffsets } : {}),
        projectedStart: projected,
        projectedEnd,
        expansion: piece.text.length !== piece.rawEnd - piece.rawStart,
      });
    }
    projected = projectedEnd;
  }
  return result;
}

function projectedBoundary(piece: PositionedPiece, rawOffset: number): number {
  if (rawOffset <= piece.rawStart) return piece.projectedStart;
  if (rawOffset >= piece.rawEnd) return piece.projectedEnd;
  if (piece.expansion) return piece.projectedStart;
  return piece.projectedStart + rawOffset - piece.rawStart;
}

function rawStartBoundary(piece: PositionedPiece, projectedOffset: number): number {
  if (piece.expansion) return piece.rawStart;
  return piece.rawStart + projectedOffset - piece.projectedStart;
}

function rawEndBoundary(piece: PositionedPiece, projectedOffset: number): number {
  if (piece.expansion) return piece.rawEnd;
  return piece.rawStart + projectedOffset - piece.projectedStart;
}

interface SearchText {
  readonly text: string;
  /** Projected offset of each search-text unit, or null when the two are the same. */
  readonly at: readonly number[] | null;
}

/** Characters search compares as a typed hyphen, and characters it skips. */
const SEARCH_HYPHENS = new Set([NON_BREAKING_HYPHEN_TEXT, '\u2011']);
const SEARCH_SKIPPED = new Set([OPTIONAL_HYPHEN_TEXT, '\u00ad']);
const SEARCH_FOLDED = /[\u001e\u001f\u2011\u00ad]/;
/** What search compares a symbol as: a noncharacter no query can contain. */
const SEARCH_SYMBOL = '\uffff';

/**
 * Text as search compares it: a non-breaking hyphen matches a typed hyphen, and an optional
 * hyphen matches nothing, so `rates` finds a word with an optional hyphen inside it. The
 * characters copy writes for them (U+2011 and U+00AD) fold the same way, so copied text
 * finds its source.
 */
function searchTextOf(text: string, symbols?: ReadonlySet<number>): SearchText {
  if (!SEARCH_FOLDED.test(text) && !symbols?.size) return { text, at: null };
  let out = '';
  const at: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (symbols?.has(index)) out += SEARCH_SYMBOL;
    else if (SEARCH_SKIPPED.has(char)) continue;
    else out += SEARCH_HYPHENS.has(char) ? '-' : char;
    at.push(index);
  }
  return { text: out, at };
}

/** Projected offsets of the symbol pieces. */
function symbolPositions(positioned: readonly PositionedPiece[]): ReadonlySet<number> | undefined {
  let found: Set<number> | undefined;
  for (const piece of positioned) {
    if (piece.symbol) {
      found ??= new Set();
      for (let at = piece.projectedStart; at < piece.projectedEnd; at += 1) found.add(at);
    }
    for (const offset of piece.symbolOffsets ?? [])
      (found ??= new Set()).add(piece.projectedStart + offset);
  }
  return found;
}

/** Build a mapped projection from visible pieces in raw order. */
export function projectionFromPieces(pieces: readonly VisiblePiece[]): ProjectedParagraphText {
  const positioned = positionedPieces(pieces);
  let text = '';
  for (const piece of pieces) text += piece.text;
  let searchText: SearchText | null = null;
  return {
    text,
    projectedOffset(rawOffset) {
      let offset = 0;
      for (const piece of positioned) {
        if (rawOffset <= piece.rawEnd) return projectedBoundary(piece, rawOffset);
        offset = piece.projectedEnd;
      }
      return offset;
    },
    rawRange(start, end) {
      if (start < 0 || start >= end || end > text.length) return null;
      const first = positioned.find(
        (piece) => start >= piece.projectedStart && start < piece.projectedEnd
      );
      const last = positioned.find(
        (piece) => end > piece.projectedStart && end <= piece.projectedEnd
      );
      if (!first || !last) return null;
      return {
        start: rawStartBoundary(first, start),
        end: rawEndBoundary(last, end),
      };
    },
    sliceRaw(start, end) {
      if (start >= end) return '';
      let value = '';
      for (const piece of positioned) {
        if (piece.expansion) {
          if (start <= piece.rawStart && end >= piece.rawEnd) value += piece.text;
          continue;
        }
        const from = Math.max(start, piece.rawStart);
        const to = Math.min(end, piece.rawEnd);
        if (from < to) {
          value += piece.text.slice(from - piece.rawStart, to - piece.rawStart);
        }
      }
      return value;
    },
    resultRunAddressAt(projectedOffset) {
      const piece = positioned.find(
        (candidate) =>
          candidate.resultRuns !== undefined &&
          projectedOffset >= candidate.projectedStart &&
          projectedOffset < candidate.projectedEnd
      );
      if (!piece?.resultRuns) return null;
      const localOffset = projectedOffset - piece.projectedStart;
      for (const run of piece.resultRuns) {
        if (localOffset >= run.start && localOffset < run.end) {
          return { runId: run.runId, offset: localOffset - run.start };
        }
      }
      return null;
    },
    findOccurrences(query, limit, options = {}) {
      const matches: ProjectedTextOccurrence[] = [];
      if (limit <= 0 || !isSearchableQuery(query) || text.length === 0) {
        return { matches, truncated: false };
      }
      const matchCase = options.matchCase === true;
      const wholeWord = options.wholeWord === true;
      // A symbol reads as "(" but is no character a query can name: it matches nothing.
      searchText ??= searchTextOf(text, symbolPositions(positioned));
      const folded = searchText;
      const wanted = searchTextOf(query).text;
      if (wanted.length === 0 || wanted.includes(SEARCH_SYMBOL))
        return { matches, truncated: false };
      const needle = matchCase ? wanted : foldCase(wanted);
      const haystack = matchCase ? folded.text : foldCase(folded.text);
      const projectedAt = (index: number): number => folded.at?.[index] ?? index;
      const searchIndexOf = (projected: number): number => {
        if (!folded.at) return projected;
        let index = 0;
        while (index < folded.at.length && folded.at[index]! < projected) index += 1;
        return index;
      };
      const to = Math.min(text.length, options.to ?? text.length);
      const matchedExpansions = new Set<PositionedPiece>();
      let found = haystack.indexOf(needle, searchIndexOf(Math.max(0, options.from ?? 0)));
      while (found >= 0) {
        const foundEnd = found + needle.length;
        const cursor = projectedAt(found);
        const end = projectedAt(foundEnd - 1) + 1;
        if (end > to) return { matches, truncated: false };
        // Word boundaries are read where search compares, so an optional hyphen joins a word.
        if (!wholeWord || isWholeWord(folded.text, found, foundEnd)) {
          const first = positioned.find(
            (piece) => cursor >= piece.projectedStart && cursor < piece.projectedEnd
          );
          const last = positioned.find(
            (piece) => end > piece.projectedStart && end <= piece.projectedEnd
          );
          if (!first || !last) return { matches, truncated: false };
          // Only two matches wholly inside the same expansion select the same field atom.
          // A match that starts in the field and ends after it has a wider raw range and is
          // therefore a distinct navigation target.
          const containedExpansion = first === last && first.expansion ? first : null;
          if (!containedExpansion || !matchedExpansions.has(containedExpansion)) {
            if (matches.length >= limit) return { matches, truncated: true };
            matches.push({
              start: cursor,
              length: end - cursor,
              rawStart: rawStartBoundary(first, cursor),
              rawEnd: rawEndBoundary(last, end),
            });
            if (containedExpansion) matchedExpansions.add(containedExpansion);
          }
        }
        found = haystack.indexOf(needle, foundEnd);
      }
      return { matches, truncated: false };
    },
  };
}

/** Identity mapping for text without a visible expansion or hidden interval. */
export function identityProjection(text: string): ProjectedParagraphText {
  if (text.length === 0) return projectionFromPieces([]);
  return projectionFromPieces([{ text, rawStart: 0, rawEnd: text.length }]);
}

/** Visible pieces for one paragraph, with field atoms expanded to cached result text. */
export function visibleParagraphPieces(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  view: FieldResultTextView = 'allMarkup'
): readonly VisiblePiece[] {
  if (!rawText.includes(FIELD_ATOM_CHAR) && !rawText.includes(SYMBOL_TEXT)) {
    return rawText.length === 0 ? [] : [{ text: rawText, rawStart: 0, rawEnd: rawText.length }];
  }

  const spans = atomicFieldSpansOf(paragraph);
  const segments = segmentsOfWithFieldSpans(paragraph, spans);
  const results = fieldResultProjectionsOf(paragraph, spans, view);
  const spansByNodeId = new Map<string, (typeof spans)[number]>();
  for (const span of spans) spansByNodeId.set(span.node.id, span);
  const pieces: VisiblePiece[] = [];
  let rawStart = 0;
  for (const segment of segments) {
    const span = spansByNodeId.get(segment.node.id);
    const symbol = !span && isSymbolElement(segment.node);
    if (!span && !symbol) continue;
    if (rawStart < segment.start) {
      pieces.push({
        text: rawText.slice(rawStart, segment.start),
        rawStart,
        rawEnd: segment.start,
      });
    }
    if (!span) {
      pieces.push({
        text: SYMBOL_TEXT,
        rawStart: segment.start,
        rawEnd: segment.end,
        symbol: true,
      });
      rawStart = segment.end;
      continue;
    }
    const result = results.get(span.node.id);
    // Nested simple fields keep the store segment order here. This does not endorse Word's
    // visible ordering; changing it would change the model offset authority.
    if (span.kind === 'simple' && result) {
      pieces.push({
        text: result.text,
        rawStart: segment.start,
        rawEnd: segment.end,
        resultRuns: result.runs,
        ...(result.symbols ? { symbolOffsets: result.symbols } : {}),
      });
    } else {
      pieces.push({
        text: result?.text ?? FIELD_ATOM_CHAR,
        rawStart: segment.start,
        rawEnd: segment.end,
        ...(result?.symbols ? { symbolOffsets: result.symbols } : {}),
      });
    }
    rawStart = segment.end;
  }
  if (rawStart < rawText.length) {
    pieces.push({ text: rawText.slice(rawStart), rawStart, rawEnd: rawText.length });
  }
  return pieces;
}

/** Visible field-result projection for one paragraph. */
export function projectVisibleParagraphText(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  view: FieldResultTextView = 'allMarkup'
): ProjectedParagraphText {
  if (!rawText.includes(FIELD_ATOM_CHAR) && !rawText.includes(SYMBOL_TEXT)) {
    return identityProjection(rawText);
  }
  return projectionFromPieces(visibleParagraphPieces(paragraph, rawText, view));
}

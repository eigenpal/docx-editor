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
import { NON_BREAKING_HYPHEN_TEXT, OPTIONAL_HYPHEN_TEXT } from '../package/hyphen-text.ts';
import { inlineCharacterMarks, type InlineCharacterMark } from './inline-character-marks.ts';

/** One visible interval linked to one raw model interval. */
export interface VisiblePiece {
  readonly text: string;
  readonly rawStart: number;
  readonly rawEnd: number;
  /** Result-run intervals for a simple-field expansion. */
  readonly resultRuns?: readonly FieldResultRunBoundary[];
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
        projectedStart: projected,
        projectedEnd,
        expansion: piece.text.length !== piece.rawEnd - piece.rawStart,
      });
    } else {
      result.push({
        text: piece.text,
        rawStart: piece.rawStart,
        rawEnd: piece.rawEnd,
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

/**
 * Text as search compares it: a non-breaking hyphen matches a typed hyphen, and an optional
 * hyphen matches nothing, so `rates` finds a word with an optional hyphen inside it.
 */
function searchTextOf(text: string): SearchText {
  if (!text.includes(NON_BREAKING_HYPHEN_TEXT) && !text.includes(OPTIONAL_HYPHEN_TEXT)) {
    return { text, at: null };
  }
  let out = '';
  const at: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === OPTIONAL_HYPHEN_TEXT) continue;
    out += char === NON_BREAKING_HYPHEN_TEXT ? '-' : char;
    at.push(index);
  }
  return { text: out, at };
}

/** Build a mapped projection from visible pieces in raw order. */
export function projectionFromPieces(pieces: readonly VisiblePiece[]): ProjectedParagraphText {
  const positioned = positionedPieces(pieces);
  let text = '';
  for (const piece of pieces) text += piece.text;
  const rawLength = positioned.length === 0 ? 0 : positioned[positioned.length - 1]!.rawEnd;
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
        if (piece.expansion && piece.rawStart === piece.rawEnd) {
          // A hyphen sits between two model offsets. It belongs to a range that spans it, or
          // that reaches the paragraph edge it stands on.
          const offset = piece.rawStart;
          const fromLeft = start < offset || offset === 0;
          const toRight = offset < end || offset === rawLength;
          if (fromLeft && toRight) value += piece.text;
          continue;
        }
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
          return { runId: run.runId, offset: (run.runOffset ?? 0) + localOffset - run.start };
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
      searchText ??= searchTextOf(text);
      const folded = searchText;
      const wanted = searchTextOf(query).text;
      if (wanted.length === 0) return { matches, truncated: false };
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
        if (!wholeWord || isWholeWord(text, cursor, end)) {
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
  const shown = hyphenMarksOf(paragraph, view);
  const pieces = fieldPieces(paragraph, rawText, view);
  return shown.length === 0 ? pieces : withHyphens(pieces, shown);
}

type HyphenMark = InlineCharacterMark & { readonly text: string };

/** The hyphens this view reads; a symbol is not read text. */
function hyphenMarksOf(
  paragraph: OoxmlParagraphNode,
  view: FieldResultTextView
): readonly HyphenMark[] {
  const marks = inlineCharacterMarks(paragraph);
  if (marks.length === 0) return [];
  return marks.filter(
    (mark): mark is HyphenMark => mark.text !== null && (view !== 'original' || !mark.inserted)
  );
}

/** Insert each hyphen as a zero-width piece at its model offset. */
function withHyphens(
  pieces: readonly VisiblePiece[],
  marks: readonly HyphenMark[]
): readonly VisiblePiece[] {
  const out: VisiblePiece[] = [];
  let next = 0;
  const hyphen = (mark: HyphenMark): VisiblePiece => ({
    text: mark.text,
    rawStart: mark.offset,
    rawEnd: mark.offset,
  });
  for (const piece of pieces) {
    while (next < marks.length && marks[next]!.offset <= piece.rawStart) {
      out.push(hyphen(marks[next]!));
      next += 1;
    }
    if (piece.text.length !== piece.rawEnd - piece.rawStart) {
      out.push(piece);
      continue;
    }
    let cursor = piece.rawStart;
    while (next < marks.length && marks[next]!.offset < piece.rawEnd) {
      const offset = marks[next]!.offset;
      if (offset > cursor) {
        out.push({
          text: piece.text.slice(cursor - piece.rawStart, offset - piece.rawStart),
          rawStart: cursor,
          rawEnd: offset,
        });
        cursor = offset;
      }
      out.push(hyphen(marks[next]!));
      next += 1;
    }
    out.push(
      cursor === piece.rawStart
        ? piece
        : {
            text: piece.text.slice(cursor - piece.rawStart),
            rawStart: cursor,
            rawEnd: piece.rawEnd,
          }
    );
  }
  while (next < marks.length) {
    out.push(hyphen(marks[next]!));
    next += 1;
  }
  return out;
}

function fieldPieces(
  paragraph: OoxmlParagraphNode,
  rawText: string,
  view: FieldResultTextView
): readonly VisiblePiece[] {
  if (!rawText.includes(FIELD_ATOM_CHAR)) {
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
    if (!span) continue;
    if (rawStart < segment.start) {
      pieces.push({
        text: rawText.slice(rawStart, segment.start),
        rawStart,
        rawEnd: segment.start,
      });
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
      });
    } else {
      pieces.push({
        text: result?.text ?? FIELD_ATOM_CHAR,
        rawStart: segment.start,
        rawEnd: segment.end,
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
  if (!rawText.includes(FIELD_ATOM_CHAR) && hyphenMarksOf(paragraph, view).length === 0) {
    return identityProjection(rawText);
  }
  return projectionFromPieces(visibleParagraphPieces(paragraph, rawText, view));
}

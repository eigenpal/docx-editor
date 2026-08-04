// Turning the protocol's positions into positions in a document.
//
// INTERNAL. A caller says "the paragraph behind this handle, sixteen UTF-16 units in", or "the
// end of this body". Both have to become a canonical node id and a model offset before any read
// or op can use them, and both can be WRONG in ways that must be named rather than guessed at:
// a handle for a paragraph that has since been deleted, an offset past the end of a paragraph,
// a span whose start comes after its end.
//
// Resolution is against a SNAPSHOT, so a resolved position is only meaningful together with the
// package it was resolved against. That is deliberate: it is what makes "this handle is stale"
// a detectable condition instead of a silent misplacement.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationEndpoint, AutomationHandle, AutomationSpan } from './protocol.ts';
import type { AutomationParagraphRef, AutomationPoint, AutomationSpanRef } from './operations.ts';
import type { AutomationDocumentReads } from './reads.ts';

/** A position in a document: a canonical paragraph id, its story index, and a model offset. */
export interface ResolvedPoint {
  readonly paragraphId: string;
  readonly index: number;
  readonly offset: number;
}

export interface ResolvedRange {
  readonly start: ResolvedPoint;
  readonly end: ResolvedPoint;
}

/** A stretch of a document. `null` where a span covers a story that holds no paragraph. */
export type ResolvedSpan = ResolvedRange | null;

export type ResolutionCode = 'invalid-handle' | 'invalid-offset';

export type Resolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ResolutionCode; readonly detail: string };

function fail<T>(code: ResolutionCode, detail: string): Resolution<T> {
  return { ok: false, code, detail };
}

function ok<T>(value: T): Resolution<T> {
  return { ok: true, value };
}

/** A paragraph handle, checked against the story it claims to be in. */
export function resolveParagraphHandle(
  handle: AutomationHandle,
  handles: AutomationHandleTable,
  reads: AutomationDocumentReads
): Resolution<ResolvedPoint> {
  const resolved = handles.resolve(handle, 'paragraph');
  if (!resolved || resolved.kind !== 'paragraph')
    return fail('invalid-handle', 'not-a-paragraph-handle');
  const index = reads.indexOf(resolved.paragraphId);
  // A handle whose paragraph left the story is STALE, not merely unknown: the deletion that
  // removed it is exactly why the caller must be told rather than silently retargeted.
  if (index < 0) return fail('invalid-handle', 'paragraph-not-in-body');
  return ok({ paragraphId: resolved.paragraphId, index, offset: 0 });
}

function checkBody(handle: AutomationHandle, handles: AutomationHandleTable): Resolution<true> {
  if (!handles.resolve(handle, 'body')) return fail('invalid-handle', 'not-a-body-handle');
  return ok(true);
}

/** An explicit `{ paragraph, offset }` endpoint. */
export function resolveEndpoint(
  endpoint: AutomationEndpoint,
  handles: AutomationHandleTable,
  reads: AutomationDocumentReads
): Resolution<ResolvedPoint> {
  const paragraph = resolveParagraphHandle(endpoint.paragraph, handles, reads);
  if (!paragraph.ok) return paragraph;
  const length = (reads.paragraphText(paragraph.value.paragraphId) ?? '').length;
  const { offset } = endpoint;
  if (!Number.isInteger(offset) || offset < 0 || offset > length)
    return fail('invalid-offset', `offset ${String(offset)} outside 0..${String(length)}`);
  return ok({ ...paragraph.value, offset });
}

/** A point: an endpoint, or one edge of a paragraph or a story. */
export function resolvePoint(
  point: AutomationPoint,
  handles: AutomationHandleTable,
  reads: AutomationDocumentReads
): Resolution<ResolvedPoint> {
  if ('paragraph' in point) {
    if (!('at' in point)) return resolveEndpoint(point, handles, reads);
    const paragraph = resolveParagraphHandle(point.paragraph, handles, reads);
    if (!paragraph.ok) return paragraph;
    if (point.at === 'start') return paragraph;
    const length = (reads.paragraphText(paragraph.value.paragraphId) ?? '').length;
    return ok({ ...paragraph.value, offset: length });
  }
  const body = checkBody(point.body, handles);
  if (!body.ok) return body;
  const ids = reads.bodyParagraphIds;
  if (ids.length === 0) return fail('invalid-offset', 'empty-story');
  if (point.at === 'start') return ok({ paragraphId: ids[0] as string, index: 0, offset: 0 });
  const index = ids.length - 1;
  const paragraphId = ids[index] as string;
  return ok({ paragraphId, index, offset: (reads.paragraphText(paragraphId) ?? '').length });
}

/** Whether `a` is at or before `b`. */
function ordered(a: ResolvedPoint, b: ResolvedPoint): boolean {
  return a.index < b.index || (a.index === b.index && a.offset <= b.offset);
}

/** The whole of a story, or null when it holds no paragraph. */
function wholeStory(reads: AutomationDocumentReads): ResolvedSpan {
  const ids = reads.bodyParagraphIds;
  if (ids.length === 0) return null;
  const lastIndex = ids.length - 1;
  const lastId = ids[lastIndex] as string;
  return {
    start: { paragraphId: ids[0] as string, index: 0, offset: 0 },
    end: {
      paragraphId: lastId,
      index: lastIndex,
      offset: (reads.paragraphText(lastId) ?? '').length,
    },
  };
}

/** A span: two points, a whole paragraph, or a whole story. */
export function resolveSpanRef(
  span: AutomationSpanRef,
  handles: AutomationHandleTable,
  reads: AutomationDocumentReads
): Resolution<ResolvedSpan> {
  if ('body' in span) {
    const body = checkBody(span.body, handles);
    if (!body.ok) return body;
    return ok(wholeStory(reads));
  }
  if ('paragraph' in span) {
    const paragraph = resolveParagraphHandle(span.paragraph, handles, reads);
    if (!paragraph.ok) return paragraph;
    const length = (reads.paragraphText(paragraph.value.paragraphId) ?? '').length;
    return ok({ start: paragraph.value, end: { ...paragraph.value, offset: length } });
  }
  const start = resolvePoint(span.start, handles, reads);
  if (!start.ok) return start;
  const end = resolvePoint(span.end, handles, reads);
  if (!end.ok) return end;
  if (!ordered(start.value, end.value)) return fail('invalid-offset', 'span-start-after-end');
  return ok({ start: start.value, end: end.value });
}

/** A paragraph reference: a handle, or one end of a story. */
export function resolveParagraphRef(
  ref: AutomationParagraphRef,
  handles: AutomationHandleTable,
  reads: AutomationDocumentReads
): Resolution<ResolvedPoint> {
  if ('paragraph' in ref) return resolveParagraphHandle(ref.paragraph, handles, reads);
  const body = checkBody(ref.body, handles);
  if (!body.ok) return body;
  const ids = reads.bodyParagraphIds;
  if (ids.length === 0) return fail('invalid-offset', 'empty-story');
  const index = ref.at === 'first' ? 0 : ids.length - 1;
  return ok({ paragraphId: ids[index] as string, index, offset: 0 });
}

/** The canonical ids a span covers, in reading order. */
export function spanParagraphIds(
  span: ResolvedSpan,
  reads: AutomationDocumentReads
): readonly string[] {
  if (!span) return [];
  return reads.bodyParagraphIds.slice(span.start.index, span.end.index + 1);
}

/** One paragraph's share of a span: the offsets inside it the span actually reaches. */
export interface SpanOffsets {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  /** Whether the span reaches from the paragraph's first offset to its last. */
  readonly whole: boolean;
}

/**
 * A span broken into one entry per paragraph it covers, clipped at its own two ends.
 *
 * The vocabulary every per-character operation needs: formatting, link wrapping and bookmark
 * containment all ask "which characters of which paragraph", and each computing the clipping
 * itself is how two of them end up disagreeing at a paragraph boundary.
 */
export function spanOffsets(
  span: ResolvedSpan,
  reads: AutomationDocumentReads
): readonly SpanOffsets[] {
  if (!span) return [];
  const ids = spanParagraphIds(span, reads);
  const last = ids.length - 1;
  return ids.map((paragraphId, position) => {
    const length = (reads.paragraphText(paragraphId) ?? '').length;
    const start = position === 0 ? span.start.offset : 0;
    const end = position === last ? span.end.offset : length;
    return { paragraphId, start, end, whole: start === 0 && end === length };
  });
}

/**
 * The text a span covers, with a paragraph mark at every paragraph boundary it crosses.
 *
 * The mark count is what makes this text usable as an offset vocabulary: a span over three
 * paragraphs reads two marks, so a caller counting characters counts the same positions the
 * engine writes at.
 */
export function spanText(
  span: ResolvedSpan,
  reads: AutomationDocumentReads,
  paragraphMark: string
): string {
  if (!span) return '';
  const ids = spanParagraphIds(span, reads);
  if (ids.length === 1) {
    const text = reads.paragraphText(span.start.paragraphId) ?? '';
    return text.slice(span.start.offset, span.end.offset);
  }
  return ids
    .map((id, position) => {
      const text = reads.paragraphText(id) ?? '';
      if (position === 0) return text.slice(span.start.offset);
      if (position === ids.length - 1) return text.slice(0, span.end.offset);
      return text;
    })
    .join(paragraphMark);
}

/** A resolved range in protocol vocabulary, with handles minted for its endpoints. */
export function spanValue(range: ResolvedRange, handles: AutomationHandleTable): AutomationSpan {
  return {
    start: { paragraph: handles.paragraph(range.start.paragraphId), offset: range.start.offset },
    end: { paragraph: handles.paragraph(range.end.paragraphId), offset: range.end.offset },
  };
}

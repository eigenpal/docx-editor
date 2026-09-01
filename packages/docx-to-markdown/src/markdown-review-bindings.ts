import type {
  SemanticCommentArtifactRecord,
  SemanticReviewArtifactRecord,
  SemanticTrackedChangeArtifactRecord,
} from '@docx-editor.dev/core/layout';
import {
  EMPTY_MAPPED_MARKDOWN,
  type MappedMarkdown,
  type MarkdownSourceParagraph,
  type MarkdownSourceSlice,
} from './markdown-source-map.ts';
import { markdownSourceCaptureKey, type MarkdownSourceCapture } from './markdown-inline.ts';

/** Page/story/source provenance for one exported review artifact. @public */
export type MarkdownReviewOccurrence = SemanticReviewArtifactRecord['occurrences'][number];

/**
 * Normalized DOCX comment, independent of editor UI state.
 *
 * Its ID is opaque and stable only within one {@link MarkdownExportResult}. Never persist the ID
 * across exports; pair citations with the caller's own document version or content hash.
 * @public
 */
export type MarkdownComment = SemanticCommentArtifactRecord;

/**
 * Normalized DOCX tracked change, independent of editor UI state.
 *
 * Its ID is opaque and stable only within one {@link MarkdownExportResult}. Never persist the ID
 * across exports; pair citations with the caller's own document version or content hash.
 * @public
 */
export type MarkdownTrackedChange = SemanticTrackedChangeArtifactRecord;

/**
 * Comment or tracked change returned by Markdown export. IDs are opaque and result-local.
 * @public
 */
export type MarkdownReviewArtifact = SemanticReviewArtifactRecord;

/** A UTF-16 range suitable for slicing the named Markdown projection. @public */
export interface MarkdownReviewRange {
  /** Inclusive start offset in the selected Markdown string. */
  readonly start: number;
  /** Exclusive end offset in the selected Markdown string. */
  readonly end: number;
  /** Offsets use JavaScript string indexing and can be passed directly to `String.slice()`. */
  readonly unit: 'utf16-code-unit';
  /** Whether this is an exact text mapping or the smallest generated construct containing it. */
  readonly precision: MarkdownReviewRangePrecision;
}

/** Precision of a source-to-Markdown review range. @public */
export type MarkdownReviewRangePrecision = 'exact' | 'containing-construct';

/** How much of one Core source occurrence is represented by the returned ranges. @public */
export type MarkdownReviewCoverage = 'complete' | 'partial' | 'none';

/** Markdown string containing one review binding. @public */
export type MarkdownReviewProjection =
  | {
      /** Selects `MarkdownExportResult.markdown`. */
      readonly kind: 'document';
    }
  | {
      /** Selects one field on one entry in `MarkdownExportResult.pages`. */
      readonly kind: 'page';
      /** Zero-based index into `MarkdownExportResult.pages`. */
      readonly pageIndex: number;
      /** One-based page number, included for citation and validation. */
      readonly pageNumber: number;
      /** Markdown page field containing the bound ranges. */
      readonly field: 'markdown' | 'headerMarkdown' | 'footerMarkdown';
    };

/** Why a source occurrence has no range in a particular Markdown projection. @public */
export type MarkdownReviewUnmappedReason =
  | 'not-represented-in-markdown'
  | 'non-linear-structural-change'
  | 'omitted-story-content';

/** Honest snapshot-local mapping from a Core review occurrence to generated Markdown. @public */
export interface MarkdownReviewBinding {
  /** ID of the corresponding artifact in this export result; do not join it across snapshots. */
  readonly artifactId: string;
  /** Discriminant of the corresponding review artifact. */
  readonly artifactKind: MarkdownReviewArtifact['kind'];
  /** Index into this snapshot's immutable artifact `occurrences` array. */
  readonly occurrenceIndex: number;
  /** Generated Markdown string containing this binding. */
  readonly projection: MarkdownReviewProjection;
  /** Ordered, non-overlapping ranges in the selected projection. */
  readonly ranges: readonly MarkdownReviewRange[];
  /** Whether the ranges represent all, some, or none of the source occurrence. */
  readonly coverage: MarkdownReviewCoverage;
  /** Present when the source occurrence has no honest linear range in this projection. */
  readonly unmappedReason?: MarkdownReviewUnmappedReason;
}

export interface MarkdownPageProjectionValues {
  readonly markdown: MappedMarkdown;
  readonly headerMarkdown: MappedMarkdown;
  readonly footerMarkdown: MappedMarkdown;
}

export interface PageReviewArtifacts {
  readonly comments: SemanticCommentArtifactRecord[];
  readonly trackedChanges: SemanticTrackedChangeArtifactRecord[];
  readonly keys: Set<string>;
}

/** Stable translator-local scope corresponding to one Core review occurrence. */
export function markdownReviewSourceScope(
  rootStory: MarkdownReviewOccurrence['rootStory'],
  partName: string,
  noteScopeId: string | null
): string {
  switch (rootStory) {
    case 'body':
      return 'body';
    case 'header':
    case 'footer':
      return `${rootStory}:${partName}`;
    case 'footnote':
    case 'endnote':
      return `${rootStory}:${noteScopeId ?? partName}`;
    case 'note-separator':
      return `note-separator:${partName}`;
  }
}

export function buildMarkdownSourceCapture(
  artifacts: readonly MarkdownReviewArtifact[]
): MarkdownSourceCapture | undefined {
  const offsetSetsBySource = new Map<string, Set<number>>();
  const allSourceScopes = new Set<string>();
  const add = (sourceScope: string, paragraphId: string, offset: number): void => {
    const key = markdownSourceCaptureKey(sourceScope, paragraphId);
    const offsets = offsetSetsBySource.get(key) ?? new Set<number>();
    offsets.add(offset);
    offsetSetsBySource.set(key, offsets);
  };
  for (const artifact of artifacts) {
    for (const occurrence of artifact.occurrences) {
      const { start, end } = occurrence.source;
      const sourceScope = markdownReviewSourceScope(
        occurrence.rootStory,
        occurrence.source.partName,
        occurrence.noteScopeId
      );
      add(sourceScope, start.paragraphId, start.offset);
      add(sourceScope, end.paragraphId, end.offset);
      if (start.paragraphId !== end.paragraphId) allSourceScopes.add(sourceScope);
    }
  }
  if (offsetSetsBySource.size === 0) return undefined;
  const offsetsBySource = new Map<string, readonly number[]>();
  for (const [key, offsets] of offsetSetsBySource) {
    offsetsBySource.set(
      key,
      [...offsets].sort((left, right) => left - right)
    );
  }
  return { allSourceScopes, offsetsBySource };
}

export function indexPageReviewArtifacts(
  artifacts: readonly MarkdownReviewArtifact[]
): ReadonlyMap<number, PageReviewArtifacts> {
  const byPage = new Map<number, PageReviewArtifacts>();
  for (const artifact of artifacts) {
    for (const occurrence of artifact.occurrences) {
      const page = byPage.get(occurrence.pageIndex) ?? {
        comments: [],
        trackedChanges: [],
        keys: new Set<string>(),
      };
      byPage.set(occurrence.pageIndex, page);
      const key = `${artifact.kind}\0${artifact.id}`;
      if (page.keys.has(key)) continue;
      page.keys.add(key);
      if (artifact.kind === 'comment') page.comments.push(artifact);
      else page.trackedChanges.push(artifact);
    }
  }
  return byPage;
}

function rangeWithinSlice(
  slice: MarkdownSourceSlice,
  start: number,
  end: number
): MarkdownReviewRange | null {
  const sourceStart = Math.max(start, slice.sourceStart);
  const sourceEnd = Math.min(end, slice.sourceEnd);
  if (sourceStart > sourceEnd || (start !== end && sourceStart === sourceEnd)) return null;
  if (start === end && !slice.exact) {
    if (start === slice.sourceStart) {
      return {
        start: slice.markdownStart,
        end: slice.markdownStart,
        unit: 'utf16-code-unit',
        precision: 'exact',
      };
    }
    if (start === slice.sourceEnd) {
      return {
        start: slice.markdownEnd,
        end: slice.markdownEnd,
        unit: 'utf16-code-unit',
        precision: 'exact',
      };
    }
    return null;
  }
  if (!slice.exact || !slice.markdownBoundaries) {
    return {
      start: slice.markdownStart,
      end: slice.markdownEnd,
      unit: 'utf16-code-unit',
      precision: 'containing-construct',
    };
  }
  const markdownOffset = (sourceOffset: number): number | null => {
    if (sourceOffset === slice.sourceStart) return slice.markdownStart;
    if (sourceOffset === slice.sourceEnd) return slice.markdownEnd;
    const boundaries = slice.markdownBoundaries ?? [];
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (boundaries[middle]!.sourceOffset < sourceOffset) low = middle + 1;
      else high = middle;
    }
    return boundaries[low]?.sourceOffset === sourceOffset ? boundaries[low]!.markdownOffset : null;
  };
  const markdownStart = markdownOffset(sourceStart);
  const markdownEnd = markdownOffset(sourceEnd);
  if (markdownStart === null || markdownEnd === null) return null;
  return {
    start: markdownStart,
    end: markdownEnd,
    unit: 'utf16-code-unit',
    precision: 'exact',
  };
}

function mergeReviewRanges(ranges: readonly MarkdownReviewRange[]): readonly MarkdownReviewRange[] {
  const merged: MarkdownReviewRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    const overlaps = previous && range.start < previous.end;
    const adjacentWithSamePrecision =
      previous && range.start === previous.end && range.precision === previous.precision;
    if (previous && (overlaps || adjacentWithSamePrecision)) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
        unit: 'utf16-code-unit',
        precision:
          previous.precision === 'containing-construct' ||
          range.precision === 'containing-construct'
            ? 'containing-construct'
            : 'exact',
      };
    } else {
      merged.push(range);
    }
  }
  return Object.freeze(merged.map((range) => Object.freeze(range)));
}

interface IndexedSourceSlice {
  readonly index: number;
  readonly slice: MarkdownSourceSlice;
}

interface MarkdownProjectionIndex {
  readonly sources: readonly MarkdownSourceSlice[];
  readonly bySourceKey: ReadonlyMap<string, ParagraphProjectionIndex>;
  readonly paragraphsByScope: ReadonlyMap<string, SourceParagraphManifestIndex>;
}

interface SourceParagraphManifestIndex {
  readonly entries: readonly MarkdownSourceParagraph[];
  readonly positionsByParagraphId: ReadonlyMap<string, readonly number[]>;
}

interface ParagraphProjectionIndex {
  /** Source-ordered slices; ties retain generated Markdown order. */
  readonly entries: readonly IndexedSourceSlice[];
  /** Monotonic maximum `sourceEnd` through each entry, used to seek overlap starts. */
  readonly prefixMaxEnd: readonly number[];
  readonly byStart: ReadonlyMap<number, readonly IndexedSourceSlice[]>;
  readonly byEnd: ReadonlyMap<number, readonly IndexedSourceSlice[]>;
}

function indexProjection(value: MappedMarkdown): MarkdownProjectionIndex {
  const grouped = new Map<string, IndexedSourceSlice[]>();
  for (const [index, slice] of value.sources.entries()) {
    const key = markdownSourceCaptureKey(slice.sourceScope, slice.paragraphId);
    const entries = grouped.get(key) ?? [];
    entries.push({ index, slice });
    grouped.set(key, entries);
  }
  const bySourceKey = new Map<string, ParagraphProjectionIndex>();
  for (const [key, unsorted] of grouped) {
    const entries = unsorted.sort(
      (left, right) =>
        left.slice.sourceStart - right.slice.sourceStart ||
        left.slice.sourceEnd - right.slice.sourceEnd ||
        left.index - right.index
    );
    const prefixMaxEnd: number[] = [];
    const byStart = new Map<number, IndexedSourceSlice[]>();
    const byEnd = new Map<number, IndexedSourceSlice[]>();
    let maximumEnd = Number.NEGATIVE_INFINITY;
    for (const [position, entry] of entries.entries()) {
      maximumEnd = Math.max(maximumEnd, entry.slice.sourceEnd);
      prefixMaxEnd[position] = maximumEnd;
      const starts = byStart.get(entry.slice.sourceStart) ?? [];
      starts.push(entry);
      byStart.set(entry.slice.sourceStart, starts);
      const ends = byEnd.get(entry.slice.sourceEnd) ?? [];
      ends.push(entry);
      byEnd.set(entry.slice.sourceEnd, ends);
    }
    bySourceKey.set(key, { entries, prefixMaxEnd, byStart, byEnd });
  }
  const paragraphs: MarkdownSourceParagraph[] = [];
  for (const paragraph of value.paragraphs ?? []) {
    const previous = paragraphs[paragraphs.length - 1];
    if (
      previous &&
      previous.sourceScope === paragraph.sourceScope &&
      previous.paragraphId === paragraph.paragraphId
    ) {
      paragraphs[paragraphs.length - 1] = {
        ...previous,
        sourceStart: Math.min(previous.sourceStart, paragraph.sourceStart),
        sourceEnd: Math.max(previous.sourceEnd, paragraph.sourceEnd),
      };
    } else paragraphs.push(paragraph);
  }
  const paragraphsByScope = new Map<string, SourceParagraphManifestIndex>();
  const groupedParagraphs = new Map<string, MarkdownSourceParagraph[]>();
  for (const paragraph of paragraphs) {
    const entries = groupedParagraphs.get(paragraph.sourceScope) ?? [];
    entries.push(paragraph);
    groupedParagraphs.set(paragraph.sourceScope, entries);
  }
  for (const [scope, entries] of groupedParagraphs) {
    const positionsByParagraphId = new Map<string, number[]>();
    for (const [index, paragraph] of entries.entries()) {
      const positions = positionsByParagraphId.get(paragraph.paragraphId) ?? [];
      positions.push(index);
      positionsByParagraphId.set(paragraph.paragraphId, positions);
    }
    paragraphsByScope.set(scope, { entries, positionsByParagraphId });
  }
  return { sources: value.sources, bySourceKey, paragraphsByScope };
}

function firstPositionAtOrAfter(positions: readonly number[], minimum: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle]! < minimum) low = middle + 1;
    else high = middle;
  }
  return positions[low] ?? -1;
}

function firstPotentialOverlap(index: ParagraphProjectionIndex, offset: number): number {
  let low = 0;
  let high = index.prefixMaxEnd.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.prefixMaxEnd[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function overlappingEntries(
  index: ParagraphProjectionIndex,
  start: number,
  end: number
): readonly IndexedSourceSlice[] {
  const overlaps: IndexedSourceSlice[] = [];
  for (
    let position = firstPotentialOverlap(index, start);
    position < index.entries.length;
    position += 1
  ) {
    const entry = index.entries[position]!;
    if (entry.slice.sourceStart >= end) break;
    if (entry.slice.sourceEnd > start) overlaps.push(entry);
  }
  return overlaps.sort((left, right) => left.index - right.index);
}

function collapsedRange(
  index: ParagraphProjectionIndex,
  offset: number
): readonly MarkdownReviewRange[] {
  const firstInMarkdown = (
    entries: readonly IndexedSourceSlice[]
  ): IndexedSourceSlice | undefined =>
    entries.reduce<IndexedSourceSlice | undefined>(
      (first, entry) => (!first || entry.index < first.index ? entry : first),
      undefined
    );
  const next = firstInMarkdown(index.byStart.get(offset) ?? []);
  const containingEntries: IndexedSourceSlice[] = [];
  for (
    let position = firstPotentialOverlap(index, offset);
    position < index.entries.length;
    position += 1
  ) {
    const entry = index.entries[position]!;
    if (entry.slice.sourceStart >= offset) break;
    if (entry.slice.sourceEnd > offset) containingEntries.push(entry);
  }
  const containing = firstInMarkdown(containingEntries);
  const previous = next ?? containing ?? firstInMarkdown(index.byEnd.get(offset) ?? []);
  if (!previous) return Object.freeze([]);
  const range = rangeWithinSlice(previous.slice, offset, offset);
  return range ? Object.freeze([Object.freeze(range)]) : Object.freeze([]);
}

interface OccurrenceMapping {
  readonly ranges: readonly MarkdownReviewRange[];
  readonly coverage: MarkdownReviewCoverage;
}

interface SourceInterval {
  readonly start: number;
  readonly end: number;
}

function intervalsCover(intervals: readonly SourceInterval[], start: number, end: number): boolean {
  let coveredThrough = start;
  for (const interval of [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )) {
    if (interval.end <= coveredThrough) continue;
    if (interval.start > coveredThrough) return false;
    coveredThrough = interval.end;
    if (coveredThrough >= end) return true;
  }
  return coveredThrough >= end;
}

function mappedCoverage(
  ranges: readonly MarkdownReviewRange[],
  complete: boolean
): MarkdownReviewCoverage {
  return ranges.length === 0 ? 'none' : complete ? 'complete' : 'partial';
}

function rangesForOccurrence(
  projection: MarkdownProjectionIndex,
  occurrence: MarkdownReviewOccurrence
): OccurrenceMapping {
  const sourceScope = markdownReviewSourceScope(
    occurrence.rootStory,
    occurrence.source.partName,
    occurrence.noteScopeId
  );
  const source = occurrence.source;
  const { start, end } = source;
  if (start.paragraphId === end.paragraphId) {
    const paragraph = projection.bySourceKey.get(
      markdownSourceCaptureKey(sourceScope, start.paragraphId)
    );
    if (!paragraph) return { ranges: Object.freeze([]), coverage: 'none' };
    if (start.offset === end.offset) {
      const ranges = collapsedRange(paragraph, start.offset);
      return { ranges, coverage: mappedCoverage(ranges, ranges.length > 0) };
    }
    const mappedIntervals: SourceInterval[] = [];
    const ranges = overlappingEntries(paragraph, start.offset, end.offset)
      .map(({ slice }) => {
        const range = rangeWithinSlice(slice, start.offset, end.offset);
        if (range) {
          mappedIntervals.push({
            start: Math.max(start.offset, slice.sourceStart),
            end: Math.min(end.offset, slice.sourceEnd),
          });
        }
        return range;
      })
      .filter((range): range is MarkdownReviewRange => range !== null);
    const merged = mergeReviewRanges(ranges);
    return {
      ranges: merged,
      coverage: mappedCoverage(merged, intervalsCover(mappedIntervals, start.offset, end.offset)),
    };
  }

  const startParagraph = projection.bySourceKey.get(
    markdownSourceCaptureKey(sourceScope, start.paragraphId)
  );
  let firstStart: number | undefined;
  if (startParagraph) {
    for (
      let position = firstPotentialOverlap(startParagraph, start.offset);
      position < startParagraph.entries.length;
      position += 1
    ) {
      const entry = startParagraph.entries[position]!;
      if (entry.slice.sourceEnd <= start.offset) continue;
      firstStart = entry.index;
      break;
    }
  }
  if (firstStart === undefined) {
    const paragraphManifest = projection.paragraphsByScope.get(sourceScope);
    const startPosition = paragraphManifest?.positionsByParagraphId.get(start.paragraphId)?.[0];
    if (paragraphManifest && startPosition !== undefined) {
      const endPosition = firstPositionAtOrAfter(
        paragraphManifest.positionsByParagraphId.get(end.paragraphId) ?? [],
        startPosition
      );
      for (
        let position = startPosition + 1;
        position >= 0 && position <= endPosition;
        position += 1
      ) {
        const paragraph = paragraphManifest.entries[position]!;
        const projected = projection.bySourceKey.get(
          markdownSourceCaptureKey(sourceScope, paragraph.paragraphId)
        );
        const firstProjected = projected?.entries.reduce<IndexedSourceSlice | undefined>(
          (first, entry) => (!first || entry.index < first.index ? entry : first),
          undefined
        );
        if (firstProjected) {
          firstStart = firstProjected.index;
          break;
        }
      }
    }
  }
  if (firstStart === undefined) return { ranges: Object.freeze([]), coverage: 'none' };
  const ranges: MarkdownReviewRange[] = [];
  const mappedIntervals = new Map<string, SourceInterval[]>();
  const visitedBounds = new Map<string, SourceInterval>();
  let reachedEnd = false;
  for (let index = firstStart; index < projection.sources.length; index += 1) {
    const slice = projection.sources[index]!;
    if (slice.sourceScope !== sourceScope) continue;
    if (slice.paragraphId === start.paragraphId && slice.sourceEnd <= start.offset) continue;
    const sourceStart = slice.paragraphId === start.paragraphId ? start.offset : slice.sourceStart;
    const sourceEnd = slice.paragraphId === end.paragraphId ? end.offset : slice.sourceEnd;
    const clippedStart = Math.max(sourceStart, slice.sourceStart);
    const clippedEnd = Math.min(sourceEnd, slice.sourceEnd);
    const previousBounds = visitedBounds.get(slice.paragraphId);
    visitedBounds.set(slice.paragraphId, {
      start: Math.min(previousBounds?.start ?? clippedStart, clippedStart),
      end: Math.max(previousBounds?.end ?? clippedEnd, clippedEnd),
    });
    const range = rangeWithinSlice(slice, sourceStart, sourceEnd);
    if (range) {
      ranges.push(range);
      const intervals = mappedIntervals.get(slice.paragraphId) ?? [];
      intervals.push({ start: clippedStart, end: clippedEnd });
      mappedIntervals.set(slice.paragraphId, intervals);
    }
    if (slice.paragraphId === end.paragraphId && slice.sourceEnd >= end.offset) {
      reachedEnd = true;
      break;
    }
  }
  const merged = mergeReviewRanges(ranges);
  let complete = reachedEnd;
  const paragraphManifest = projection.paragraphsByScope.get(sourceScope);
  if (complete && paragraphManifest && paragraphManifest.entries.length > 0) {
    const startIndex = paragraphManifest.positionsByParagraphId.get(start.paragraphId)?.[0] ?? -1;
    const endIndex = firstPositionAtOrAfter(
      paragraphManifest.positionsByParagraphId.get(end.paragraphId) ?? [],
      Math.max(0, startIndex)
    );
    complete = startIndex >= 0 && endIndex >= startIndex;
    for (let index = startIndex; complete && index <= endIndex; index += 1) {
      const paragraph = paragraphManifest.entries[index]!;
      const expectedStart =
        paragraph.paragraphId === start.paragraphId ? start.offset : paragraph.sourceStart;
      const expectedEnd =
        paragraph.paragraphId === end.paragraphId ? end.offset : paragraph.sourceEnd;
      if (
        !intervalsCover(
          mappedIntervals.get(paragraph.paragraphId) ?? [],
          expectedStart,
          expectedEnd
        )
      ) {
        complete = false;
      }
    }
  } else if (complete) {
    for (const [paragraphId, bounds] of visitedBounds) {
      const expectedStart = paragraphId === start.paragraphId ? start.offset : 0;
      const expectedEnd = paragraphId === end.paragraphId ? end.offset : bounds.end;
      if (!intervalsCover(mappedIntervals.get(paragraphId) ?? [], expectedStart, expectedEnd)) {
        complete = false;
        break;
      }
    }
  }
  return { ranges: merged, coverage: mappedCoverage(merged, complete) };
}

function pageProjectionFor(
  occurrence: MarkdownReviewOccurrence
): MarkdownReviewProjection & { readonly kind: 'page' } {
  return Object.freeze({
    kind: 'page',
    pageIndex: occurrence.pageIndex,
    pageNumber: occurrence.physicalPageNumber,
    field:
      occurrence.rootStory === 'header'
        ? 'headerMarkdown'
        : occurrence.rootStory === 'footer'
          ? 'footerMarkdown'
          : 'markdown',
  });
}

function unmappedReasonFor(
  artifact: MarkdownReviewArtifact,
  occurrence: MarkdownReviewOccurrence,
  ranges: readonly MarkdownReviewRange[]
): MarkdownReviewUnmappedReason | undefined {
  if (occurrence.story === 'textbox' || occurrence.rootStory === 'note-separator') {
    return 'omitted-story-content';
  }
  if (artifact.kind === 'tracked-change' && artifact.change === 'structural') {
    return 'non-linear-structural-change';
  }
  return ranges.length === 0 ? 'not-represented-in-markdown' : undefined;
}

/** Build projection-specific bindings without leaking Markdown offsets into Core records. */
export function buildMarkdownReviewBindings(
  artifacts: readonly MarkdownReviewArtifact[],
  document: MappedMarkdown,
  pages: ReadonlyMap<number, MarkdownPageProjectionValues>
): readonly MarkdownReviewBinding[] {
  const bindings: MarkdownReviewBinding[] = [];
  const projectionIndexes = new WeakMap<MappedMarkdown, MarkdownProjectionIndex>();
  const indexed = (value: MappedMarkdown): MarkdownProjectionIndex => {
    const existing = projectionIndexes.get(value);
    if (existing) return existing;
    const created = indexProjection(value);
    projectionIndexes.set(value, created);
    return created;
  };
  const append = (
    artifact: MarkdownReviewArtifact,
    occurrence: MarkdownReviewOccurrence,
    occurrenceIndex: number,
    projection: MarkdownReviewProjection,
    value: MappedMarkdown
  ): void => {
    const mapping =
      occurrence.story === 'textbox' ||
      occurrence.rootStory === 'note-separator' ||
      (artifact.kind === 'tracked-change' && artifact.change === 'structural')
        ? { ranges: Object.freeze([]), coverage: 'none' as const }
        : rangesForOccurrence(indexed(value), occurrence);
    const unmappedReason = unmappedReasonFor(artifact, occurrence, mapping.ranges);
    bindings.push(
      Object.freeze({
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        occurrenceIndex,
        projection,
        ranges: mapping.ranges,
        coverage: mapping.coverage,
        ...(unmappedReason ? { unmappedReason } : {}),
      })
    );
  };

  for (const artifact of artifacts) {
    for (const [occurrenceIndex, occurrence] of artifact.occurrences.entries()) {
      const projection = pageProjectionFor(occurrence);
      const page = pages.get(occurrence.pageIndex);
      append(
        artifact,
        occurrence,
        occurrenceIndex,
        projection,
        page?.[projection.field] ?? EMPTY_MAPPED_MARKDOWN
      );
      if (
        occurrence.story !== 'textbox' &&
        (occurrence.rootStory === 'body' ||
          occurrence.rootStory === 'footnote' ||
          occurrence.rootStory === 'endnote')
      ) {
        append(
          artifact,
          occurrence,
          occurrenceIndex,
          Object.freeze({ kind: 'document' }),
          document
        );
      }
    }
  }
  return Object.freeze(bindings);
}

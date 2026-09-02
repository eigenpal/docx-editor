// Exporter-neutral laid-out bounds for review artifact occurrences.

import { documentOrder, documentOrderIndex, everyStoryOrder } from '../layout/document-order.ts';
import { xWithinLine } from '../layout/line-geometry.ts';
import { lineSegments, segmentOverlap } from '../layout/line-segments.ts';
import { caretAt } from '../layout/semantic-interaction.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import { paragraphFragmentsOfBlocks } from '../layout/semantic-records.ts';
import type { BlockFragmentRecord } from '../layout/semantic-records.ts';
import type {
  SemanticReviewArtifactOccurrence,
  SemanticReviewArtifactOccurrenceGeometry,
  SemanticReviewArtifactPageContentRect,
  SemanticReviewArtifactPageStackRect,
  SemanticReviewArtifactRecord,
} from '../layout/review-artifact-records.ts';
import type { PageRecord, SemanticLayout } from '../layout/semantic-records.ts';

/**
 * Cap on paragraph→range index entries for one attach pass.
 *
 * A hostile file can name a comment on every paragraph and then span the whole document.
 * Expanding each span into the index is occurrences × paragraphs. This keeps that product
 * finite; endpoints still register so start and end pages keep geometry.
 * @internal
 */
export const MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS = 65_536;

let reviewGeometryOrderBuilds = 0;
let reviewGeometrySpanParagraphVisits = 0;
let reviewGeometryBindings = 0;

/**
 * Warm-path recorder for review geometry index construction.
 * @internal
 */
export function reviewGeometryIndexRecorder(): {
  readonly orderBuilds: number;
  readonly spanParagraphVisits: number;
  readonly bindings: number;
  reset(): void;
} {
  return {
    get orderBuilds() {
      return reviewGeometryOrderBuilds;
    },
    get spanParagraphVisits() {
      return reviewGeometrySpanParagraphVisits;
    },
    get bindings() {
      return reviewGeometryBindings;
    },
    reset() {
      reviewGeometryOrderBuilds = 0;
      reviewGeometrySpanParagraphVisits = 0;
      reviewGeometryBindings = 0;
    },
  };
}

interface StoryOrderTables {
  readonly body: readonly string[];
  readonly bodyIndex: ReadonlyMap<string, number>;
  readonly every: readonly string[];
  readonly everyIndex: ReadonlyMap<string, number>;
}

interface IndexedRange {
  readonly key: string;
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
  readonly pageIndex: number;
  readonly sameParagraph: boolean;
}

function pageContentOrigin(page: PageRecord): Readonly<{ readonly x: number; readonly y: number }> {
  return Object.freeze({
    x: page.box.x + (page.contentBox.x - page.box.x),
    y: page.box.y + (page.contentBox.y - page.box.y),
  });
}

function storyPageContentOffset(
  page: PageRecord,
  storyBox: { readonly x: number; readonly y: number }
): Readonly<{ readonly x: number; readonly y: number }> {
  return Object.freeze({
    x: storyBox.x - page.contentBox.x,
    y: storyBox.y - page.contentBox.y,
  });
}

function occurrencePageContentOffset(
  page: PageRecord,
  occurrence: SemanticReviewArtifactOccurrence
): Readonly<{ readonly x: number; readonly y: number }> {
  switch (occurrence.rootStory) {
    case 'body':
      return Object.freeze({ x: 0, y: 0 });
    case 'header':
      return page.header
        ? storyPageContentOffset(page, page.header.box)
        : Object.freeze({ x: 0, y: 0 });
    case 'footer':
      return page.footer
        ? storyPageContentOffset(page, page.footer.box)
        : Object.freeze({ x: 0, y: 0 });
    case 'footnote':
    case 'endnote': {
      const area = occurrence.rootStory === 'footnote' ? page.footnotes : page.endnotes;
      const note = area?.notes.find((entry) => entry.scopeId === occurrence.noteScopeId);
      return note ? storyPageContentOffset(page, note.box) : Object.freeze({ x: 0, y: 0 });
    }
    case 'note-separator': {
      const area = occurrence.noteAreaKind === 'endnotes' ? page.endnotes : page.footnotes;
      return area?.separator
        ? storyPageContentOffset(page, area.separator.box)
        : Object.freeze({ x: 0, y: 0 });
    }
    default:
      return Object.freeze({ x: 0, y: 0 });
  }
}

function freezeRect<T extends SemanticReviewArtifactPageContentRect>(
  rect: T
): SemanticReviewArtifactPageContentRect {
  return Object.freeze({ ...rect });
}

function toPageStackRect(
  page: PageRecord,
  rect: SemanticReviewArtifactPageContentRect
): SemanticReviewArtifactPageStackRect {
  const origin = pageContentOrigin(page);
  return Object.freeze({
    x: origin.x + rect.x,
    y: origin.y + rect.y,
    width: rect.width,
    height: rect.height,
  });
}

function pointGeometry(
  layout: SemanticLayout,
  occurrence: SemanticReviewArtifactOccurrence
): SemanticReviewArtifactOccurrenceGeometry | undefined {
  const caret = caretAt(
    layout,
    {
      paragraphId: occurrence.source.start.paragraphId,
      offset: occurrence.source.start.offset,
    },
    { preferredPageIndex: occurrence.pageIndex }
  );
  if (!caret || caret.pageIndex !== occurrence.pageIndex) return undefined;
  const page = layout.pages[caret.pageIndex];
  if (!page) return undefined;
  const origin = occurrencePageContentOffset(page, occurrence);
  const width = Math.max(1, caret.height * 0.05);
  const pageContent = Object.freeze([
    freezeRect({ x: caret.x + origin.x, y: caret.y + origin.y, width, height: caret.height }),
  ]);
  return Object.freeze({
    pageContent,
    pageStack: Object.freeze(pageContent.map((rect) => toPageStackRect(page, rect))),
  });
}

function geometryOfOccurrence(
  layout: SemanticLayout,
  occurrence: SemanticReviewArtifactOccurrence,
  rects: readonly {
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[]
): SemanticReviewArtifactOccurrenceGeometry | undefined {
  const onPage = rects.filter((rect) => rect.pageIndex === occurrence.pageIndex);
  if (onPage.length === 0) {
    const point =
      occurrence.source.start.paragraphId === occurrence.source.end.paragraphId &&
      occurrence.source.start.offset === occurrence.source.end.offset;
    return point ? pointGeometry(layout, occurrence) : undefined;
  }
  const page = layout.pages[occurrence.pageIndex];
  if (!page) return undefined;
  const pageContent = Object.freeze(onPage.map((rect) => freezeRect(rect)));
  return Object.freeze({
    pageContent,
    pageStack: Object.freeze(pageContent.map((rect) => toPageStackRect(page, rect))),
  });
}

function isPointOccurrence(occurrence: SemanticReviewArtifactOccurrence): boolean {
  return (
    occurrence.source.start.paragraphId === occurrence.source.end.paragraphId &&
    occurrence.source.start.offset === occurrence.source.end.offset
  );
}

function rangeKey(pageIndex: number, paragraphId: string): string {
  return `${pageIndex}\0${paragraphId}`;
}

function sameParagraphOverlap(
  segment: { readonly start: number; readonly end: number },
  from: SemanticPosition,
  to: SemanticPosition
): { start: number; end: number } | null {
  const start = Math.max(segment.start, from.offset);
  const end = Math.min(segment.end, to.offset);
  return end > start ? { start, end } : null;
}

function buildStoryOrderTables(layout: SemanticLayout): StoryOrderTables {
  reviewGeometryOrderBuilds += 1;
  const every = everyStoryOrder(layout);
  return {
    body: documentOrder(layout),
    bodyIndex: documentOrderIndex(layout),
    every,
    everyIndex: new Map(every.map((paragraphId, at) => [paragraphId, at])),
  };
}

function orderTableForRange(
  tables: StoryOrderTables,
  from: SemanticPosition,
  to: SemanticPosition
): { readonly order: readonly string[]; readonly index: ReadonlyMap<string, number> } {
  if (tables.bodyIndex.has(from.paragraphId) && tables.bodyIndex.has(to.paragraphId)) {
    return { order: tables.body, index: tables.bodyIndex };
  }
  return { order: tables.every, index: tables.everyIndex };
}

function orderedEndpoints(
  from: SemanticPosition,
  to: SemanticPosition,
  index: ReadonlyMap<string, number>
): { readonly from: SemanticPosition; readonly to: SemanticPosition } | null {
  const fromAt = index.get(from.paragraphId);
  const toAt = index.get(to.paragraphId);
  if (fromAt === undefined || toAt === undefined) return null;
  if (fromAt < toAt || (fromAt === toAt && from.offset <= to.offset)) return { from, to };
  return { from: to, to: from };
}

function collectIndexedRangeRects(
  layout: SemanticLayout,
  artifacts: readonly SemanticReviewArtifactRecord[]
): Map<string, { pageIndex: number; x: number; y: number; width: number; height: number }[]> {
  const found = new Map<
    string,
    { pageIndex: number; x: number; y: number; width: number; height: number }[]
  >();
  const byParagraph = new Map<string, IndexedRange[]>();
  const pages = new Set<number>();
  let bindings = 0;
  let orders: StoryOrderTables | undefined;
  reviewGeometryOrderBuilds = 0;
  reviewGeometrySpanParagraphVisits = 0;
  reviewGeometryBindings = 0;

  const register = (range: IndexedRange, paragraphId: string): boolean => {
    if (bindings >= MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS) return false;
    bindings += 1;
    reviewGeometryBindings = bindings;
    const key = rangeKey(range.pageIndex, paragraphId);
    const list = byParagraph.get(key);
    if (list) list.push(range);
    else byParagraph.set(key, [range]);
    return true;
  };

  const registerSpan = (
    range: IndexedRange,
    order: readonly string[],
    index: ReadonlyMap<string, number>
  ): void => {
    const fromAt = index.get(range.from.paragraphId);
    const toAt = index.get(range.to.paragraphId);
    if (fromAt === undefined || toAt === undefined) {
      register(range, range.from.paragraphId);
      register(range, range.to.paragraphId);
      return;
    }
    const start = Math.min(fromAt, toAt);
    const end = Math.max(fromAt, toAt);
    const remaining = MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS - bindings;
    if (end - start + 1 > remaining) {
      register(range, order[start]!);
      register(range, order[end]!);
      return;
    }
    for (let at = start; at <= end; at += 1) {
      if (bindings >= MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS) return;
      reviewGeometrySpanParagraphVisits += 1;
      if (!register(range, order[at]!)) return;
    }
  };

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    for (const [occurrenceIndex, occurrence] of artifact.occurrences.entries()) {
      if (isPointOccurrence(occurrence)) continue;
      pages.add(occurrence.pageIndex);
      const key = `${artifactIndex}\0${occurrenceIndex}`;
      const from = {
        paragraphId: occurrence.source.start.paragraphId,
        offset: occurrence.source.start.offset,
      };
      const to = {
        paragraphId: occurrence.source.end.paragraphId,
        offset: occurrence.source.end.offset,
      };
      if (from.paragraphId === to.paragraphId) {
        const ordered = from.offset <= to.offset ? { from, to } : { from: to, to: from };
        register(
          {
            key,
            from: ordered.from,
            to: ordered.to,
            pageIndex: occurrence.pageIndex,
            sameParagraph: true,
          },
          ordered.from.paragraphId
        );
        continue;
      }
      orders ??= buildStoryOrderTables(layout);
      const table = orderTableForRange(orders, from, to);
      const pair = orderedEndpoints(from, to, table.index);
      if (!pair) continue;
      registerSpan(
        {
          key,
          from: pair.from,
          to: pair.to,
          pageIndex: occurrence.pageIndex,
          sameParagraph: false,
        },
        table.order,
        table.index
      );
    }
  }

  if (byParagraph.size === 0) return found;

  const take = (
    blocks: readonly BlockFragmentRecord[],
    pageIndex: number,
    offsetX: number,
    offsetY: number
  ): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          const ranges = byParagraph.get(rangeKey(pageIndex, segment.paragraphId));
          if (!ranges) continue;
          for (const range of ranges) {
            const overlap = range.sameParagraph
              ? sameParagraphOverlap(segment, range.from, range.to)
              : segmentOverlap(layout, segment, range.from, range.to);
            if (!overlap) continue;
            const startX = xWithinLine(line, overlap.start, undefined, segment);
            const endX = xWithinLine(line, overlap.end, undefined, segment);
            const rects = found.get(range.key) ?? [];
            rects.push({
              pageIndex,
              x: Math.min(startX, endX) + offsetX,
              y: line.box.y + offsetY,
              width: Math.abs(endX - startX),
              height: line.box.height,
            });
            found.set(range.key, rects);
          }
        }
      }
    }
  };

  for (const page of layout.pages) {
    if (!pages.has(page.index)) continue;
    take(page.fragments, page.index, 0, 0);
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      take(
        story.fragments,
        page.index,
        story.box.x - page.contentBox.x,
        story.box.y - page.contentBox.y
      );
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        take(
          note.fragments,
          page.index,
          note.box.x - page.contentBox.x,
          note.box.y - page.contentBox.y
        );
      }
    }
  }
  return found;
}

/** Attach laid-out geometry to every occurrence that can be measured on this layout. @internal */
export function attachReviewArtifactGeometry(
  layout: SemanticLayout,
  artifacts: readonly SemanticReviewArtifactRecord[]
): readonly SemanticReviewArtifactRecord[] {
  let hasOccurrence = false;
  for (const artifact of artifacts) {
    if (artifact.occurrences.length === 0) continue;
    hasOccurrence = true;
    break;
  }
  if (!hasOccurrence) return artifacts;
  const rectsByKey = collectIndexedRangeRects(layout, artifacts);
  return artifacts.map((artifact, artifactIndex) => {
    if (artifact.occurrences.length === 0) return artifact;
    const occurrences = artifact.occurrences.map((occurrence, occurrenceIndex) => {
      const key = `${artifactIndex}\0${occurrenceIndex}`;
      const geometry = geometryOfOccurrence(layout, occurrence, rectsByKey.get(key) ?? []);
      if (!geometry) return occurrence;
      return { ...occurrence, geometry };
    });
    return { ...artifact, occurrences: Object.freeze(occurrences) };
  });
}

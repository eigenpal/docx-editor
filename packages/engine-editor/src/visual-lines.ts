// Build layout-authoritative visual line records for keyboard navigation (task 5.5).

import type { BlockSemanticRecord, SemanticPositionIndex } from '@docx-editor.dev/core-contract/interaction';
import type { PackageModel } from '@docx-editor.dev/engine-core';
import type { CaretEdgeItem, Page, VisualLineIdentity as LayoutLineIdentity } from '@docx-editor.dev/engine-layout';
import { caretAffinity, paragraphGraphemeCountById, paragraphTextById, twipsToPx } from './semantic-index.ts';
import type {
  FragmentInteractionMeta,
  VisualCaretEdge,
  VisualLineIdentity,
  VisualLineRecord,
} from './navigation-geometry.ts';

const px = twipsToPx;

/**
 * Block records by id, indexed once per semantic index.
 *
 * This allocated a flattened array of EVERY block and then linear-searched it, on
 * every call — and it is called per caret edge, i.e. once per character. That made
 * `buildVisualLines` the dominant quadratic in display publication: independent
 * review measured an ORDINARY 4,000-paragraph / 38 KB / 75-page document (plain
 * sentences, one run each) freezing `createEditor()` for 120.7 s on open and again on
 * every keystroke, with 8,000 paragraphs taking 8.9 minutes. After the other three
 * bridge terms were indexed, `buildVisualLines` alone still accounted for 6,361 ms of
 * a 6,601 ms publish at 4,000 paragraphs — this call is why.
 *
 * Keyed on the index object, which is rebuilt per layout.
 */
const blockRecordCache = new WeakMap<SemanticPositionIndex, Map<string, BlockSemanticRecord>>();

function blockRecord(index: SemanticPositionIndex, blockId: string): BlockSemanticRecord | undefined {
  let byId = blockRecordCache.get(index);
  if (!byId) {
    byId = new Map();
    for (const story of index.stories) {
      for (const block of story.blocks) byId.set(block.identity.blockId, block);
    }
    blockRecordCache.set(index, byId);
  }
  return byId.get(blockId);
}

function roleForBlock(index: SemanticPositionIndex, blockId: string) {
  const block = blockRecord(index, blockId);
  return block?.readOnly ? ('selectableText' as const) : ('editableText' as const);
}

function edgeKey(edge: VisualCaretEdge): string {
  const t = edge.target;
  return `${t.identity.storyId}:${t.identity.blockId}:${t.graphemeOffset}:${t.affinity}:${edge.pageLocalX}`;
}

function bucketKey(pageIndex: number, line: LayoutLineIdentity): string {
  return `${pageIndex}:${line.lineId}:${line.fragmentId}`;
}

type PaintSliceSpan = {
  readonly anchor: number;
  readonly utf16End: number;
  readonly line: LayoutLineIdentity;
  readonly meta: FragmentInteractionMeta;
  /** Whitespace gap inferred between real paint slices — not a painted TextItem. */
  readonly syntheticWhitespace?: boolean;
};

function paintSliceMetaKey(pageIndex: number, line: LayoutLineIdentity, anchorOffset: number): string {
  return `${pageIndex}:${line.lineId}:${line.fragmentId}:${anchorOffset}`;
}

function fragmentMetaKey(pageIndex: number, line: LayoutLineIdentity): string {
  return bucketKey(pageIndex, line);
}

function boundaryMetaComparable(meta: FragmentInteractionMeta): string {
  return JSON.stringify({
    pageIndex: meta.pageIndex,
    writingDirection: meta.writingDirection,
    writingMode: meta.writingMode,
    clip: meta.clip,
    transform: meta.transform,
    role: meta.role,
    zOrder: meta.zOrder,
  });
}

function fragmentConflictComparable(meta: FragmentInteractionMeta): string {
  return JSON.stringify({
    pageIndex: meta.pageIndex,
    writingDirection: meta.writingDirection,
    writingMode: meta.writingMode,
    clip: meta.clip,
    transform: meta.transform,
    role: meta.role,
  });
}

function augmentSlicesWithWhitespaceGaps(slices: readonly PaintSliceSpan[]): PaintSliceSpan[] {
  const sorted = [...slices].filter((slice) => !slice.syntheticWhitespace).sort((a, b) => a.anchor - b.anchor);
  const augmented: PaintSliceSpan[] = [...sorted];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    if (left.utf16End < right.anchor) {
      augmented.push({
        anchor: left.utf16End,
        utf16End: right.anchor,
        line: left.line,
        meta: left.meta,
        syntheticWhitespace: true,
      });
    }
  }
  return augmented.sort((a, b) => a.anchor - b.anchor);
}

function buildRealPaintSliceIndex(
  pages: readonly Page[],
  roleForParagraph: (paragraphId: string) => FragmentInteractionMeta['role'],
): Map<string, PaintSliceSpan[]> {
  const byFragment = new Map<string, PaintSliceSpan[]>();
  for (const page of pages) {
    let z = 0;
    for (const item of page.items) {
      if (item.type !== 'text') continue;
      const fragKey = fragmentMetaKey(page.index, item.line);
      const meta = Object.freeze({
        pageIndex: page.index,
        zOrder: z,
        lineId: item.line.lineId,
        fragmentId: item.line.fragmentId,
        paintSliceAnchor: item.anchor.offset,
        writingDirection: 'ltr' as const,
        writingMode: 'horizontal-tb' as const,
        role: roleForParagraph(item.anchor.paragraphId),
      });
      const span: PaintSliceSpan = {
        anchor: item.anchor.offset,
        utf16End: item.anchor.offset + item.text.length,
        line: item.line,
        meta,
      };
      const list = byFragment.get(fragKey) ?? [];
      list.push(span);
      byFragment.set(fragKey, list);
      z += 1;
    }
  }
  for (const [fragKey, spans] of byFragment) {
    byFragment.set(
      fragKey,
      [...spans].sort((a, b) => a.anchor - b.anchor),
    );
  }
  return byFragment;
}

function buildNavigationPaintSliceIndex(
  pages: readonly Page[],
  roleForParagraph: (paragraphId: string) => FragmentInteractionMeta['role'],
): Map<string, PaintSliceSpan[]> {
  const real = buildRealPaintSliceIndex(pages, roleForParagraph);
  const withGaps = new Map<string, PaintSliceSpan[]>();
  for (const [fragKey, spans] of real) {
    withGaps.set(fragKey, augmentSlicesWithWhitespaceGaps(spans));
  }
  return withGaps;
}

interface SliceIndex {
  /** Real (non-synthetic) slices, ascending by `utf16End`. */
  readonly real: readonly PaintSliceSpan[];
  readonly endingAt: Map<number, PaintSliceSpan[]>;
  readonly startingAt: Map<number, PaintSliceSpan[]>;
  readonly realStartingAt: Map<number, PaintSliceSpan[]>;
  readonly realEndingAt: Map<number, PaintSliceSpan[]>;
  /** All slices ascending by `anchor`, for the containing-interval lookup. */
  readonly byAnchor: readonly PaintSliceSpan[];
  /** Longest slice, bounding how far back the containing scan must walk. */
  readonly maxSpan: number;
}

/**
 * Paint-slice lookup index, built once per slice array.
 *
 * `resolveEdgePaintSlice` ran three to five `slices.filter(...)` passes over the
 * fragment's entire paint-slice array, once per CARET EDGE — and a whitespace-free
 * paragraph puts every slice and every edge on one visual line, so cost was
 * O(edges x slicesPerLine). Independent review located it here after the earlier
 * bridge fixes, and proved it by holding characters and edges fixed at 16,000 while
 * varying only slices-per-line: 1 slice 31 ms, 16,000 slices 997 ms, strictly
 * proportional.
 *
 * Keyed on the array identity, which is rebuilt per layout.
 */
const sliceIndexCache = new WeakMap<readonly PaintSliceSpan[], SliceIndex>();

function push(map: Map<number, PaintSliceSpan[]>, key: number, slice: PaintSliceSpan): void {
  const list = map.get(key);
  if (list) list.push(slice);
  else map.set(key, [slice]);
}

function sliceIndexFor(slices: readonly PaintSliceSpan[]): SliceIndex {
  const cached = sliceIndexCache.get(slices);
  if (cached) return cached;
  const endingAt = new Map<number, PaintSliceSpan[]>();
  const startingAt = new Map<number, PaintSliceSpan[]>();
  const realStartingAt = new Map<number, PaintSliceSpan[]>();
  const realEndingAt = new Map<number, PaintSliceSpan[]>();
  const real: PaintSliceSpan[] = [];
  let maxSpan = 0;
  for (const slice of slices) {
    push(endingAt, slice.utf16End, slice);
    push(startingAt, slice.anchor, slice);
    if (!slice.syntheticWhitespace) {
      real.push(slice);
      push(realStartingAt, slice.anchor, slice);
      push(realEndingAt, slice.utf16End, slice);
    }
    const span = slice.utf16End - slice.anchor;
    if (span > maxSpan) maxSpan = span;
  }
  // `realSlices.filter(...).at(-1)` relied on ascending `utf16End`; make it explicit.
  real.sort((a, b) => a.utf16End - b.utf16End);
  const byAnchor = [...slices].sort((a, b) => a.anchor - b.anchor);
  const index: SliceIndex = { real, endingAt, startingAt, realStartingAt, realEndingAt, byAnchor, maxSpan };
  sliceIndexCache.set(slices, index);
  return index;
}

/** Slices strictly containing `offset`, found without scanning the whole array. */
function containingSlices(index: SliceIndex, offset: number): PaintSliceSpan[] {
  const { byAnchor, maxSpan } = index;
  // Last position whose anchor is < offset.
  let lo = 0;
  let hi = byAnchor.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byAnchor[mid]!.anchor < offset) lo = mid + 1;
    else hi = mid;
  }
  const out: PaintSliceSpan[] = [];
  // Only slices that could still reach past `offset` — bounded by the longest span.
  for (let i = lo - 1; i >= 0 && byAnchor[i]!.anchor > offset - maxSpan - 1; i -= 1) {
    const slice = byAnchor[i]!;
    if (slice.anchor < offset && offset < slice.utf16End) out.push(slice);
  }
  return out;
}

/** Last real slice ending at or before `offset`, by binary search over `real`. */
function lastRealEndingAtOrBefore(index: SliceIndex, offset: number): PaintSliceSpan | undefined {
  const { real } = index;
  let lo = 0;
  let hi = real.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (real[mid]!.utf16End <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? real[lo - 1] : undefined;
}

/** Resolve paint-slice metadata for one caret edge UTF-16 offset; null when ambiguous. */
function resolveEdgePaintSlice(
  utf16Offset: number,
  paragraphUtf16Length: number,
  slices: readonly PaintSliceSpan[],
): { meta: FragmentInteractionMeta; paintSliceAnchor: number } | null {
  if (slices.length === 0) return null;

  const index = sliceIndexFor(slices);

  if (utf16Offset === paragraphUtf16Length) {
    const ending = index.realEndingAt.get(utf16Offset)?.[0];
    if (ending) return { meta: ending.meta, paintSliceAnchor: ending.anchor };
  }

  const left = index.endingAt.get(utf16Offset) ?? [];
  const right = index.startingAt.get(utf16Offset) ?? [];
  if (left.length === 1 && right.length === 1) {
    const leftSlice = left[0]!;
    const rightSlice = right[0]!;
    if (leftSlice.syntheticWhitespace && !rightSlice.syntheticWhitespace) {
      return { meta: rightSlice.meta, paintSliceAnchor: rightSlice.anchor };
    }
    if (!leftSlice.syntheticWhitespace && rightSlice.syntheticWhitespace) {
      return { meta: leftSlice.meta, paintSliceAnchor: leftSlice.anchor };
    }
    if (leftSlice.syntheticWhitespace || rightSlice.syntheticWhitespace) {
      return null;
    }
    if (boundaryMetaComparable(leftSlice.meta) === boundaryMetaComparable(rightSlice.meta)) {
      return { meta: leftSlice.meta, paintSliceAnchor: leftSlice.anchor };
    }
    return null;
  }

  const containing = containingSlices(index, utf16Offset);
  if (containing.length === 1) {
    const slice = containing[0]!;
    if (slice.syntheticWhitespace) {
      const adjacentReal = lastRealEndingAtOrBefore(index, utf16Offset);
      if (!adjacentReal) return null;
      return { meta: adjacentReal.meta, paintSliceAnchor: adjacentReal.anchor };
    }
    return { meta: slice.meta, paintSliceAnchor: slice.anchor };
  }
  if (containing.length > 1) return null;

  const atAnchor = index.realStartingAt.get(utf16Offset) ?? [];
  if (atAnchor.length === 1) {
    return { meta: atAnchor[0]!.meta, paintSliceAnchor: atAnchor[0]!.anchor };
  }
  if (atAnchor.length > 1) return null;

  return null;
}

/** Build visual line records grouped by layout lineId + fragmentId only. */
export function buildVisualLines(
  pages: readonly Page[],
  semanticIndex: SemanticPositionIndex,
  model: PackageModel,
  metaBySliceKey: Readonly<Record<string, FragmentInteractionMeta>>,
  paintFragmentConflicts: readonly string[],
): VisualLineRecord[] {
  void metaBySliceKey;
  const story = semanticIndex.stories[0];
  if (!story) return [];

  type Bucket = {
    line: VisualLineIdentity;
    pageIndex: number;
    interaction: FragmentInteractionMeta;
    edges: Map<string, VisualCaretEdge>;
  };

  const buckets = new Map<string, Bucket>();
  const conflictSet = new Set(paintFragmentConflicts);
  const roleForParagraph = (paragraphId: string) => roleForBlock(semanticIndex, paragraphId);
  const sliceIndex = buildNavigationPaintSliceIndex(pages, roleForParagraph);

  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'caretEdge') continue;
      const edgeItem = item as CaretEdgeItem;
      if (!edgeItem.navigable) continue;
      const fragKey = fragmentMetaKey(page.index, edgeItem.line);
      if (conflictSet.has(fragKey)) continue;

      const paragraphUtf16Length = paragraphTextById(model, edgeItem.paragraphId).length;
      const resolved = resolveEdgePaintSlice(
        edgeItem.utf16Offset,
        paragraphUtf16Length,
        sliceIndex.get(fragKey) ?? [],
      );
      if (!resolved) continue;

      const key = bucketKey(page.index, edgeItem.line);
      const meta = resolved.meta;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          line: {
            lineId: edgeItem.line.lineId,
            fragmentId: edgeItem.line.fragmentId,
            lineIndex: edgeItem.line.lineIndex,
            fragmentIndex: edgeItem.line.fragmentIndex,
          },
          pageIndex: page.index,
          interaction: meta,
          edges: new Map(),
        };
        buckets.set(key, bucket);
      }
      const paragraphGraphemeCount = paragraphGraphemeCountById(model, edgeItem.paragraphId);
      const edge: VisualCaretEdge = {
        target: {
          kind: 'text',
          scope: story.scope,
          identity: { storyId: story.storyId, blockId: edgeItem.paragraphId },
          graphemeOffset: edgeItem.graphemeOffset,
          affinity:
            edgeItem.affinity === 'downstream' ? 'downstream' : caretAffinity(edgeItem.graphemeOffset, paragraphGraphemeCount),
        },
        role: roleForParagraph(edgeItem.paragraphId),
        pageLocalX: px(edgeItem.x),
        pageLocalY: px(edgeItem.y),
        pageLocalHeight: px(edgeItem.height),
        navigable: edgeItem.navigable,
        provenance: 'geometry',
        interaction: {
          ...meta,
          paintSliceAnchor: resolved.paintSliceAnchor,
        },
      };
      bucket.edges.set(edgeKey(edge), edge);
    }
  }

  const blockOrder = new Map(story.blocks.map((block) => [block.identity.blockId, block.orderIndex]));

  const sorted = [...buckets.values()].sort((a, b) => {
    const blockA = [...a.edges.values()][0]?.target.identity.blockId ?? '';
    const blockB = [...b.edges.values()][0]?.target.identity.blockId ?? '';
    const orderDiff = (blockOrder.get(blockA) ?? 0) - (blockOrder.get(blockB) ?? 0);
    if (orderDiff !== 0) return orderDiff;
    if (a.line.lineIndex !== b.line.lineIndex) return a.line.lineIndex - b.line.lineIndex;
    if (a.line.fragmentIndex !== b.line.fragmentIndex) return a.line.fragmentIndex - b.line.fragmentIndex;
    return a.pageIndex - b.pageIndex;
  });

  let lineOrder = 0;
  let lastLineKey = '';
  let fragmentOrder = 0;
  let lastFragmentKey = '';

  return sorted.map((bucket) => {
    const lineKey = `${[...bucket.edges.values()][0]?.target.identity.blockId ?? ''}:${bucket.line.lineId}`;
    if (lineKey !== lastLineKey) {
      lineOrder += 1;
      lastLineKey = lineKey;
    }
    const fragmentKey = `${lineKey}:${bucket.line.fragmentId}`;
    if (fragmentKey !== lastFragmentKey) {
      fragmentOrder += 1;
      lastFragmentKey = fragmentKey;
    }
    const blockId = [...bucket.edges.values()][0]?.target.identity.blockId ?? '';
    const edges = [...bucket.edges.values()].sort(
      (left, right) => left.pageLocalX - right.pageLocalX || left.target.graphemeOffset - right.target.graphemeOffset,
    );
    const xs = edges.map((edge) => edge.pageLocalX);
    const ys = edges.map((edge) => edge.pageLocalY);
    const heights = edges.map((edge) => edge.pageLocalHeight);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxH = Math.max(...heights);
    return {
      scope: story.scope,
      identity: { storyId: story.storyId, blockId },
      pageIndex: bucket.pageIndex,
      line: bucket.line,
      lineOrder,
      fragmentOrder,
      interaction: bucket.interaction,
      lineBox: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: maxH },
      edges,
    };
  });
}

export function collectFragmentMetaFromLayout(
  pages: readonly Page[],
  roleForParagraph: (paragraphId: string) => FragmentInteractionMeta['role'],
): { metaBySliceKey: Record<string, FragmentInteractionMeta>; conflicts: readonly string[] } {
  const bySlice: Record<string, FragmentInteractionMeta> = {};
  const byFragment: Record<string, FragmentInteractionMeta> = {};
  const conflicts = new Set<string>();
  const realSliceIndex = buildRealPaintSliceIndex(pages, roleForParagraph);
  for (const [fragKey, spans] of realSliceIndex) {
    for (const span of spans) {
      bySlice[paintSliceMetaKey(span.meta.pageIndex, span.line, span.anchor)] = span.meta;
    }
    const prior = byFragment[fragKey];
    const first = spans[0]?.meta;
    if (!first) continue;
    if (!prior) {
      byFragment[fragKey] = first;
    } else if (fragmentConflictComparable(prior) !== fragmentConflictComparable(first)) {
      conflicts.add(fragKey);
    }
    for (let i = 1; i < spans.length; i += 1) {
      const left = spans[i - 1]!.meta;
      const right = spans[i]!.meta;
      if (fragmentConflictComparable(left) !== fragmentConflictComparable(right)) {
        conflicts.add(fragKey);
        break;
      }
    }
  }
  return { metaBySliceKey: Object.freeze(bySlice), conflicts: Object.freeze([...conflicts]) };
}

export function layoutShapingSupported(pages: readonly Page[]): boolean {
  let hasNavigable = false;
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'caretEdge') continue;
      if (item.navigable) hasNavigable = true;
      else if (item.shaping === 'unsupported') continue;
    }
  }
  return hasNavigable;
}

// The display bridge reconciles the engine layout IR with the contract display IR using
// model-derived semantic indexing (interactive-paginated-editing 3.2–3.4).

import type {
  DisplayPage,
  DisplayItem as ContractItem,
  GlyphRun,
  BorderSeg,
} from '@docx-editor.dev/core-contract/geometry';
import type {
  AffineTransform,
  InteractionFrame,
  BlockSemanticRecord,
  SemanticPositionIndex,
  ShapedCluster,
} from '@docx-editor.dev/core-contract/interaction';
import type { ColorValue, Rect, ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { PositionedInteractionMeta } from '@docx-editor.dev/core-contract/interaction';
import type { PackageModel } from '@docx-editor.dev/engine-core';
import type { Page, TextItem, RectItem } from '@docx-editor.dev/engine-layout';
import {
  HelveticaMetrics,
  semanticHorizontalBoundaries,
  type MetricsPort,
} from '@docx-editor.dev/engine-layout';
import {
  buildSemanticIndex,
  buildTraversalLinksForModel,
  deprecatedFlatDocOffset,
  paragraphGraphemeCountById,
  paragraphTextById,
  semanticTextSpan,
  twipsToPx,
} from './semantic-index.ts';
import { graphemeBoundaryEpoch } from '@docx-editor.dev/engine-layout';
import { clustersFromLayoutCaretEdges } from './layout-clusters.ts';
import { deepFreezeValue } from './interaction-frame.ts';
import {
  buildVisualLines,
  collectFragmentMetaFromLayout,
  layoutShapingSupported,
  type PreOrderVisualLine,
} from './visual-lines.ts';
import {
  freezeNavigationGeometry,
  recordFromTraversalMap,
  type NavigationGeometry,
} from './navigation-geometry.ts';

const px = twipsToPx;
const BLACK: ColorValue = { kind: 'hex', value: '000000' };
const BODY: ViewScope = { kind: 'body' };

const boxOf = (it: { x: number; y: number; width: number; height: number }): Rect => ({
  x: px(it.x),
  y: px(it.y),
  width: px(it.width),
  height: px(it.height),
});

function interactionMeta(
  pageIndex: number,
  zOrder: number,
  role: PositionedInteractionMeta['role'] = 'editableText',
  extra: Partial<PositionedInteractionMeta> = {}
): PositionedInteractionMeta {
  return {
    pageIndex,
    zOrder,
    writingDirection: 'ltr',
    writingMode: 'horizontal-tb',
    role,
    ...extra,
  };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Caret edges grouped by paragraph, in ONE pass over the pages.
 *
 * `whitespaceBoxFromCaretEdges` scanned every item on every page, and it is called
 * once per `lineWhitespace` ownership region — one or more per paragraph. That made
 * it O(regions x items), the dominant term of four independent quadratics review
 * measured in `toDisplayPages`: an ORDINARY 4,000-paragraph / 38 KB / 75-page
 * document froze `createEditor()` for 120.7 s on open and again on every keystroke,
 * and 8,000 paragraphs took 8.9 minutes. Nothing crafted — plain sentences, one run
 * per paragraph.
 *
 * Keyed on the `pages` array identity, which `layoutBody` returns fresh per layout,
 * so a new layout gets a new index with no explicit eviction.
 */
interface EdgeGeometry {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/**
 * Navigable caret-edge geometry keyed by (paragraph, grapheme offset).
 *
 * Grouping edges by paragraph was not enough. A whitespace ownership region still
 * scanned every edge OF ITS PARAGRAPH, and there is one region per whitespace run, so
 * cost stayed O(regions x edges) INSIDE a single paragraph. Independent review proved
 * the exponent was still ~1.80 at HEAD and that the trigger is plain prose with zero
 * formatting: a 533-byte .docx spends 2,428 ms in `toDisplayPages`, and 80,000
 * characters as ONE paragraph costs 10x the same text split across 250 paragraphs.
 *
 * An offset-keyed map makes each region O(1). The previous guard could not see this
 * because all three of its tests scale PARAGRAPH COUNT while the quadratic is within
 * a paragraph — the fifth generation of the same trap: right layer, wrong axis.
 */
const edgesByParagraphCache = new WeakMap<
  readonly Page[],
  Map<string, Map<number, EdgeGeometry>>
>();

function navigableEdgesForParagraph(
  pages: readonly Page[],
  paragraphId: string
): Map<number, EdgeGeometry> {
  let byParagraph = edgesByParagraphCache.get(pages);
  if (!byParagraph) {
    byParagraph = new Map();
    for (const page of pages) {
      for (const item of page.items) {
        if (item.type !== 'caretEdge' || !item.navigable) continue;
        let byOffset = byParagraph.get(item.paragraphId);
        if (!byOffset) {
          byOffset = new Map();
          byParagraph.set(item.paragraphId, byOffset);
        }
        // LAST wins, which is what the previous scan did by overwriting as it walked
        // pages in order. It matters: an all-whitespace paragraph publishes two edges
        // for offset 0 at different x (a separate open defect), and last-wins makes
        // `right <= left` so the region is dropped and paragraph ownership takes over.
        // Taking the leftmost instead produced a box and broke whitespace-only
        // double-click selection — caught by an existing test.
        byOffset.set(item.graphemeOffset, {
          x: px(item.x),
          y: px(item.y),
          height: px(item.height),
        });
      }
    }
    edgesByParagraphCache.set(pages, byParagraph);
  }
  return byParagraph.get(paragraphId) ?? new Map();
}

function whitespaceBoxFromCaretEdges(
  pages: readonly Page[],
  paragraphId: string,
  // Retained for call-site clarity: the paragraph's edges are already page-scoped by
  // the grouped index, so filtering by page here would be redundant.
  _pageIndex: number,
  graphemeFrom: number,
  graphemeTo: number
): Rect | undefined {
  // Two O(1) map reads, not a scan of the paragraph's edges per region.
  const byOffset = navigableEdgesForParagraph(pages, paragraphId);
  const fromEdge = byOffset.get(graphemeFrom);
  const toEdge = byOffset.get(graphemeTo);
  const left = fromEdge?.x;
  const right = toEdge?.x;
  // Preserves the previous precedence: geometry from the `from` edge when present,
  // otherwise from the `to` edge.
  const y = fromEdge?.y ?? toEdge?.y;
  const height = fromEdge?.height ?? toEdge?.height;
  if (left === undefined || right === undefined || y === undefined || height === undefined)
    return undefined;
  if (right <= left) return undefined;
  return { x: left, y, width: right - left, height };
}

function enrichOwnershipRegions(
  pages: readonly Page[],
  display: readonly DisplayPage[],
  semanticIndex: SemanticPositionIndex
): SemanticPositionIndex {
  const paragraphBounds = new Map<string, { pageIndex: number; box: Rect }>();

  for (const page of display) {
    page.items.forEach((item) => {
      if (item.kind !== 'text') return;
      const pid = item.semantic.identity.blockId;
      const prev = paragraphBounds.get(pid);
      const next = { pageIndex: page.index, box: item.box };
      paragraphBounds.set(
        pid,
        prev ? { pageIndex: page.index, box: unionRect(prev.box, item.box) } : next
      );
    });
  }

  const ownershipRegions = semanticIndex.ownershipRegions.map((region) => {
    const bounds = paragraphBounds.get(region.identity.blockId);
    if (region.kind === 'paragraph' || region.kind === 'trailing') {
      if (!bounds) return region;
      return { ...region, pageIndex: bounds.pageIndex, box: bounds.box };
    }
    if (region.kind === 'lineWhitespace') {
      if (region.graphemeFrom === undefined || region.graphemeTo === undefined) return region;
      const pageIndex = bounds?.pageIndex ?? 0;
      const box = whitespaceBoxFromCaretEdges(
        pages,
        region.identity.blockId,
        pageIndex,
        region.graphemeFrom,
        region.graphemeTo
      );
      if (!box) return region;
      return { ...region, pageIndex, box };
    }
    return region;
  });

  return { ...semanticIndex, ownershipRegions };
}

export interface DisplayBridgeResult {
  readonly display: DisplayPage[];
  readonly semanticIndex: SemanticPositionIndex;
  readonly navigationGeometry: NavigationGeometry;
}

/**
 * Block records by id, per semantic index.
 *
 * `stories[0].blocks.find(...)` ran once per painted text item, so publishing a
 * display list was O(items x blocks). On an ordinary 8,000-paragraph document that
 * is 64 million comparisons, and it was one of four independent quadratic terms
 * review measured in `toDisplayPages` (whole-bridge exponent 1.95). Keyed on the
 * index object, which is rebuilt per layout.
 */
const blocksByIdCache = new WeakMap<SemanticPositionIndex, Map<string, BlockSemanticRecord>>();

function blockRecordById(
  index: SemanticPositionIndex,
  blockId: string
): BlockSemanticRecord | undefined {
  let byId = blocksByIdCache.get(index);
  if (!byId) {
    byId = new Map();
    for (const story of index.stories) {
      for (const block of story.blocks) byId.set(block.identity.blockId, block);
    }
    blocksByIdCache.set(index, byId);
  }
  return byId.get(blockId);
}

/**
 * Reuse of already-built, already-frozen shaped clusters across layouts.
 *
 * Clusters are the bulk of a published frame: 105,664 of them on the 24-page styled
 * fixture, against 1,383 display items. They are rebuilt from scratch on every keystroke
 * and then walked again by the publication freeze, and together that is most of a 421 ms
 * keystroke — even though a one-character edit changes the geometry of at most a few lines.
 *
 * A cluster array is a pure function of the painted slice that produced it: the paragraph,
 * the slice's UTF-16 span, its box, and its text. Fingerprint those and an unchanged slice
 * returns the SAME frozen array it returned last time. That is worth twice over: the
 * clusters are not rebuilt, and `deepFreezeValue` short-circuits on the frozen array during
 * publication instead of descending into it.
 *
 * Fingerprinting is cheap because it is per ITEM, not per cluster — 1,383 short strings,
 * not 105,664 objects.
 *
 * TWO generations, rotated per layout, because a frame is published per keystroke and the
 * hit rate we care about is "same as the immediately preceding layout". Retaining more
 * would grow unboundedly for no additional hits; retaining one would miss every time,
 * because the current generation is empty when a layout begins.
 *
 * The cache is owned by the caller (one per editor) rather than module state, so two
 * editors cannot evict each other and a test that omits it simply gets no reuse.
 */
export class DisplayBridgeCache {
  private previous = new Map<string, readonly ShapedCluster[]>();
  private current = new Map<string, readonly ShapedCluster[]>();
  /** Reuse counters for the profiler; not load-bearing. */
  reused = 0;
  built = 0;

  /** Start a new layout generation. */
  rotate(): void {
    this.previous = this.current;
    this.current = new Map();
    this.otherPrevious = this.other;
    this.other = new Map();
    this.linesPrevious = this.lines;
    this.lines = new Map();
    this.evicted = 0;
    this.reused = 0;
    this.built = 0;
    this.linesReused = 0;
    this.linesBuilt = 0;
  }

  /**
   * Generic two-generation memo for any frozen, content-derived array.
   *
   * Used for the per-block horizontal-boundary tables, which walk every grapheme of every
   * paragraph on every layout to answer a question that depends only on the text and the
   * metrics — over the whole document that is another pass in the six figures.
   */
  private other = new Map<string, unknown>();
  private otherPrevious = new Map<string, unknown>();

  memo<T>(key: string, build: () => T, blockId?: string): T {
    if (blockId !== undefined) this.trackKey(blockId, key);
    const hit = (this.other.get(key) ?? this.otherPrevious.get(key)) as T | undefined;
    if (hit !== undefined) {
      this.other.set(key, hit);
      return hit;
    }
    const built = deepFreezeValue(build());
    this.other.set(key, built);
    return built;
  }

  /** Per-paragraph pre-order visual lines; see `buildVisualLines`. */
  private lines = new Map<string, readonly PreOrderVisualLine[]>();
  private linesPrevious = new Map<string, readonly PreOrderVisualLine[]>();
  linesReused = 0;
  linesBuilt = 0;

  linesFor(
    key: string,
    build: () => PreOrderVisualLine[],
    blockId?: string
  ): readonly PreOrderVisualLine[] {
    if (blockId !== undefined) this.trackKey(blockId, key);
    const hit = this.lines.get(key) ?? this.linesPrevious.get(key);
    if (hit) {
      this.linesReused += 1;
      this.lines.set(key, hit);
      return hit;
    }
    const built = build();
    this.linesBuilt += 1;
    this.lines.set(key, built);
    return built;
  }

  /**
   * Every cache key that belongs to a block, so a dirty id can evict it directly.
   *
   * Without this the only way a stale entry leaves is by aging out of the two generations,
   * which is correct for CHANGED blocks (their fingerprint differs, so they miss) but leaks
   * for DELETED ones: nothing ever asks for them again and they sit in the map until two
   * more layouts pass.
   */
  private keysByBlock = new Map<string, Set<string>>();

  private trackKey(blockId: string, key: string): void {
    const existing = this.keysByBlock.get(blockId);
    if (existing) existing.add(key);
    else this.keysByBlock.set(blockId, new Set([key]));
  }

  /**
   * Drop everything cached for these blocks.
   *
   * EVICTION ONLY, and that is the whole safety argument. A dirty-id list says which blocks
   * the user edited; it cannot say which blocks MOVED, because inserting a line reflows
   * every block below it while their ids stay clean. Fingerprints catch both, so they remain
   * the thing that decides reuse. Dirty ids are layered on top and may only take entries
   * AWAY — they can over-invalidate, costing a rebuild, and can never cause stale geometry
   * to be served.
   */
  invalidateBlocks(blockIds: Iterable<string>): void {
    for (const blockId of blockIds) {
      const keys = this.keysByBlock.get(blockId);
      if (!keys) continue;
      for (const key of keys) {
        this.current.delete(key);
        this.previous.delete(key);
        this.lines.delete(key);
        this.linesPrevious.delete(key);
        this.other.delete(key);
        this.otherPrevious.delete(key);
      }
      this.keysByBlock.delete(blockId);
      this.evicted += 1;
    }
  }

  /** Blocks evicted by id since the last rotate; reported by the profiler. */
  evicted = 0;

  clustersFor(
    key: string,
    build: () => ShapedCluster[],
    blockId?: string
  ): readonly ShapedCluster[] {
    if (blockId !== undefined) this.trackKey(blockId, key);
    const hit = this.current.get(key) ?? this.previous.get(key);
    if (hit) {
      this.reused += 1;
      // Promote so the next rotation keeps it reachable.
      this.current.set(key, hit);
      return hit;
    }
    // Frozen HERE, at construction, so publication's freeze walk stops at this array on
    // every later reuse.
    const built = deepFreezeValue(build());
    this.built += 1;
    this.current.set(key, built);
    return built;
  }
}

/**
 * Per-paragraph digest of everything OUTSIDE a painted slice that its clusters depend on.
 *
 * `clustersFromLayoutCaretEdges` does not read only the slice. It reads the paragraph's
 * whole caret-edge index — which offsets are `horizontalNavigable`, and the minimum x per
 * offset — and the paragraph's grapheme count, which becomes each cluster's `affinity`.
 * All of that can change while a painted slice stays byte-identical.
 *
 * Independent review reproduced the consequence: with a bold trailing space at a wrap, an
 * ordinary 30-character insertion elsewhere gave that slice one cluster from cache and zero
 * from a fresh build, because offset 61 gained an edge at the next line's left margin and
 * `edgeIndexFor` takes the minimum x, so `right <= left` and the cluster is correctly
 * dropped. A click at x=520.5 then resolved to grapheme 60 with the cache and 0 without —
 * the same click on the same document answered differently depending on edit history. A
 * 500-step differential diverged in 8 of 10 seeds.
 *
 * The digest is over the paragraph's PAINTED ITEMS, not its caret edges. A paragraph's
 * edges are emitted by the same layout walk that positions its slices, so identical text,
 * geometry and page across ALL of a paragraph's slices imply an identical edge index — the
 * same argument the visual-line cache rests on, which review validated over a 3,200-step
 * differential with zero divergence. Hashing the edges directly was tried first and costs
 * ~16 ms per layout over 106,000 of them, which is a sixth of the budget the cache exists
 * to save; this is O(items), so 1,383.
 */
/**
 * Stable per-instance id for a metrics port, so a memo can key on WHICH port answered.
 *
 * Ports have no identity of their own and the editor constructs a fresh `HelveticaMetrics`
 * per layout, so keying on the object alone would never hit. Identity is assigned lazily in
 * a WeakMap and reused for the lifetime of the port.
 */
const metricsIds = new WeakMap<object, number>();
let nextMetricsId = 1;

function metricsKey(metrics: MetricsPort): number {
  const existing = metricsIds.get(metrics as object);
  if (existing !== undefined) return existing;
  const id = nextMetricsId;
  nextMetricsId += 1;
  metricsIds.set(metrics as object, id);
  return id;
}

function paragraphPaintDigests(pages: readonly Page[]): Map<string, number> {
  const digests = new Map<string, number>();
  // Scaled before the xor: `hash ^ value` applies ToInt32, so 100.4 and 100.6 would hash
  // identically. Both shipped metrics ports return integer twips, so this is unreachable
  // today and becomes reachable the moment a shaping port with fractional advances lands —
  // silently, which is the reason to close it now rather than when it bites.
  const mix = (hash: number, value: number) => Math.imul(hash ^ Math.round(value * 64), 0x01000193);
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'text') continue;
      let hash = digests.get(item.anchor.paragraphId) ?? 0x811c9dc5;
      hash = mix(hash, page.index);
      hash = mix(hash, item.x);
      hash = mix(hash, item.y);
      hash = mix(hash, item.width);
      hash = mix(hash, item.height);
      hash = mix(hash, item.anchor.offset);
      hash = mix(hash, item.text.length);
      for (let i = 0; i < item.text.length; i += 1) hash = mix(hash, item.text.charCodeAt(i));
      digests.set(item.anchor.paragraphId, hash | 0);
    }
  }
  return digests;
}

/** Identity of a painted slice for cluster reuse: everything its clusters depend on. */
function clusterCacheKey(
  paragraphId: string,
  it: TextItem,
  box: Rect,
  paragraphGraphemeCount: number,
  edgeDigest: number
): string {
  return (
    // `clustersFromLayoutCaretEdges` calls `segmentGraphemes`, so a boundary swap changes
    // cluster spans. The sibling horizontal-boundary memo already keys on this; review
    // found the asymmetry and reproduced it — 'abéc 👍' served merged graphemes from cache
    // after `setGraphemeBoundary(perCodeUnit)`, so a click resolved to the wrong offset.
    String(graphemeBoundaryEpoch()) +
    '\u001F' +
    paragraphId +
    '\u001F' +
    String(it.anchor.offset) +
    '\u001F' +
    String(box.x) +
    '\u001F' +
    String(box.y) +
    '\u001F' +
    String(box.width) +
    '\u001F' +
    String(box.height) +
    '\u001F' +
    // Becomes every cluster's `affinity`, and changes when text elsewhere in the paragraph
    // does even though this slice is untouched.
    String(paragraphGraphemeCount) +
    '\u001F' +
    String(edgeDigest) +
    '\u001F' +
    it.text
  );
}

function textItem(
  model: PackageModel,
  storyId: string,
  semanticIndex: SemanticPositionIndex,
  pages: readonly Page[],
  it: TextItem,
  pageIndex: number,
  zOrder: number,
  cache?: DisplayBridgeCache,
  edgeDigest = 0
): ContractItem {
  const box = boxOf(it);
  const run: GlyphRun = {
    text: it.text,
    box,
    fontFamily: 'Helvetica',
    fontSizePx: px(it.height) * 0.9,
    color: BLACK,
    bold: it.bold,
    italic: it.italic,
  };
  const fullText = paragraphTextById(model, it.anchor.paragraphId);
  const utf16From = it.anchor.offset;
  const utf16To = utf16From + it.text.length;
  const paragraphGraphemeCount = paragraphGraphemeCountById(model, it.anchor.paragraphId);
  const semantic = semanticTextSpan(
    storyId,
    BODY,
    it.anchor.paragraphId,
    fullText,
    utf16From,
    utf16To
  );
  const buildClusters = () =>
    clustersFromLayoutCaretEdges(
      pages,
      it.anchor.paragraphId,
      semantic,
      box,
      it.text,
      paragraphGraphemeCount
    );
  const clusters = cache
    ? cache.clustersFor(
        clusterCacheKey(it.anchor.paragraphId, it, box, paragraphGraphemeCount, edgeDigest),
        buildClusters,
        it.anchor.paragraphId
      )
    : buildClusters();
  const legacy = deprecatedFlatDocOffset(semanticIndex, it.anchor.paragraphId, utf16From, utf16To);
  const block = blockRecordById(semanticIndex, it.anchor.paragraphId);
  const role = block?.readOnly ? 'selectableText' : 'editableText';
  return {
    kind: 'text',
    box,
    runs: it.text.length > 0 ? [run] : [],
    semantic,
    clusters,
    scope: BODY,
    docFrom: legacy.docFrom,
    docTo: legacy.docTo,
    blockId: legacy.blockId,
    interaction: interactionMeta(pageIndex, zOrder, role),
  };
}

function borderSegments(box: Rect): BorderSeg[] {
  const { x, y, width: w, height: h } = box;
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }): BorderSeg => ({
    from,
    to,
    widthPx: 1,
    color: BLACK,
    style: 'single',
  });
  return [
    edge({ x, y }, { x: x + w, y }),
    edge({ x: x + w, y }, { x: x + w, y: y + h }),
    edge({ x, y: y + h }, { x: x + w, y: y + h }),
    edge({ x, y }, { x, y: y + h }),
  ];
}

function rectItems(it: RectItem): ContractItem[] {
  const box = boxOf(it);
  const out: ContractItem[] = [];
  if (it.fill) out.push({ kind: 'fill', box, color: { kind: 'hex', value: it.fill } });
  if (it.stroke) out.push({ kind: 'tableBorder', segments: borderSegments(box) });
  return out;
}

/** Map engine-layout pages to contract display + model-derived semantic index. */
/**
 * Blocks a `ModelChange` reported as created, changed or deleted since the last publication.
 *
 * Consumed for EVICTION only — see `DisplayBridgeCache.invalidateBlocks` for why that is the
 * safe direction. Optional: omitting it leaves reuse entirely to fingerprints, which is what
 * every caller did before and is still correct, just slower to release deleted blocks.
 */
export interface BridgeInvalidation {
  readonly created?: readonly string[];
  readonly changed?: readonly string[];
  readonly deleted?: readonly string[];
}

export function toDisplayPages(
  model: PackageModel,
  pages: readonly Page[],
  metrics: MetricsPort = new HelveticaMetrics(),
  cache?: DisplayBridgeCache,
  invalidation?: BridgeInvalidation
): DisplayBridgeResult {
  cache?.rotate();
  if (cache && invalidation) {
    cache.invalidateBlocks([
      ...(invalidation.created ?? []),
      ...(invalidation.changed ?? []),
      ...(invalidation.deleted ?? []),
    ]);
  }
  const edgeDigests = cache ? paragraphPaintDigests(pages) : new Map<string, number>();
  const semanticIndex = buildSemanticIndex(model, BODY);
  const storyId = semanticIndex.stories[0]!.storyId;

  const display = pages.map((page) => ({
    index: page.index,
    box: { x: 0, y: 0, width: px(page.width), height: px(page.height) },
    contentBox: {
      x: px(page.contentBox.x),
      y: px(page.contentBox.y),
      width: px(page.contentBox.width),
      height: px(page.contentBox.height),
    },
    items: page.items.flatMap((it, zOrder) => {
      switch (it.type) {
        case 'text':
          return [
            textItem(
              model,
              storyId,
              semanticIndex,
              pages,
              it,
              page.index,
              zOrder,
              cache,
              edgeDigests.get(it.anchor.paragraphId) ?? 0
            ),
          ];
        case 'caretEdge':
          return [];
        case 'rect':
          return rectItems(it).map((item, rectZ) => ({
            ...item,
            interaction: interactionMeta(page.index, zOrder + rectZ, 'background', {
              pointerTransparent: true,
            }),
          }));
      }
    }),
  }));

  const enrichedIndex = enrichOwnershipRegions(pages, display, semanticIndex);
  const { metaBySliceKey, conflicts } = collectFragmentMetaFromLayout(pages, (paragraphId) => {
    const block = blockRecordById(enrichedIndex, paragraphId);
    return block?.readOnly ? 'selectableText' : 'editableText';
  });
  const semanticHorizontalBoundariesByBlockId: Record<string, readonly number[]> = {};
  for (const block of enrichedIndex.stories[0]?.blocks ?? []) {
    if (block.readOnly) continue;
    const text = paragraphTextById(model, block.identity.blockId, storyId);
    // Depends on the text, the METRICS PORT and the installed GRAPHEME BOUNDARY.
    //
    // `prefixProvableUpTo` puts both of those in its own key and carries a comment
    // recording that review previously caught a stale answer from omitting them; this memo
    // keyed on block id and text alone, and review reproduced the same class of staleness
    // here — warm the cache, swap to a per-code-unit boundary, and `'abéc 👍'` kept the
    // grouping boundary's 7 offsets where a cold build gives 8. Every hit promotes into the
    // current generation, so it never self-heals.
    const build = () => semanticHorizontalBoundaries(metrics, text);
    semanticHorizontalBoundariesByBlockId[block.identity.blockId] = cache
      ? cache.memo(
          'hb\u001F' +
            String(metricsKey(metrics)) +
            '\u001F' +
            String(graphemeBoundaryEpoch()) +
            '\u001F' +
            block.identity.blockId +
            '\u001F' +
            text,
          build,
          block.identity.blockId
        )
      : build();
  }
  const visualLines = buildVisualLines(
    pages,
    enrichedIndex,
    model,
    metaBySliceKey,
    conflicts,
    cache
  );
  const traversalByBlockId = recordFromTraversalMap(buildTraversalLinksForModel(model));
  const navigationGeometry = freezeNavigationGeometry({
    visualLines,
    traversalByBlockId,
    shapingSupported: layoutShapingSupported(pages) && conflicts.length === 0,
    semanticHorizontalBoundariesByBlockId,
    paintFragmentConflicts: conflicts,
  });
  return { display, semanticIndex: enrichedIndex, navigationGeometry };
}

// ─── Overlay geometry for adapters (interactive-paginated-editing M2.2) ──────
//
// Caret and selection rectangles arrive from the interaction frame in stacked
// content coordinates. Adapters paint them inside a page box, so the one thing
// that must not be reinvented per framework is the conversion into page-local
// space. React and Vue both call `overlaysForFrame` and map the result to
// elements; neither computes a rectangle.
//
// Zoom deliberately does not appear here. The host scales the whole page stack
// with a CSS transform and reports that same zoom to the engine through
// InteractionHostMetrics, so an overlay painted inside a page inherits the
// scale and hit testing still agrees with paint. Baking zoom into these boxes
// would apply it twice.

/** One paintable overlay rectangle in page-local coordinates. */
export interface OverlayBox {
  readonly pageIndex: number;
  readonly rect: Rect;
  /** Page-local clip rect, when the source geometry was clipped. */
  readonly clip?: Rect;
  readonly transform?: AffineTransform;
  readonly writingDirection?: 'ltr' | 'rtl';
}

export interface FrameOverlays {
  readonly caret: OverlayBox | null;
  readonly selection: readonly OverlayBox[];
}

function toPageLocalRect(frame: InteractionFrame, pageIndex: number, rect: Rect): Rect | null {
  const page = frame.pageGeometry.find((candidate) => candidate.index === pageIndex);
  if (!page) return null;
  return { x: rect.x - page.box.x, y: rect.y - page.box.y, width: rect.width, height: rect.height };
}

/**
 * Page-local caret and selection overlay boxes for the current frame. Returns
 * empty geometry rather than guessing when the frame carries no selection.
 */
export function overlaysForFrame(frame: InteractionFrame): FrameOverlays {
  // An unfocused editor shows no caret. Word does not blink a caret at a
  // document nobody is editing, and painting one at mount made the two adapters
  // disagree on their initial state: whichever synced its overlays first showed
  // a caret the other did not.
  const caretGeometry = frame.focus.focused ? frame.caret : null;
  let caret: OverlayBox | null = null;
  if (caretGeometry) {
    const rect = toPageLocalRect(frame, caretGeometry.pageIndex, caretGeometry.rect);
    if (rect) {
      const clip = caretGeometry.clip
        ? (toPageLocalRect(frame, caretGeometry.pageIndex, caretGeometry.clip) ?? undefined)
        : undefined;
      caret = {
        pageIndex: caretGeometry.pageIndex,
        rect,
        ...(clip ? { clip } : {}),
        ...(caretGeometry.transform ? { transform: caretGeometry.transform } : {}),
        writingDirection: caretGeometry.writingDirection,
      };
    }
  }

  const selection: OverlayBox[] = [];
  const geometry = frame.selectionGeometry;
  // A collapsed selection still derives cluster-width rects — they exist so
  // callers can locate the caret's cluster. Painting them would draw a
  // highlighted character behind every plain caret, so the overlay takes the
  // caret and drops the rects.
  if (geometry && !geometry.collapsed) {
    // rects[i] and pageIndices[i] are pushed in lockstep by the geometry
    // derivation, so a rect is only paintable when it still has its page.
    const local: OverlayBox[] = [];
    geometry.rects.forEach((rect, index) => {
      const pageIndex = geometry.pageIndices[index];
      if (pageIndex === undefined) return;
      const pageLocal = toPageLocalRect(frame, pageIndex, rect);
      if (!pageLocal) return;
      local.push({ pageIndex, rect: pageLocal });
    });
    selection.push(...mergeSelectionRunsPerLine(local));
  }

  return { caret, selection };
}

/**
 * Coalesce selection rectangles into one run per visual line (task M6S.1).
 *
 * The engine derives one rectangle per painted RUN, and the painter emits one
 * absolutely positioned box per run with no line box between them. A selection therefore
 * showed a visible hole wherever whitespace fell on a run boundary — the defect an owner
 * reported with screenshots, where "Arial | Times New Roman | Courier New" highlighted as
 * separate islands with gaps at the separators.
 *
 * The per-run rectangles are individually CORRECT; what was missing is that a reader
 * perceives a selection as continuous along a line. Merging adjacent rectangles that
 * share a line closes the gaps without touching semantic authority: ProseMirror still
 * owns the selection, the engine still owns geometry, and nothing about copy, focus, IME,
 * or accessibility changes — this is presentation only.
 *
 * Same line means same page and vertically overlapping, compared with a tolerance rather
 * than by equality: runs of different font sizes on one line have different heights and
 * tops, so `top === top` would refuse to merge exactly the mixed-formatting lines that
 * show the worst gaps. Merged rectangles take the union, so a taller run keeps its height.
 *
 * Rectangles are NOT merged across a gap wider than a space: a genuine gap — a tab, a
 * right-aligned tail, an empty table cell — is real and must stay visible, or the
 * selection would claim to cover content it does not.
 */
function mergeSelectionRunsPerLine(boxes: readonly OverlayBox[]): OverlayBox[] {
  if (boxes.length < 2) return [...boxes];

  const sorted = [...boxes].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    if (Math.abs(a.rect.y - b.rect.y) > 1) return a.rect.y - b.rect.y;
    return a.rect.x - b.rect.x;
  });

  const out: OverlayBox[] = [];
  for (const box of sorted) {
    const previous = out[out.length - 1];
    if (previous && canMergeOnLine(previous, box)) {
      out[out.length - 1] = unionOnLine(previous, box);
      continue;
    }
    out.push(box);
  }
  return out;
}

/** Whether two rectangles sit on the same visual line and are adjacent enough to join. */
function canMergeOnLine(a: OverlayBox, b: OverlayBox): boolean {
  if (a.pageIndex !== b.pageIndex) return false;
  // A transformed or clipped rect has geometry the union would misrepresent.
  if (a.transform || b.transform || a.clip || b.clip) return false;
  // Vertical overlap, not equal tops: mixed font sizes on one line differ in both.
  const aBottom = a.rect.y + a.rect.height;
  const bBottom = b.rect.y + b.rect.height;
  const overlap = Math.min(aBottom, bBottom) - Math.max(a.rect.y, b.rect.y);
  if (overlap <= Math.min(a.rect.height, b.rect.height) * 0.5) return false;
  // Adjacent, or separated by no more than a wide space. A real gap stays a gap.
  const gap = b.rect.x - (a.rect.x + a.rect.width);
  return gap <= Math.max(a.rect.height, b.rect.height) * 0.6;
}

function unionOnLine(a: OverlayBox, b: OverlayBox): OverlayBox {
  const left = Math.min(a.rect.x, b.rect.x);
  const top = Math.min(a.rect.y, b.rect.y);
  const right = Math.max(a.rect.x + a.rect.width, b.rect.x + b.rect.width);
  const bottom = Math.max(a.rect.y + a.rect.height, b.rect.y + b.rect.height);
  return {
    pageIndex: a.pageIndex,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    ...(a.writingDirection ? { writingDirection: a.writingDirection } : {}),
  };
}

/** An engine affine transform as a CSS `matrix(...)`, in CSS argument order. */
export function cssMatrix(transform: AffineTransform): string {
  const { a, b, c, d, tx, ty } = transform;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`;
}

// ─── Deterministic click target (interactive-paginated-editing M2.3) ─────────
//
// Browser gates must click a real glyph, never a coordinate someone measured
// once and pasted into a spec. A click on whitespace or a margin is a valid
// no-op in the 5.6a subset, so a test that aims at one proves nothing. This
// picks the first editable body glyph that actually has ink, and the adapters
// stamp `data-testid="one-surface-click-target"` on exactly that element.

/** Public test-target identity for the first editable body glyph. */
export const ONE_SURFACE_CLICK_TARGET = 'one-surface-click-target' as const;

export interface GlyphClickTarget {
  readonly pageIndex: number;
  /** Index into `DisplayPage.items`, matching the adapter's paint order. */
  readonly itemIndex: number;
  /** Index into the text item's `runs`, matching the adapter's paint order. */
  readonly runIndex: number;
  /** Page-local box of the run. */
  readonly box: Rect;
  /** Page-local center of the run — the point a gate should click. */
  readonly center: { readonly x: number; readonly y: number };
}

/**
 * Locate the first editable body glyph carrying non-whitespace text. Returns
 * null for an empty or wholly read-only document rather than inventing a target.
 */
export function firstEditableGlyphTarget(frame: InteractionFrame): GlyphClickTarget | null {
  const readOnlyBlocks = new Set<string>();
  for (const story of frame.semanticIndex.stories) {
    for (const block of story.blocks) {
      if (block.readOnly) readOnlyBlocks.add(block.identity.blockId);
    }
  }

  for (const page of [...frame.display].sort((a, b) => a.index - b.index)) {
    for (let itemIndex = 0; itemIndex < page.items.length; itemIndex += 1) {
      const item = page.items[itemIndex]!;
      if (item.kind !== 'text') continue;
      if (readOnlyBlocks.has(item.semantic.identity.blockId)) continue;
      for (let runIndex = 0; runIndex < item.runs.length; runIndex += 1) {
        const run = item.runs[runIndex]!;
        if (run.text.trim().length === 0) continue;
        if (run.box.width <= 0 || run.box.height <= 0) continue;
        return {
          pageIndex: page.index,
          itemIndex,
          runIndex,
          box: run.box,
          center: { x: run.box.x + run.box.width / 2, y: run.box.y + run.box.height / 2 },
        };
      }
    }
  }
  return null;
}

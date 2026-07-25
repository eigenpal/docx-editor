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
} from '@docx-editor.dev/core-contract/interaction';
import type { ColorValue, Rect, ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { PositionedInteractionMeta } from '@docx-editor.dev/core-contract/interaction';
import type { PackageModel } from '@docx-editor.dev/engine-core';
import type { Page, TextItem, RectItem } from '@docx-editor.dev/engine-layout';
import { HelveticaMetrics, semanticHorizontalBoundaries, type MetricsPort } from '@docx-editor.dev/engine-layout';
import {
  buildSemanticIndex,
  buildTraversalLinksForModel,
  deprecatedFlatDocOffset,
  paragraphGraphemeCountById,
  paragraphTextById,
  semanticTextSpan,
  twipsToPx,
} from './semantic-index.ts';
import { clustersFromLayoutCaretEdges } from './layout-clusters.ts';
import { buildVisualLines, collectFragmentMetaFromLayout, layoutShapingSupported } from './visual-lines.ts';
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
  extra: Partial<PositionedInteractionMeta> = {},
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
const edgesByParagraphCache = new WeakMap<readonly Page[], Map<string, Map<number, EdgeGeometry>>>();

function navigableEdgesForParagraph(pages: readonly Page[], paragraphId: string): Map<number, EdgeGeometry> {
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
        byOffset.set(item.graphemeOffset, { x: px(item.x), y: px(item.y), height: px(item.height) });
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
  graphemeTo: number,
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
  if (left === undefined || right === undefined || y === undefined || height === undefined) return undefined;
  if (right <= left) return undefined;
  return { x: left, y, width: right - left, height };
}

function enrichOwnershipRegions(
  pages: readonly Page[],
  display: readonly DisplayPage[],
  semanticIndex: SemanticPositionIndex,
): SemanticPositionIndex {
  const paragraphBounds = new Map<string, { pageIndex: number; box: Rect }>();

  for (const page of display) {
    page.items.forEach((item) => {
      if (item.kind !== 'text') return;
      const pid = item.semantic.identity.blockId;
      const prev = paragraphBounds.get(pid);
      const next = { pageIndex: page.index, box: item.box };
      paragraphBounds.set(pid, prev ? { pageIndex: page.index, box: unionRect(prev.box, item.box) } : next);
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
        region.graphemeTo,
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

function blockRecordById(index: SemanticPositionIndex, blockId: string): BlockSemanticRecord | undefined {
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

function textItem(
  model: PackageModel,
  storyId: string,
  semanticIndex: SemanticPositionIndex,
  pages: readonly Page[],
  it: TextItem,
  pageIndex: number,
  zOrder: number,
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
  const semantic = semanticTextSpan(storyId, BODY, it.anchor.paragraphId, fullText, utf16From, utf16To);
  const clusters = clustersFromLayoutCaretEdges(
    pages,
    it.anchor.paragraphId,
    semantic,
    box,
    it.text,
    paragraphGraphemeCount,
  );
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
export function toDisplayPages(
  model: PackageModel,
  pages: readonly Page[],
  metrics: MetricsPort = new HelveticaMetrics(),
): DisplayBridgeResult {
  const semanticIndex = buildSemanticIndex(model, BODY);
  const storyId = semanticIndex.stories[0]!.storyId;

  const display = pages.map((page) => ({
    index: page.index,
    box: { x: 0, y: 0, width: px(page.width), height: px(page.height) },
    items: page.items.flatMap((it, zOrder) => {
      switch (it.type) {
        case 'text':
          return [textItem(model, storyId, semanticIndex, pages, it, page.index, zOrder)];
        case 'caretEdge':
          return [];
        case 'rect':
          return rectItems(it).map((item, rectZ) => ({
            ...item,
            interaction: interactionMeta(page.index, zOrder + rectZ, 'background', { pointerTransparent: true }),
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
    semanticHorizontalBoundariesByBlockId[block.identity.blockId] = semanticHorizontalBoundaries(metrics, text);
  }
  const visualLines = buildVisualLines(pages, enrichedIndex, model, metaBySliceKey, conflicts);
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
        ? toPageLocalRect(frame, caretGeometry.pageIndex, caretGeometry.clip) ?? undefined
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
    geometry.rects.forEach((rect, index) => {
      const pageIndex = geometry.pageIndices[index];
      if (pageIndex === undefined) return;
      const local = toPageLocalRect(frame, pageIndex, rect);
      if (!local) return;
      selection.push({ pageIndex, rect: local });
    });
  }

  return { caret, selection };
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

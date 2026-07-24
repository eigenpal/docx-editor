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

function whitespaceBoxFromCaretEdges(
  pages: readonly Page[],
  paragraphId: string,
  pageIndex: number,
  graphemeFrom: number,
  graphemeTo: number,
): Rect | undefined {
  let left: number | undefined;
  let right: number | undefined;
  let y: number | undefined;
  let height: number | undefined;
  for (const page of pages) {
    if (page.index !== pageIndex) continue;
    for (const item of page.items) {
      if (item.type !== 'caretEdge' || item.paragraphId !== paragraphId || !item.navigable) continue;
      if (item.graphemeOffset === graphemeFrom) {
        left = px(item.x);
        y = px(item.y);
        height = px(item.height);
      }
      if (item.graphemeOffset === graphemeTo) {
        right = px(item.x);
        y ??= px(item.y);
        height ??= px(item.height);
      }
    }
  }
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
  const block = semanticIndex.stories[0]?.blocks.find((b) => b.identity.blockId === it.anchor.paragraphId);
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
    const block = enrichedIndex.stories[0]?.blocks.find((b) => b.identity.blockId === paragraphId);
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
  const caretGeometry = frame.caret;
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
  if (geometry) {
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

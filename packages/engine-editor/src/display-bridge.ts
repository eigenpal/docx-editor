// The display bridge reconciles the engine layout IR with the contract display IR using
// model-derived semantic indexing (interactive-paginated-editing 3.2–3.4).

import type {
  DisplayPage,
  DisplayItem as ContractItem,
  GlyphRun,
  BorderSeg,
} from '@docx-editor.dev/core-contract/geometry';
import type { OwnershipRegion, SemanticPositionIndex } from '@docx-editor.dev/core-contract/interaction';
import type { ColorValue, Rect, ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { PositionedInteractionMeta } from '@docx-editor.dev/core-contract/interaction';
import type { PackageModel } from '@docx-editor.dev/engine-core';
import type { Page, TextItem, RectItem } from '@docx-editor.dev/engine-layout';
import {
  buildSemanticIndex,
  deprecatedFlatDocOffset,
  paragraphGraphemeCountById,
  paragraphTextById,
  semanticTextSpan,
  shapedClustersForSlice,
  twipsToPx,
} from './semantic-index.ts';

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

type BridgedTextItem = Extract<ContractItem, { kind: 'text' }>;

function sliceStartX(item: BridgedTextItem): number {
  return item.clusters.length > 0 ? item.clusters[0]!.box.x : item.box.x;
}

function sliceEndX(item: BridgedTextItem): number {
  if (item.clusters.length === 0) return item.box.x + item.box.width;
  const last = item.clusters[item.clusters.length - 1]!;
  return last.box.x + last.box.width;
}

function sameLine(a: Rect, b: Rect): boolean {
  return Math.abs(a.y - b.y) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function utf16WidthPerUnit(item: BridgedTextItem): number | null {
  const span = item.semantic.utf16To - item.semantic.utf16From;
  if (span <= 0) return null;
  return item.box.width / span;
}

function adjacentSliceUsesTransform(...items: readonly (BridgedTextItem | undefined)[]): boolean {
  return items.some((item) => item?.interaction?.transform !== undefined);
}

/** Derive a precise lineWhitespace hit box from adjacent painted text slices; omit when not exact. */
export function deriveLineWhitespaceBox(
  region: OwnershipRegion,
  textItems: readonly BridgedTextItem[],
  paragraphUtf16Length: number,
): Rect | undefined {
  if (region.kind !== 'lineWhitespace') return undefined;
  if (region.utf16From === undefined || region.utf16To === undefined) return undefined;
  if (region.graphemeFrom === undefined || region.graphemeTo === undefined) return undefined;
  if (region.utf16From >= region.utf16To) return undefined;

  const utf16From = region.utf16From;
  const utf16To = region.utf16To;
  const utf16Len = utf16To - utf16From;
  const sorted = [...textItems].sort((a, b) => a.semantic.utf16From - b.semantic.utf16From);
  const prev = sorted.filter((item) => item.semantic.utf16To <= utf16From).at(-1);
  const next = sorted.find((item) => item.semantic.utf16From >= utf16To);

  // Transform-aware gap geometry is out of scope for task 5.3; fail closed rather than emit page-space boxes.
  if (adjacentSliceUsesTransform(prev, next)) return undefined;

  if (prev && next && sameLine(prev.box, next.box)) {
    const startX = sliceEndX(prev);
    const endX = sliceStartX(next);
    if (endX <= startX) return undefined;
    return { x: startX, y: prev.box.y, width: endX - startX, height: prev.box.height };
  }

  if (!prev && next) {
    const unit = utf16WidthPerUnit(next);
    if (unit === null) return undefined;
    const width = unit * utf16Len;
    const endX = sliceStartX(next);
    if (width <= 0) return undefined;
    return { x: endX - width, y: next.box.y, width, height: next.box.height };
  }

  if (prev && !next) {
    const unit = utf16WidthPerUnit(prev);
    if (unit === null) return undefined;
    const width = unit * utf16Len;
    const startX = sliceEndX(prev);
    if (width <= 0) return undefined;
    return { x: startX, y: prev.box.y, width, height: prev.box.height };
  }

  if (sorted.length === 1 && sorted[0]!.clusters.length === 0 && paragraphUtf16Length > 0) {
    const line = sorted[0]!;
    const width = (line.box.width / paragraphUtf16Length) * utf16Len;
    const startX = line.box.x + (line.box.width / paragraphUtf16Length) * utf16From;
    if (width <= 0) return undefined;
    return { x: startX, y: line.box.y, width, height: line.box.height };
  }

  return undefined;
}

function enrichOwnershipRegions(
  display: readonly DisplayPage[],
  semanticIndex: SemanticPositionIndex,
): SemanticPositionIndex {
  const paragraphBounds = new Map<string, { pageIndex: number; box: Rect }>();
  const textByParagraphPage = new Map<string, BridgedTextItem[]>();

  for (const page of display) {
    page.items.forEach((item, zOrder) => {
      if (item.kind !== 'text') return;
      const pid = item.semantic.identity.blockId;
      const prev = paragraphBounds.get(pid);
      const next = { pageIndex: page.index, box: item.box };
      paragraphBounds.set(pid, prev ? { pageIndex: page.index, box: unionRect(prev.box, item.box) } : next);
      const key = `${pid}:${page.index}`;
      const list = textByParagraphPage.get(key) ?? [];
      list.push(item);
      textByParagraphPage.set(key, list);
      void zOrder;
    });
  }

  const blockUtf16 = new Map<string, number>();
  for (const block of semanticIndex.stories.flatMap((s) => s.blocks)) {
    blockUtf16.set(block.identity.blockId, block.utf16Length);
  }

  const ownershipRegions = semanticIndex.ownershipRegions.map((region) => {
    const bounds = paragraphBounds.get(region.identity.blockId);
    if (region.kind === 'paragraph' || region.kind === 'trailing') {
      if (!bounds) return region;
      return { ...region, pageIndex: bounds.pageIndex, box: bounds.box };
    }
    if (region.kind === 'lineWhitespace') {
      const pageIndex = bounds?.pageIndex ?? 0;
      const items = textByParagraphPage.get(`${region.identity.blockId}:${pageIndex}`) ?? [];
      const box = deriveLineWhitespaceBox(region, items, blockUtf16.get(region.identity.blockId) ?? 0);
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
}

function textItem(
  model: PackageModel,
  storyId: string,
  semanticIndex: SemanticPositionIndex,
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
  const clusters = shapedClustersForSlice(semantic, box, it.text, paragraphGraphemeCount);
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
export function toDisplayPages(model: PackageModel, pages: readonly Page[]): DisplayBridgeResult {
  const semanticIndex = buildSemanticIndex(model, BODY);
  const storyId = semanticIndex.stories[0]!.storyId;

  const display = pages.map((page) => ({
    index: page.index,
    box: { x: 0, y: 0, width: px(page.width), height: px(page.height) },
    items: page.items.flatMap((it, zOrder) => {
      switch (it.type) {
        case 'text':
          return [textItem(model, storyId, semanticIndex, it, page.index, zOrder)];
        case 'rect':
          return rectItems(it).map((item, rectZ) => ({
            ...item,
            interaction: interactionMeta(page.index, zOrder + rectZ, 'background', { pointerTransparent: true }),
          }));
      }
    }),
  }));

  const enrichedIndex = enrichOwnershipRegions(display, semanticIndex);
  return { display, semanticIndex: enrichedIndex };
}

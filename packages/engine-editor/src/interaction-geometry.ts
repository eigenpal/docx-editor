// Frame-bound hit testing, caret, and selection geometry (interactive-paginated-editing 3.5–3.8).

import type { DisplayItem } from '@docx-editor.dev/core-contract/geometry';
import type {
  CaretGeometry,
  InteractionFrame,
  InteractionFrameId,
  InteractionHostMetrics,
  InteractionOutcome,
  InteractionRole,
  OwnershipRegion,
  PositionedInteractionMeta,
  SelectionGeometry,
  SelectionGeometryOptions,
  SemanticHitTarget,
  SemanticSelection,
  SemanticTarget,
  ShapedCluster,
} from '@docx-editor.dev/core-contract/interaction';
import type { Point, Rect } from '@docx-editor.dev/core-contract/types';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { caretAffinity } from './semantic-index.ts';
import {
  applyInverseAffine,
  clientToContent,
  clipStackedRect,
  contentToPageLocal,
  intersectRects,
  pointInRect,
  stackedContentRect,
  validateFrameIdentity,
  validateHostMetrics,
} from './coordinate-mapper.ts';

const HORIZONTAL_WRITING_MODE: PositionedInteractionMeta['writingMode'] = 'horizontal-tb';

interface HitCandidate {
  readonly zOrder: number;
  readonly box: Rect;
  readonly clip?: Rect;
  readonly transform?: PositionedInteractionMeta['transform'];
  readonly writingMode?: PositionedInteractionMeta['writingMode'];
  readonly pointerTransparent?: boolean;
  readonly synthetic?: boolean;
  readonly resolveAt: (local: Point) => SemanticTarget | null;
}

function reject<T>(
  code: 'staleFrame' | 'pendingLayout' | 'readOnly' | 'invalidTarget' | 'unsupported',
  reason: string,
  frameId?: InteractionFrameId,
): InteractionOutcome<T> {
  return frameId ? { ok: false, code, reason, frameId } : { ok: false, code, reason };
}

function okValue<T>(value: T, frameId: InteractionFrameId): InteractionOutcome<T> {
  return { ok: true, value, frameId };
}

function unsupportedWritingMode(mode: PositionedInteractionMeta['writingMode'] | undefined): boolean {
  return mode !== undefined && mode !== HORIZONTAL_WRITING_MODE;
}

function blockRecord(frame: InteractionFrame, blockId: string) {
  for (const story of frame.semanticIndex.stories) {
    const block = story.blocks.find((b) => b.identity.blockId === blockId);
    if (block) return block;
  }
  return undefined;
}

function roleForTarget(frame: InteractionFrame, target: SemanticTarget): InteractionRole {
  const stop = frame.semanticIndex.caretStops.find((s) => {
    if (s.target.kind !== target.kind) return false;
    if (target.kind === 'atomic' && s.target.kind === 'atomic') return s.target.objectId === target.objectId;
    if (s.target.kind !== 'text' || target.kind !== 'text') return false;
    return (
      s.target.identity.blockId === target.identity.blockId &&
      s.target.graphemeOffset === target.graphemeOffset &&
      s.target.affinity === target.affinity
    );
  });
  if (stop) return stop.role;
  if (target.kind === 'atomic') return 'atomicObject';
  const block = blockRecord(frame, target.identity.blockId);
  if (block?.readOnly) return 'selectableText';
  return 'editableText';
}

function localPointInItem(
  local: Point,
  box: Rect,
  clip: Rect | undefined,
  transform: PositionedInteractionMeta['transform'],
): Point | 'singular' | null {
  const relative = { x: local.x - box.x, y: local.y - box.y };
  let test = relative;
  if (transform) {
    const inverse = applyInverseAffine(transform, relative);
    if (!inverse) return 'singular';
    test = inverse;
  }
  if (!pointInRect(test, { x: 0, y: 0, width: box.width, height: box.height })) return null;
  if (clip) {
    const clipRelative = { x: clip.x - box.x, y: clip.y - box.y, width: clip.width, height: clip.height };
    if (!pointInRect(test, clipRelative)) return null;
  }
  return { x: test.x + box.x, y: test.y + box.y };
}

function nearestClusterEdge(
  local: Point,
  clusters: readonly ShapedCluster[],
  paragraphGraphemeCount: number,
): Pick<Extract<SemanticTarget, { kind: 'text' }>, 'graphemeOffset' | 'affinity'> {
  if (clusters.length === 0) {
    return { graphemeOffset: 0, affinity: caretAffinity(0, paragraphGraphemeCount) };
  }
  let bestDist = Number.POSITIVE_INFINITY;
  let bestOffset = clusters[0]!.graphemeFrom;
  let bestAffinity = clusters[0]!.affinity;
  for (const cluster of clusters) {
    const edges = [
      { offset: cluster.graphemeFrom, x: cluster.box.x, affinity: cluster.affinity },
      {
        offset: cluster.graphemeTo,
        x: cluster.box.x + cluster.box.width,
        affinity: caretAffinity(cluster.graphemeTo, paragraphGraphemeCount),
      },
    ];
    for (const edge of edges) {
      const dist = Math.abs(local.x - edge.x) + Math.abs(local.y - (cluster.box.y + cluster.box.height / 2)) * 0.01;
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        bestOffset = edge.offset;
        bestAffinity = edge.affinity;
      } else if (Math.abs(dist - bestDist) <= 1e-9) {
        const preferEdge =
          (edge.affinity === 'downstream' && bestAffinity !== 'downstream') ||
          (edge.affinity === bestAffinity && edge.offset > bestOffset);
        if (preferEdge) {
          bestOffset = edge.offset;
          bestAffinity = edge.affinity;
        }
      }
    }
  }
  return { graphemeOffset: bestOffset, affinity: bestAffinity };
}

function textTargetFromItem(
  item: Extract<DisplayItem, { kind: 'text' }>,
  local: Point,
  frame: InteractionFrame,
): SemanticTarget {
  const block = blockRecord(frame, item.semantic.identity.blockId);
  const paragraphGraphemeCount = block?.graphemeCount ?? item.semantic.graphemeTo;
  const edge = nearestClusterEdge(local, item.clusters, paragraphGraphemeCount);
  return {
    kind: 'text',
    scope: item.scope,
    identity: item.semantic.identity,
    graphemeOffset: edge.graphemeOffset,
    affinity: edge.affinity,
  };
}

function ownershipTarget(region: OwnershipRegion, frame: InteractionFrame): SemanticTarget | null {
  const block = blockRecord(frame, region.identity.blockId);
  if (!block) return null;
  const graphemeOffset = region.kind === 'trailing' ? block.graphemeCount : 0;
  return {
    kind: 'text',
    scope: region.scope,
    identity: region.identity,
    graphemeOffset,
    affinity: caretAffinity(graphemeOffset, block.graphemeCount),
  };
}

function whitespaceTargetFromRegion(
  region: OwnershipRegion,
  local: Point,
  frame: InteractionFrame,
): SemanticTarget | null {
  if (region.kind !== 'lineWhitespace' || region.graphemeFrom === undefined || region.graphemeTo === undefined || !region.box) {
    return null;
  }
  const block = blockRecord(frame, region.identity.blockId);
  if (!block) return null;
  const relX = local.x - region.box.x;
  const ratio = region.box.width > 0 ? relX / region.box.width : 0;
  // Affinity stays 'downstream' on BOTH branches, deliberately.
  //
  // Round-4 review correctly found that a click here published a non-canonical
  // affinity for an interior offset, leaving the caret painted while Home, End,
  // PageUp, PageDown, ArrowUp and ArrowDown were all refused. The fix for that is
  // in `publishSelectionOverlay`, which now normalizes every selection entering a
  // frame — one chokepoint every producer passes through.
  //
  // Normalizing HERE as well was tried and reverted: this target also feeds
  // word- and block-selection range construction, where the two endpoints' affinity
  // is what orders `from`/`to`, and rewriting it broke double-click whitespace
  // selection and non-word segment selection. Producer-side affinity is a
  // range-ordering hint; canonical-per-offset is a caret-addressing rule. They are
  // different jobs and must not be collapsed.
  const graphemeOffset = ratio < 0.5 ? region.graphemeFrom : region.graphemeTo;
  return {
    kind: 'text',
    scope: region.scope,
    identity: region.identity,
    graphemeOffset,
    affinity: 'downstream',
  };
}

function candidatesForPage(pageIndex: number, page: InteractionFrame['display'][number], frame: InteractionFrame): HitCandidate[] {
  const out: HitCandidate[] = [];
  page.items.forEach((item, zOrder) => {
    if (item.kind === 'tableBorder') return;
    const meta = item.interaction;
    const base = {
      zOrder: meta?.zOrder ?? zOrder,
      box: item.box,
      clip: meta?.clip,
      transform: meta?.transform,
      writingMode: meta?.writingMode,
      pointerTransparent:
        meta?.pointerTransparent ?? (item.kind === 'fill' || item.kind === 'decoration' || item.kind === 'custom'),
      synthetic: (item.kind === 'text' || item.kind === 'image') && item.synthetic === true,
    };
    if (item.kind === 'text') {
      out.push({ ...base, resolveAt: (local) => textTargetFromItem(item, local, frame) });
    } else if (item.kind === 'image') {
      out.push({
        ...base,
        resolveAt: () => ({ kind: 'atomic', scope: item.scope, objectId: item.semantic.objectId }),
      });
    } else if (item.kind === 'decoration' || item.kind === 'fill' || item.kind === 'custom') {
      out.push({ ...base, resolveAt: () => null });
    }
  });

  const paintedTextBlocks = new Set(
    page.items.filter((item) => item.kind === 'text').map((item) => item.semantic.identity.blockId),
  );
  for (const region of frame.semanticIndex.ownershipRegions) {
    if (region.pageIndex !== pageIndex || !region.box) continue;
    if (region.kind === 'lineWhitespace') {
      out.push({
        zOrder: -1,
        box: region.box,
        writingMode: HORIZONTAL_WRITING_MODE,
        pointerTransparent: false,
        synthetic: false,
        resolveAt: (local) => whitespaceTargetFromRegion(region, local, frame),
      });
      continue;
    }
    if (paintedTextBlocks.has(region.identity.blockId)) continue;
    out.push({
      zOrder: -1,
      box: region.box,
      writingMode: HORIZONTAL_WRITING_MODE,
      pointerTransparent: false,
      synthetic: false,
      resolveAt: () => ownershipTarget(region, frame),
    });
  }
  return out;
}

export function hitTestPointer(
  frame: InteractionFrame,
  clientPoint: Point,
  metrics: InteractionHostMetrics | undefined,
  options?: { frameId?: InteractionFrameId },
): InteractionOutcome<SemanticHitTarget> {
  const identity = validateFrameIdentity(frame, options?.frameId);
  if (!identity.ok) {
    return reject('staleFrame', identity.reason, frame.id);
  }
  if (frame.completeness.kind === 'pending') {
    return reject('pendingLayout', 'layout for the current model revision is not yet published', frame.id);
  }
  const host = validateHostMetrics(metrics);
  if (!host.ok) return reject('invalidTarget', host.reason, frame.id);

  const content = clientToContent(clientPoint, host.value);
  if (!content.ok) return reject('invalidTarget', content.reason, frame.id);
  const pageLocal = contentToPageLocal(content.value, frame);
  if (!pageLocal.ok) return reject('invalidTarget', pageLocal.reason, frame.id);

  const page = frame.display.find((p) => p.index === pageLocal.value.pageIndex);
  if (!page) return reject('invalidTarget', 'page not found in frame display', frame.id);

  const candidates = candidatesForPage(pageLocal.value.pageIndex, page, frame).sort((a, b) => b.zOrder - a.zOrder);

  for (const candidate of candidates) {
    if (candidate.synthetic || candidate.pointerTransparent) continue;
    if (unsupportedWritingMode(candidate.writingMode)) {
      return reject('unsupported', 'only horizontal-tb writing mode is supported in the body-paragraph gate', frame.id);
    }
    const hitLocal = localPointInItem(pageLocal.value.local, candidate.box, candidate.clip, candidate.transform);
    if (hitLocal === 'singular') {
      return reject('invalidTarget', 'display item transform is not invertible', frame.id);
    }
    if (!hitLocal) continue;
    const target = candidate.resolveAt(hitLocal);
    if (!target) continue;
    return okValue(
      { frameId: frame.id, revisions: frame.revisions, target, role: roleForTarget(frame, target) },
      frame.id,
    );
  }

  return reject('invalidTarget', 'no eligible hit target at coordinate', frame.id);
}

function overlayFromPageLocal(
  frame: InteractionFrame,
  pageIndex: number,
  pageLocal: Rect,
  meta: PositionedInteractionMeta | undefined,
): { rect: Rect; clip?: Rect } | 'singular' | null {
  if (unsupportedWritingMode(meta?.writingMode)) return null;
  const transform = meta?.transform;
  const stacked = stackedContentRect(frame, pageIndex, pageLocal, transform);
  if (!stacked) return transform ? 'singular' : null;
  if (meta?.clip) {
    const clipLocal = intersectRects(pageLocal, meta.clip);
    if (!clipLocal) return null;
    const clip = clipStackedRect(frame, pageIndex, stacked, clipLocal) ?? undefined;
    const clippedRect = clip ? intersectRects(stacked, clip) ?? null : null;
    if (!clippedRect || clippedRect.width <= 0 || clippedRect.height <= 0) return null;
    return { rect: clippedRect, clip };
  }
  if (stacked.width <= 0 || stacked.height <= 0) return null;
  return { rect: stacked };
}

function caretRectForLineWhitespace(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  region: OwnershipRegion,
): CaretGeometry | null {
  if (region.kind !== 'lineWhitespace' || !region.box || region.pageIndex === undefined) return null;
  if (region.graphemeFrom === undefined || region.graphemeTo === undefined) return null;
  if (target.graphemeOffset < region.graphemeFrom || target.graphemeOffset > region.graphemeTo) return null;
  const block = blockRecord(frame, target.identity.blockId);
  if (!block || block.readOnly) return null;
  const atTrailingEdge = target.graphemeOffset === region.graphemeTo;
  const x = atTrailingEdge ? region.box.x + region.box.width : region.box.x;
  const overlay = overlayFromPageLocal(
    frame,
    region.pageIndex,
    { x, y: region.box.y, width: 1, height: region.box.height },
    { pageIndex: region.pageIndex, zOrder: 0, writingMode: HORIZONTAL_WRITING_MODE },
  );
  if (overlay === 'singular' || !overlay) return null;
  return {
    frameId: frame.id,
    rect: overlay.rect,
    pageIndex: region.pageIndex,
    writingDirection: 'ltr',
    writingMode: HORIZONTAL_WRITING_MODE,
    affinity: target.affinity,
    clip: overlay.clip,
  };
}

function caretBoxForTargetOnItem(
  target: Extract<SemanticTarget, { kind: 'text' }>,
  block: NonNullable<ReturnType<typeof blockRecord>>,
  item: Extract<DisplayItem, { kind: 'text' }>,
): Rect | null {
  if (item.clusters.length === 0) {
    const atEnd = target.graphemeOffset >= block.graphemeCount;
    return {
      x: atEnd ? item.box.x + item.box.width : item.box.x,
      y: item.box.y,
      width: 1,
      height: item.box.height,
    };
  }
  for (const cluster of item.clusters) {
    if (target.graphemeOffset < cluster.graphemeFrom || target.graphemeOffset > cluster.graphemeTo) continue;
    const atEnd = target.graphemeOffset >= cluster.graphemeTo;
    return {
      x: atEnd ? cluster.box.x + cluster.box.width : cluster.box.x,
      y: cluster.box.y,
      width: 1,
      height: cluster.box.height,
    };
  }
  if (target.graphemeOffset >= block.graphemeCount) {
    const last = item.clusters[item.clusters.length - 1]!;
    return { x: last.box.x + last.box.width, y: last.box.y, width: 1, height: last.box.height };
  }
  return null;
}

/** Caret overlay from layout-published navigation edges (respects clip/transform from painted items). */
export function navigationEdgeCaretOverlay(
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): { rect: Rect; clip?: Rect } | 'singular' | null {
  if (!navigation) return null;
  const block = blockRecord(frame, target.identity.blockId);
  if (!block || block.readOnly) return null;
  for (const line of navigation.visualLines) {
    if (line.identity.blockId !== target.identity.blockId) continue;
    for (const edge of line.edges) {
      const edgeTarget = edge.target;
      if (
        edgeTarget.graphemeOffset !== target.graphemeOffset ||
        edgeTarget.affinity !== target.affinity ||
        edgeTarget.identity.storyId !== target.identity.storyId
      ) {
        continue;
      }
      const meta = edge.interaction;
      return overlayFromPageLocal(
        frame,
        line.pageIndex,
        {
          x: edge.pageLocalX,
          y: edge.pageLocalY,
          width: 1,
          height: edge.pageLocalHeight,
        },
        meta,
      );
    }
  }
  return null;
}

/** Caret overlay derived only from bridged display items (respects clip/transform). */
export function displayBackedCaretOverlay(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): { rect: Rect; clip?: Rect } | 'singular' | null {
  const block = blockRecord(frame, target.identity.blockId);
  if (!block || block.readOnly) return null;
  for (const page of frame.display) {
    for (const item of page.items) {
      if (item.kind !== 'text' || item.semantic.identity.blockId !== target.identity.blockId) continue;
      const caretBox = caretBoxForTargetOnItem(target, block, item);
      if (!caretBox) continue;
      const overlay = overlayFromPageLocal(frame, page.index, caretBox, item.interaction);
      if (overlay === 'singular') return 'singular';
      if (overlay) return overlay;
    }
  }
  return null;
}

/** Resolve caret overlay from layout navigation edges only; display clusters are paint-only. */
export function caretOverlayForTarget(
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): { rect: Rect; clip?: Rect } | 'singular' | null {
  return navigationEdgeCaretOverlay(frame, navigation, target);
}

function caretRectForTextTarget(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): CaretGeometry | null {
  const block = blockRecord(frame, target.identity.blockId);
  if (!block || block.readOnly) return null;

  for (const region of frame.semanticIndex.ownershipRegions) {
    if (region.identity.blockId !== target.identity.blockId) continue;
    const fromWhitespace = caretRectForLineWhitespace(frame, target, region);
    if (fromWhitespace) return fromWhitespace;
  }

  // Match on (block, offset) and accept the index's canonical affinity.
  //
  // The index publishes exactly ONE stop per grapheme offset (`caretAffinity`), so
  // an offset-level match is unambiguous: there is only one geometric position to
  // return. Requiring an exact affinity match instead meant any caller carrying a
  // different affinity got `null` — which review measured as an unpainted caret and
  // six dead navigation keys after every keystroke, because the edit surface reports
  // a constant affinity it has no line geometry to derive.
  //
  // `withCanonicalAffinity` normalizes at the observation boundary; this is the
  // second line of defense, so a future caller that guesses affinity degrades to a
  // correct rect rather than to a dead keyboard.
  const stop = frame.semanticIndex.caretStops.find(
    (s) =>
      s.target.kind === 'text' &&
      s.target.identity.blockId === target.identity.blockId &&
      s.target.graphemeOffset === target.graphemeOffset,
  );
  if (!stop || stop.role !== 'editableText') return null;

  for (const page of frame.display) {
    for (const item of page.items) {
      if (item.kind !== 'text' || item.semantic.identity.blockId !== target.identity.blockId) continue;
      const caretBox = caretBoxForTargetOnItem(target, block, item);
      if (!caretBox) continue;
      const overlay = overlayFromPageLocal(frame, page.index, caretBox, item.interaction);
      if (overlay === 'singular' || !overlay) continue;
      return {
        frameId: frame.id,
        rect: overlay.rect,
        pageIndex: page.index,
        writingDirection: item.interaction?.writingDirection ?? 'ltr',
        writingMode: HORIZONTAL_WRITING_MODE,
        affinity: target.affinity,
        clip: overlay.clip,
        transform: item.interaction?.transform,
      };
    }
  }

  for (const region of frame.semanticIndex.ownershipRegions) {
    if (region.identity.blockId !== target.identity.blockId || !region.box || region.pageIndex === undefined) continue;
    if (region.kind === 'lineWhitespace') continue;
    const atEnd = target.graphemeOffset >= block.graphemeCount;
    const x = atEnd ? region.box.x + Math.max(1, region.box.width) : region.box.x;
    const overlay = overlayFromPageLocal(
      frame,
      region.pageIndex,
      { x, y: region.box.y, width: 1, height: region.box.height },
      { pageIndex: region.pageIndex, zOrder: 0, writingMode: HORIZONTAL_WRITING_MODE },
    );
    if (overlay === 'singular' || !overlay) continue;
    return {
      frameId: frame.id,
      rect: overlay.rect,
      pageIndex: region.pageIndex,
      writingDirection: 'ltr',
      writingMode: HORIZONTAL_WRITING_MODE,
      affinity: target.affinity,
      clip: overlay.clip,
    };
  }
  return null;
}

export function deriveCaretGeometry(
  frame: InteractionFrame,
  target: SemanticTarget | null | undefined,
): CaretGeometry | null {
  const resolved = target ?? frame.selection?.head ?? null;
  if (!resolved) return frame.caret;
  if (resolved.kind === 'atomic') return null;
  return caretRectForTextTarget(frame, resolved);
}

function orderedTextRange(
  anchor: SemanticTarget,
  head: SemanticTarget,
): { from: Extract<SemanticTarget, { kind: 'text' }>; to: Extract<SemanticTarget, { kind: 'text' }> } | null {
  if (anchor.kind !== 'text' || head.kind !== 'text') return null;
  if (anchor.identity.blockId !== head.identity.blockId) return null;
  if (anchor.identity.storyId !== head.identity.storyId) return null;
  if (anchor.graphemeOffset < head.graphemeOffset) return { from: anchor, to: head };
  if (anchor.graphemeOffset > head.graphemeOffset) return { from: head, to: anchor };
  if (anchor.affinity === 'upstream' && head.affinity === 'downstream') return { from: anchor, to: head };
  if (anchor.affinity === 'downstream' && head.affinity === 'upstream') return { from: head, to: anchor };
  return { from: anchor, to: head };
}

function storyForBlock(frame: InteractionFrame, blockId: string, storyId: string) {
  return frame.semanticIndex.stories.find(
    (story) => story.storyId === storyId && story.blocks.some((b) => b.identity.blockId === blockId),
  );
}

function compareBlockOrder(
  frame: InteractionFrame,
  a: Extract<SemanticTarget, { kind: 'text' }>,
  b: Extract<SemanticTarget, { kind: 'text' }>,
): number | null {
  if (a.identity.storyId !== b.identity.storyId) return null;
  const story = storyForBlock(frame, a.identity.blockId, a.identity.storyId);
  if (!story) return null;
  const blockA = story.blocks.find((block) => block.identity.blockId === a.identity.blockId);
  const blockB = story.blocks.find((block) => block.identity.blockId === b.identity.blockId);
  if (!blockA || !blockB) return null;
  return blockA.orderIndex - blockB.orderIndex;
}

function selectionRangeForBlock(
  block: { readonly graphemeCount: number },
  startOffset: number,
  endOffset: number,
): { from: number; to: number } {
  const from = Math.max(0, Math.min(startOffset, block.graphemeCount));
  const to = Math.max(0, Math.min(endOffset, block.graphemeCount));
  return from <= to ? { from, to } : { from: to, to: from };
}

function selectionRectsForMultiBlockTextRange(
  frame: InteractionFrame,
  selection: SemanticSelection,
  anchor: Extract<SemanticTarget, { kind: 'text' }>,
  head: Extract<SemanticTarget, { kind: 'text' }>,
  options?: SelectionGeometryOptions,
): SelectionGeometry | null {
  const story = storyForBlock(frame, anchor.identity.blockId, anchor.identity.storyId);
  if (!story || story.storyId !== head.identity.storyId) return null;
  const anchorBlock = story.blocks.find((b) => b.identity.blockId === anchor.identity.blockId);
  const headBlock = story.blocks.find((b) => b.identity.blockId === head.identity.blockId);
  if (!anchorBlock || !headBlock || anchorBlock.readOnly || headBlock.readOnly) return null;

  const order = compareBlockOrder(frame, anchor, head);
  if (order === null) return null;

  const startBlock = order <= 0 ? anchorBlock : headBlock;
  const endBlock = order <= 0 ? headBlock : anchorBlock;
  const startOffset = order <= 0 ? anchor.graphemeOffset : head.graphemeOffset;
  const endOffset = order <= 0 ? head.graphemeOffset : anchor.graphemeOffset;
  if (startBlock.orderIndex > endBlock.orderIndex) return null;

  const rects: Rect[] = [];
  const pageIndices: number[] = [];
  const visible = options?.visiblePageIndices ? new Set(options.visiblePageIndices) : null;

  for (const block of story.blocks) {
    if (block.orderIndex < startBlock.orderIndex || block.orderIndex > endBlock.orderIndex) continue;
    if (block.readOnly) return null;
    let range: { from: number; to: number };
    if (block.identity.blockId === startBlock.identity.blockId && block.identity.blockId === endBlock.identity.blockId) {
      range = selectionRangeForBlock(block, startOffset, endOffset);
    } else if (block.identity.blockId === startBlock.identity.blockId) {
      range = selectionRangeForBlock(block, startOffset, block.graphemeCount);
    } else if (block.identity.blockId === endBlock.identity.blockId) {
      range = selectionRangeForBlock(block, 0, endOffset);
    } else {
      range = selectionRangeForBlock(block, 0, block.graphemeCount);
    }
    const partialSelection: SemanticSelection = {
      frameId: frame.id,
      scope: selection.scope,
      anchor: {
        kind: 'text',
        scope: selection.scope,
        identity: block.identity,
        graphemeOffset: range.from,
        affinity: 'upstream',
      } as Extract<SemanticTarget, { kind: 'text' }>,
      head: {
        kind: 'text',
        scope: selection.scope,
        identity: block.identity,
        graphemeOffset: range.to,
        affinity: 'downstream',
      } as Extract<SemanticTarget, { kind: 'text' }>,
    };
    const partial = selectionRectsForTextRange(
      frame,
      partialSelection,
      partialSelection.anchor as Extract<SemanticTarget, { kind: 'text' }>,
      partialSelection.head as Extract<SemanticTarget, { kind: 'text' }>,
      options,
    );
    for (let i = 0; i < partial.rects.length; i += 1) {
      const pageIndex = partial.pageIndices[i];
      if (visible && pageIndex !== undefined && !visible.has(pageIndex)) continue;
      rects.push(partial.rects[i]!);
      if (pageIndex !== undefined) pageIndices.push(pageIndex);
    }
  }

  return {
    frameId: frame.id,
    selection,
    rects,
    pageIndices,
    collapsed: anchor.graphemeOffset === head.graphemeOffset &&
      anchor.identity.blockId === head.identity.blockId &&
      anchor.affinity === head.affinity,
  };
}

function selectionRectsForTextRange(
  frame: InteractionFrame,
  selection: SemanticSelection,
  from: Extract<SemanticTarget, { kind: 'text' }>,
  to: Extract<SemanticTarget, { kind: 'text' }>,
  options?: SelectionGeometryOptions,
): SelectionGeometry {
  const visible = options?.visiblePageIndices ? new Set(options.visiblePageIndices) : null;
  const rects: Rect[] = [];
  const pageIndices: number[] = [];
  const collapsed = from.graphemeOffset === to.graphemeOffset && from.affinity === to.affinity;

  for (const page of frame.display) {
    if (visible && !visible.has(page.index)) continue;
    for (const item of page.items) {
      if (item.kind !== 'text' || item.semantic.identity.blockId !== from.identity.blockId) continue;
      const meta = item.interaction;
      if (unsupportedWritingMode(meta?.writingMode)) continue;
      if (item.clusters.length === 0 && collapsed) {
        const overlay = overlayFromPageLocal(frame, page.index, item.box, meta);
        if (overlay && overlay !== 'singular') {
          rects.push(overlay.rect);
          pageIndices.push(page.index);
        }
        continue;
      }
      for (const cluster of item.clusters) {
        if (collapsed) {
          if (cluster.graphemeFrom <= from.graphemeOffset && from.graphemeOffset <= cluster.graphemeTo) {
            const overlay = overlayFromPageLocal(frame, page.index, cluster.box, meta);
            if (overlay && overlay !== 'singular') {
              rects.push(overlay.rect);
              pageIndices.push(page.index);
            }
          }
          continue;
        }
        if (cluster.graphemeTo <= from.graphemeOffset || cluster.graphemeFrom >= to.graphemeOffset) continue;
        const span = cluster.graphemeTo - cluster.graphemeFrom || 1;
        let slice = cluster.box;
        if (cluster.graphemeFrom < from.graphemeOffset) {
          const ratio = (from.graphemeOffset - cluster.graphemeFrom) / span;
          slice = { ...slice, x: slice.x + slice.width * ratio, width: slice.width * (1 - ratio) };
        }
        if (cluster.graphemeTo > to.graphemeOffset) {
          const ratio = (to.graphemeOffset - cluster.graphemeFrom) / span;
          slice = { ...slice, width: slice.width * ratio };
        }
        const overlay = overlayFromPageLocal(frame, page.index, slice, meta);
        if (overlay && overlay !== 'singular') {
          rects.push(overlay.rect);
          pageIndices.push(page.index);
        }
      }
    }
  }

  return { frameId: frame.id, selection, rects, pageIndices, collapsed };
}

export function deriveSelectionGeometry(
  frame: InteractionFrame,
  selection: SemanticSelection | null | undefined,
  options?: SelectionGeometryOptions,
): InteractionOutcome<SelectionGeometry> {
  const resolved = selection ?? frame.selection;
  if (!resolved) {
    return reject('invalidTarget', 'no semantic selection is available', frame.id);
  }
  if (resolved.anchor.kind === 'atomic' || resolved.head.kind === 'atomic') {
    return reject('unsupported', 'atomic selection geometry is not proven in the body-paragraph lane', frame.id);
  }
  const blockA = blockRecord(frame, resolved.anchor.identity.blockId);
  const blockB = blockRecord(frame, resolved.head.identity.blockId);
  if (!blockA || !blockB) {
    return reject('invalidTarget', 'selection block is missing from semantic index', frame.id);
  }
  if (blockA?.readOnly || blockB?.readOnly) {
    return reject('readOnly', 'selection geometry for read-only targets is not editable', frame.id);
  }
  if (resolved.anchor.identity.storyId !== resolved.head.identity.storyId) {
    return reject('invalidTarget', 'cross-story selection geometry is not supported', frame.id);
  }
  if (resolved.anchor.identity.blockId !== resolved.head.identity.blockId) {
    const multi = selectionRectsForMultiBlockTextRange(frame, resolved, resolved.anchor, resolved.head, options);
    if (!multi) {
      return reject('unsupported', 'multi-block selection geometry could not be resolved in canonical story order', frame.id);
    }
    return okValue(multi, frame.id);
  }
  const range = orderedTextRange(resolved.anchor, resolved.head);
  if (!range) return reject('invalidTarget', 'could not order text selection endpoints', frame.id);
  return okValue(selectionRectsForTextRange(frame, resolved, range.from, range.to, options), frame.id);
}

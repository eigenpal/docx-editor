import type {
  InteractionFrame,
  InteractionFrameId,
  RenderedTextGeometryPort,
  SemanticSelection,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import type { DisplayItem } from '@docx-editor.dev/core-contract/geometry';
import type { Point, Rect } from '@docx-editor.dev/core-contract/types';
import {
  overlaysForFrame as engineOverlaysForFrame,
  type FrameOverlays,
  type OverlayBox,
} from './display-bridge.ts';

const RUN_SELECTOR = '[data-docx-block-id][data-docx-utf16-from][data-docx-utf16-to]';
type TextDisplayItem = Extract<DisplayItem, { kind: 'text' }>;

export interface RunSemanticRange {
  readonly utf16From: number;
  readonly utf16To: number;
  readonly graphemeFrom: number;
  readonly graphemeTo: number;
}

function graphemeAtUtf16Boundary(item: TextDisplayItem, utf16: number): number {
  if (utf16 <= item.semantic.utf16From) return item.semantic.graphemeFrom;
  if (utf16 >= item.semantic.utf16To) return item.semantic.graphemeTo;
  for (const cluster of item.clusters) {
    if (utf16 === cluster.utf16From) return cluster.graphemeFrom;
    if (utf16 === cluster.utf16To) return cluster.graphemeTo;
  }
  // Paint runs must not split a shaped cluster. Keep a malformed boundary on
  // the preceding complete cluster so DOM realization fails safely.
  const preceding = item.clusters.filter((cluster) => cluster.utf16To < utf16).at(-1);
  return preceding?.graphemeTo ?? item.semantic.graphemeFrom;
}

/** Semantic UTF-16/grapheme range represented by one grouped paint run. */
export function semanticRangeForRun(item: TextDisplayItem, runIndex: number): RunSemanticRange {
  const utf16From =
    item.semantic.utf16From +
    item.runs.slice(0, runIndex).reduce((length, run) => length + run.text.length, 0);
  const utf16To = Math.min(
    item.semantic.utf16To,
    utf16From + (item.runs[runIndex]?.text.length ?? 0)
  );
  return {
    utf16From,
    utf16To,
    graphemeFrom: graphemeAtUtf16Boundary(item, utf16From),
    graphemeTo: graphemeAtUtf16Boundary(item, utf16To),
  };
}

export interface DomRenderedTextGeometryOptions {
  readonly getRoot: () => HTMLElement | null;
  readonly getFrame: () => InteractionFrame | null;
}

export interface DomRenderedTextGeometryPort extends RenderedTextGeometryPort {
  /** Mark the current DOM subtree as committed for this layout revision. */
  commitFrame(frame: InteractionFrame): void;
  /** Prefer realized browser rectangles and fall back to engine geometry. */
  overlaysForFrame(frame: InteractionFrame): FrameOverlays;
}

function sameFrame(left: InteractionFrameId, right: InteractionFrameId): boolean {
  return left.value === right.value;
}

function currentRoot(
  options: DomRenderedTextGeometryOptions,
  frameId: InteractionFrameId
): { root: HTMLElement; frame: InteractionFrame } | null {
  const root = options.getRoot();
  const frame = options.getFrame();
  if (!root || !frame || !sameFrame(frame.id, frameId)) return null;
  if (root.dataset.docxLayoutRevision !== String(frame.revisions.layoutRevision)) return null;
  return { root, frame };
}

function numberData(element: HTMLElement, key: keyof DOMStringMap): number | null {
  const raw = element.dataset[key];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function textRuns(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(RUN_SELECTOR));
}

function targetUtf16(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>
): number | null {
  const candidates: TextDisplayItem[] = [];
  for (const page of frame.display) {
    for (const item of page.items) {
      if (
        item.kind === 'text' &&
        item.semantic.identity.storyId === target.identity.storyId &&
        item.semantic.identity.blockId === target.identity.blockId
      ) {
        candidates.push(item);
      }
    }
  }
  for (const item of candidates) {
    if (target.graphemeOffset === item.semantic.graphemeFrom) return item.semantic.utf16From;
    if (target.graphemeOffset === item.semantic.graphemeTo) return item.semantic.utf16To;
    for (const cluster of item.clusters) {
      if (target.graphemeOffset === cluster.graphemeFrom) return cluster.utf16From;
      if (target.graphemeOffset === cluster.graphemeTo) return cluster.utf16To;
    }
  }
  return null;
}

function runForOffset(
  root: HTMLElement,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  utf16Offset: number
): HTMLElement | null {
  const candidates = textRuns(root).filter(
    (element) =>
      element.dataset.docxStoryId === target.identity.storyId &&
      element.dataset.docxBlockId === target.identity.blockId
  );
  const eligible = candidates.filter((element) => {
    const from = numberData(element, 'docxUtf16From');
    const to = numberData(element, 'docxUtf16To');
    if (from === null || to === null) return false;
    return target.affinity === 'upstream'
      ? from < utf16Offset && utf16Offset <= to
      : from <= utf16Offset && utf16Offset < to;
  });
  if (eligible.length > 0) return eligible[0]!;
  return (
    candidates.find((element) => {
      const from = numberData(element, 'docxUtf16From');
      const to = numberData(element, 'docxUtf16To');
      return from !== null && to !== null && from <= utf16Offset && utf16Offset <= to;
    }) ?? null
  );
}

function textPositionAtOffset(
  root: HTMLElement,
  offset: number
): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function firstRangeRect(range: Range): Rect | null {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.height <= 0)
    return null;
  return { x: rect.x, y: rect.y, width: Math.max(1, rect.width), height: rect.height };
}

function caretRect(
  root: HTMLElement,
  frame: InteractionFrame,
  target: SemanticTarget
): Rect | null {
  if (target.kind !== 'text') return null;
  const utf16Offset = targetUtf16(frame, target);
  if (utf16Offset === null) return null;
  const run = runForOffset(root, target, utf16Offset);
  if (!run) return null;
  const from = numberData(run, 'docxUtf16From');
  if (from === null) return null;
  const position = textPositionAtOffset(run, utf16Offset - from);
  if (!position) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  return firstRangeRect(range);
}

function rangeRects(
  root: HTMLElement,
  frame: InteractionFrame,
  selection: SemanticSelection
): readonly Rect[] {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') return [];
  if (
    selection.anchor.identity.storyId !== selection.head.identity.storyId ||
    selection.anchor.identity.blockId !== selection.head.identity.blockId
  ) {
    return [];
  }
  const anchorUtf16 = targetUtf16(frame, selection.anchor);
  const headUtf16 = targetUtf16(frame, selection.head);
  if (anchorUtf16 === null || headUtf16 === null) return [];
  const from = Math.min(anchorUtf16, headUtf16);
  const to = Math.max(anchorUtf16, headUtf16);
  const rects: Rect[] = [];
  for (const run of textRuns(root)) {
    if (
      run.dataset.docxStoryId !== selection.anchor.identity.storyId ||
      run.dataset.docxBlockId !== selection.anchor.identity.blockId
    ) {
      continue;
    }
    const runFrom = numberData(run, 'docxUtf16From');
    const runTo = numberData(run, 'docxUtf16To');
    if (runFrom === null || runTo === null || runTo <= from || runFrom >= to) continue;
    const start = textPositionAtOffset(run, Math.max(from, runFrom) - runFrom);
    const end = textPositionAtOffset(run, Math.min(to, runTo) - runFrom);
    if (!start || !end) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
  }
  return rects;
}

function textOffsetWithin(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let text = walker.nextNode() as Text | null;
  while (text) {
    if (text === node) return seen + offset;
    seen += text.data.length;
    text = walker.nextNode() as Text | null;
  }
  return null;
}

function targetForUtf16(
  frame: InteractionFrame,
  storyId: string,
  blockId: string,
  utf16Offset: number
): SemanticTarget | null {
  for (const page of frame.display) {
    for (const item of page.items) {
      if (
        item.kind !== 'text' ||
        item.semantic.identity.storyId !== storyId ||
        item.semantic.identity.blockId !== blockId
      ) {
        continue;
      }
      if (utf16Offset === item.semantic.utf16From) {
        return {
          kind: 'text',
          scope: item.semantic.scope,
          identity: item.semantic.identity,
          graphemeOffset: item.semantic.graphemeFrom,
          affinity: 'downstream',
        };
      }
      for (const cluster of item.clusters) {
        if (utf16Offset <= cluster.utf16To) {
          const midpoint = cluster.utf16From + (cluster.utf16To - cluster.utf16From) / 2;
          return {
            kind: 'text',
            scope: item.semantic.scope,
            identity: item.semantic.identity,
            graphemeOffset: utf16Offset < midpoint ? cluster.graphemeFrom : cluster.graphemeTo,
            affinity: utf16Offset < midpoint ? 'downstream' : 'upstream',
          };
        }
      }
      if (utf16Offset === item.semantic.utf16To) {
        return {
          kind: 'text',
          scope: item.semantic.scope,
          identity: item.semantic.identity,
          graphemeOffset: item.semantic.graphemeTo,
          affinity: 'upstream',
        };
      }
    }
  }
  return null;
}

function targetAtPoint(
  root: HTMLElement,
  frame: InteractionFrame,
  point: Point
): SemanticTarget | null {
  const doc = root.ownerDocument;
  const standard = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint;
  let position: { node: Node; offset: number } | null = null;
  if (typeof standard === 'function') {
    const result = standard.call(doc, point.x, point.y);
    if (result) position = { node: result.offsetNode, offset: result.offset };
  } else {
    const legacy = (
      doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint;
    const result = legacy?.call(doc, point.x, point.y);
    if (result) position = { node: result.startContainer, offset: result.startOffset };
  }
  if (!position) return null;
  const element =
    (position.node.nodeType === Node.ELEMENT_NODE
      ? (position.node as Element)
      : position.node.parentElement
    )?.closest<HTMLElement>(RUN_SELECTOR) ?? null;
  if (!element || !root.contains(element)) return null;
  const local = textOffsetWithin(element, position.node, position.offset);
  const runFrom = numberData(element, 'docxUtf16From');
  const storyId = element.dataset.docxStoryId;
  const blockId = element.dataset.docxBlockId;
  if (local === null || runFrom === null || !storyId || !blockId) return null;
  return targetForUtf16(frame, storyId, blockId, runFrom + local);
}

function pageElement(root: HTMLElement, pageIndex: number): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>('.layout-page[data-page-index]')).find(
      (element) => element.dataset.pageIndex === String(pageIndex)
    ) ?? null
  );
}

function clientRectToPageLocal(
  root: HTMLElement,
  frame: InteractionFrame,
  pageIndex: number,
  rect: Rect
): Rect | null {
  const element = pageElement(root, pageIndex);
  const displayPage = frame.display.find((page) => page.index === pageIndex);
  if (!element || !displayPage) return null;
  const pageRect = element.getBoundingClientRect();
  const scaleX = displayPage.box.width > 0 ? pageRect.width / displayPage.box.width : 0;
  const scaleY = displayPage.box.height > 0 ? pageRect.height / displayPage.box.height : 0;
  if (!(scaleX > 0) || !(scaleY > 0)) return null;
  return {
    x: (rect.x - pageRect.x) / scaleX,
    y: (rect.y - pageRect.y) / scaleY,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  };
}

function pageForClientRect(root: HTMLElement, rect: Rect): number | null {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  for (const element of root.querySelectorAll<HTMLElement>('.layout-page[data-page-index]')) {
    const page = element.getBoundingClientRect();
    if (x < page.left || x > page.right || y < page.top || y > page.bottom) continue;
    const index = Number(element.dataset.pageIndex);
    return Number.isInteger(index) ? index : null;
  }
  return null;
}

export function createDomRenderedTextGeometryPort(
  options: DomRenderedTextGeometryOptions
): DomRenderedTextGeometryPort {
  const port: DomRenderedTextGeometryPort = {
    caretRect(target, frameId) {
      const current = currentRoot(options, frameId);
      return current ? caretRect(current.root, current.frame, target) : null;
    },
    selectionRects(selection, frameId) {
      const current = currentRoot(options, frameId);
      return current ? rangeRects(current.root, current.frame, selection) : [];
    },
    targetAtPoint(point, frameId) {
      const current = currentRoot(options, frameId);
      return current ? targetAtPoint(current.root, current.frame, point) : null;
    },
    commitFrame(frame) {
      const root = options.getRoot();
      const current = options.getFrame();
      if (!root || !current || !sameFrame(current.id, frame.id)) return;
      root.dataset.docxLayoutRevision = String(frame.revisions.layoutRevision);
    },
    overlaysForFrame(frame) {
      const fallback = engineOverlaysForFrame(frame);
      const root = options.getRoot();
      const current = options.getFrame();
      if (!root || !current || !sameFrame(current.id, frame.id)) return fallback;

      let caret: OverlayBox | null = fallback.caret;
      if (frame.selection?.head.kind === 'text' && frame.caret) {
        const realized = port.caretRect(frame.selection.head, frame.id);
        const local = realized
          ? clientRectToPageLocal(root, frame, frame.caret.pageIndex, realized)
          : null;
        if (local) {
          caret = {
            pageIndex: frame.caret.pageIndex,
            rect: local,
            writingDirection: frame.caret.writingDirection,
          };
        }
      }

      if (
        !frame.selection ||
        frame.selection.anchor.kind !== 'text' ||
        frame.selection.head.kind !== 'text'
      ) {
        return { caret, selection: fallback.selection };
      }
      if (
        frame.selection.anchor.identity.blockId === frame.selection.head.identity.blockId &&
        frame.selection.anchor.graphemeOffset === frame.selection.head.graphemeOffset
      ) {
        return { caret, selection: [] };
      }
      const selection = port
        .selectionRects(frame.selection, frame.id)
        .map((rect): OverlayBox | null => {
          const pageIndex = pageForClientRect(root, rect);
          if (pageIndex === null) return null;
          const local = clientRectToPageLocal(root, frame, pageIndex, rect);
          return local ? { pageIndex, rect: local } : null;
        })
        .filter((box): box is OverlayBox => box !== null);
      return { caret, selection: selection.length > 0 ? selection : fallback.selection };
    },
  };
  return port;
}

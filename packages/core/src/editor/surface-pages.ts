// Browser-only page viewport helpers. DOM-free document assembly lives in layout.

import {
  caretAt,
  createDocumentFurnitureSource,
  createDocumentNotesInput,
  createDocumentStyleDependencies,
  pagesToMaterialize,
  type CreateDocumentFurnitureSourceOptions,
  type CreateDocumentNotesInputOptions,
  type SemanticLayout,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { HeadlessDocumentView } from '@docx-editor.dev/core/store';

export const createSurfaceStyleDeps = createDocumentStyleDependencies;

export function createFurnitureSource(
  options: Omit<CreateDocumentFurnitureSourceOptions, 'view'> & {
    readonly session: HeadlessDocumentView;
  }
) {
  const { session, ...rest } = options;
  return createDocumentFurnitureSource({ view: session, ...rest });
}

export function createNotesLayoutInput(
  options: Omit<CreateDocumentNotesInputOptions, 'view'> & {
    readonly session: HeadlessDocumentView;
  }
) {
  const { session, ...rest } = options;
  return createDocumentNotesInput({ view: session, ...rest });
}

export function surfaceScroller(container: HTMLElement): HTMLElement | null {
  return container.closest('.docx-editor__scroll-container') as HTMLElement | null;
}

function viewportInLayout(
  container: HTMLElement,
  scroller: HTMLElement,
  scale: number
): { top: number; height: number } {
  const containerRect = container.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const topPx =
    scroller.scrollTop !== 0 && containerRect.top === 0 && scrollerRect.top === 0
      ? scroller.scrollTop - container.offsetTop
      : scrollerRect.top + scroller.clientTop - containerRect.top;
  return { top: topPx / scale, height: scroller.clientHeight / scale };
}

export function viewportPage(
  container: HTMLElement,
  layout: SemanticLayout,
  scale: number
): number | null {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight <= 0 || layout.pages.length === 0 || scale <= 0) {
    return null;
  }
  const viewport = viewportInLayout(container, scroller, scale);
  const centerY = viewport.top + viewport.height / 2;
  for (const page of layout.pages) {
    if (centerY < page.box.y + page.box.height) return page.index + 1;
  }
  return layout.pages.length;
}

export function visiblePageSet(
  container: HTMLElement,
  layout: SemanticLayout,
  selection: SemanticSelection,
  scale: number
): ReadonlySet<number> | undefined {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight === 0) return undefined;
  const viewport = viewportInLayout(container, scroller, scale);
  const pinned: number[] = [];
  for (const position of [selection.anchor, selection.head]) {
    const caret = caretAt(layout, position);
    if (caret) pinned.push(caret.pageIndex);
  }
  return pagesToMaterialize({ layout, viewport, overscanPages: 1, pinnedPages: pinned });
}

export function equalPageSets(
  left: ReadonlySet<number> | undefined,
  right: ReadonlySet<number> | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  for (const index of left) if (!right.has(index)) return false;
  return true;
}

export interface SurfaceExtent {
  readonly width: number;
  readonly height: number;
  readonly pageOffsetX: ReadonlyMap<number, number>;
}

export function surfaceExtent(
  layout: SemanticLayout,
  materialize: ReadonlySet<number> | undefined
): SurfaceExtent {
  const last = layout.pages[layout.pages.length - 1];
  const height = last ? last.box.y + last.box.height : 0;
  const widthPages = materialize
    ? layout.pages.filter((page) => materialize.has(page.index))
    : layout.pages;
  let width = 0;
  for (const page of widthPages) width = Math.max(width, page.box.x + page.box.width);
  const pageOffsetX = new Map<number, number>();
  if (new Set(widthPages.map((page) => page.box.width)).size > 1) {
    for (const page of layout.pages) {
      pageOffsetX.set(page.index, (width - page.box.width) / 2 - page.box.x);
    }
  }
  return { width, height, pageOffsetX };
}

export function equalSurfaceExtents(left: SurfaceExtent, right: SurfaceExtent): boolean {
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.pageOffsetX.size !== right.pageOffsetX.size
  ) {
    return false;
  }
  for (const [index, offset] of left.pageOffsetX) {
    if (right.pageOffsetX.get(index) !== offset) return false;
  }
  return true;
}

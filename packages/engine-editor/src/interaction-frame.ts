// Immutable interaction-frame construction and publication (interactive-paginated-editing 2.3–2.4).
// Framework-neutral: no DOM, no ProseMirror. Complete layout replaces the frame atomically;
// selection-only updates may reuse an unchanged layout revision while minting a new frame identity.

import type {
  InteractionFrame,
  InteractionFrameId,
  InteractionRevisions,
  FrameCompleteness,
  CaretGeometry,
  SelectionGeometry,
  FocusObservation,
  CompositionObservation,
  SemanticSelection,
  SemanticPositionIndex,
} from '@docx-editor.dev/core-contract/interaction';
import type { DisplayPage, GlyphRun } from '@docx-editor.dev/core-contract/geometry';
import type { Rect } from '@docx-editor.dev/core-contract/types';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { NavigationSidecarStore } from './navigation-sidecar-store.ts';
import { emptyNavigationGeometry } from './navigation-geometry.ts';

export const DEFAULT_PAGE_GAP_PX = 24 as const;

export interface StackedPageGeometry {
  readonly pageGeometry: readonly { index: number; box: Rect }[];
  readonly scrollGeometry: { contentHeight: number; pageTops: readonly number[]; pageGapPx: number };
}

/** Build frame-authoritative stacked page tops/boxes including inter-page gaps. */
export function buildStackedPageGeometry(
  display: readonly DisplayPage[],
  pageGapPx: number = DEFAULT_PAGE_GAP_PX,
): StackedPageGeometry {
  const pageTops: number[] = [];
  const pageGeometry: { index: number; box: Rect }[] = [];
  let top = 0;
  for (let i = 0; i < display.length; i += 1) {
    const page = display[i]!;
    pageTops.push(top);
    pageGeometry.push({
      index: page.index,
      box: { x: page.box.x, y: top, width: page.box.width, height: page.box.height },
    });
    top += page.box.height;
    if (i < display.length - 1) top += pageGapPx;
  }
  return {
    pageGeometry,
    scrollGeometry: { contentHeight: top, pageTops, pageGapPx },
  };
}

export interface PublishLayoutInput {
  readonly modelRevision: number;
  readonly resourceEpoch: number;
  readonly configurationEpoch: number;
  readonly display: readonly DisplayPage[];
  readonly semanticIndex: SemanticPositionIndex;
  readonly navigationGeometry?: NavigationGeometry;
  readonly pageGapPx?: number;
  readonly selection: SemanticSelection | null;
  readonly caret: CaretGeometry | null;
  readonly selectionGeometry: SelectionGeometry | null;
  readonly focus: FocusObservation;
  readonly composition: CompositionObservation;
  readonly currentPage: { readonly viewport: number; readonly caret: number };
}

export interface PublishSelectionInput {
  readonly modelRevision: number;
  readonly layoutRevision: number;
  readonly selection: SemanticSelection | null;
  readonly caret: CaretGeometry | null;
  readonly selectionGeometry: SelectionGeometry | null;
  readonly focus: FocusObservation;
  readonly composition: CompositionObservation;
  readonly currentPage: { readonly viewport: number; readonly caret: number };
}

/** Recursively freeze plain objects and arrays (idempotent). */
export function deepFreezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeValue(item);
    return Object.freeze(value);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) deepFreezeValue(record[key]);
  return Object.freeze(value);
}

function pageGeometryFromDisplay(display: readonly DisplayPage[], pageGapPx: number = DEFAULT_PAGE_GAP_PX) {
  return buildStackedPageGeometry(display, pageGapPx).pageGeometry;
}

function scrollGeometryFromDisplay(display: readonly DisplayPage[], pageGapPx: number = DEFAULT_PAGE_GAP_PX) {
  return buildStackedPageGeometry(display, pageGapPx).scrollGeometry;
}

function freezeDisplay(display: readonly DisplayPage[]): readonly DisplayPage[] {
  return deepFreezeValue(
    display.map((page) =>
      deepFreezeValue({
        ...page,
        box: deepFreezeValue({ ...page.box }),
        items: deepFreezeValue(
          page.items.map((item) => {
            if (item.kind === 'text') {
              return deepFreezeValue({
                ...item,
                box: deepFreezeValue({ ...item.box }),
                semantic: deepFreezeValue({ ...item.semantic, identity: deepFreezeValue({ ...item.semantic.identity }) }),
                clusters: deepFreezeValue(
                  item.clusters.map((cluster) =>
                    deepFreezeValue({ ...cluster, box: deepFreezeValue({ ...cluster.box }) }),
                  ),
                ),
                runs: deepFreezeValue(
                  item.runs.map((run: GlyphRun) =>
                    deepFreezeValue({ ...run, box: deepFreezeValue({ ...run.box }) }),
                  ),
                ),
              });
            }
            if (item.kind === 'image') {
              return deepFreezeValue({
                ...item,
                box: deepFreezeValue({ ...item.box }),
                semantic: deepFreezeValue({ ...item.semantic }),
              });
            }
            if (item.kind === 'fill') {
              return deepFreezeValue({ ...item, box: deepFreezeValue({ ...item.box }) });
            }
            if (item.kind === 'tableBorder') {
              return deepFreezeValue({
                ...item,
                segments: deepFreezeValue(
                  item.segments.map((seg) =>
                    deepFreezeValue({
                      ...seg,
                      from: deepFreezeValue({ ...seg.from }),
                      to: deepFreezeValue({ ...seg.to }),
                    }),
                  ),
                ),
              });
            }
            if (item.kind === 'decoration') {
              return deepFreezeValue({ ...item, box: deepFreezeValue({ ...item.box }) });
            }
            return deepFreezeValue({ ...item, box: deepFreezeValue({ ...item.box }) });
          }),
        ),
      }),
    ),
  );
}

function tagGeometry<T extends { frameId: InteractionFrameId }>(
  frameId: InteractionFrameId,
  value: T | null,
): T | null {
  if (!value) return null;
  return deepFreezeValue({ ...value, frameId });
}

function freezeSemanticSelection(id: InteractionFrameId, selection: SemanticSelection | null): SemanticSelection | null {
  if (!selection) return null;
  return deepFreezeValue({
    ...selection,
    frameId: id,
    anchor: deepFreezeValue({ ...selection.anchor }),
    head: deepFreezeValue({ ...selection.head }),
  });
}

function freezeCaret(id: InteractionFrameId, caret: CaretGeometry | null): CaretGeometry | null {
  if (!caret) return null;
  return deepFreezeValue({
    ...caret,
    frameId: id,
    rect: deepFreezeValue({ ...caret.rect }),
  });
}

function freezeSelectionGeometry(id: InteractionFrameId, geometry: SelectionGeometry | null): SelectionGeometry | null {
  if (!geometry) return null;
  return deepFreezeValue({
    ...geometry,
    frameId: id,
    selection: freezeSemanticSelection(id, geometry.selection)!,
    rects: deepFreezeValue(geometry.rects.map((rect) => deepFreezeValue({ ...rect }))),
    pageIndices: deepFreezeValue([...geometry.pageIndices]),
  });
}

function freezeSemanticIndex(index: SemanticPositionIndex): SemanticPositionIndex {
  return deepFreezeValue({
    ...index,
    stories: deepFreezeValue(
      index.stories.map((story) =>
        deepFreezeValue({
          ...story,
          blocks: deepFreezeValue(
            story.blocks.map((block) => deepFreezeValue({ ...block, identity: deepFreezeValue({ ...block.identity }) })),
          ),
        }),
      ),
    ),
    caretStops: deepFreezeValue(
      index.caretStops.map((stop) =>
        deepFreezeValue({
          ...stop,
          target:
            stop.target.kind === 'text'
              ? deepFreezeValue({ ...stop.target, identity: deepFreezeValue({ ...stop.target.identity }) })
              : deepFreezeValue({ ...stop.target }),
        }),
      ),
    ),
    ownershipRegions: deepFreezeValue(
      index.ownershipRegions.map((region) =>
        deepFreezeValue({
          ...region,
          identity: deepFreezeValue({ ...region.identity }),
          ...(region.box ? { box: deepFreezeValue({ ...region.box }) } : {}),
        }),
      ),
    ),
  });
}

export function emptySemanticIndex(storyId = ''): SemanticPositionIndex {
  return {
    stories: [{ storyId, scope: { kind: 'body' }, blocks: [] }],
    caretStops: [],
    ownershipRegions: [],
  };
}

/** Initial empty frame before the first layout publication. */
export function emptyInteractionFrame(): InteractionFrame {
  const id = deepFreezeValue({ value: 0 });
  const revisions: InteractionRevisions = deepFreezeValue({
    modelRevision: 0,
    layoutRevision: 0,
    resourceEpoch: 0,
    configurationEpoch: 0,
  });
  return deepFreezeFrame({
    id,
    revisions,
    completeness: deepFreezeValue({ kind: 'complete' as const }),
    display: deepFreezeValue([]),
    semanticIndex: freezeSemanticIndex(emptySemanticIndex()),
    pageGeometry: deepFreezeValue([]),
    scrollGeometry: deepFreezeValue({ contentHeight: 0, pageTops: deepFreezeValue([]), pageGapPx: DEFAULT_PAGE_GAP_PX }),
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: deepFreezeValue({ scope: null, focused: false }),
    composition: deepFreezeValue({ active: false, scope: null }),
    currentPage: deepFreezeValue({ viewport: 0, caret: 0 }),
  });
}

/** Every member references the same frame id and compatible revisions. */
export function frameMembersCoherent(frame: InteractionFrame): boolean {
  const { id, revisions, caret, selection, selectionGeometry } = frame;
  if (caret && caret.frameId.value !== id.value) return false;
  if (selection && selection.frameId.value !== id.value) return false;
  if (selectionGeometry && selectionGeometry.frameId.value !== id.value) return false;
  if (frame.completeness.kind === 'pending' && frame.completeness.targetModelRevision < revisions.modelRevision) {
    return false;
  }
  for (const pg of frame.pageGeometry) {
    const displayPage = frame.display.find((p) => p.index === pg.index);
    const stackedTop = frame.scrollGeometry.pageTops[pg.index];
    if (!displayPage || stackedTop === undefined || pg.box.y !== stackedTop) return false;
    if (pg.box.width !== displayPage.box.width || pg.box.height !== displayPage.box.height) return false;
  }
  return true;
}

/** Deep-freeze a frame and every nested readonly member. */
export function deepFreezeFrame(frame: InteractionFrame): InteractionFrame {
  deepFreezeValue(frame.id);
  deepFreezeValue(frame.revisions);
  deepFreezeValue(frame.completeness);
  deepFreezeValue(frame.display);
  deepFreezeValue(frame.semanticIndex);
  deepFreezeValue(frame.pageGeometry);
  deepFreezeValue(frame.scrollGeometry);
  if (frame.selection) deepFreezeValue(frame.selection);
  if (frame.caret) deepFreezeValue(frame.caret);
  if (frame.selectionGeometry) deepFreezeValue(frame.selectionGeometry);
  deepFreezeValue(frame.focus);
  deepFreezeValue(frame.composition);
  deepFreezeValue(frame.currentPage);
  return Object.freeze(frame);
}

/** Adapter-like read bundle used by adversarial coherence tests. */
export interface FrameReadSnapshot {
  readonly frameId: InteractionFrameId;
  readonly modelRevision: number;
  readonly layoutRevision: number;
  readonly resourceEpoch: number;
  readonly configurationEpoch: number;
  readonly completeness: FrameCompleteness;
  readonly displayRef: readonly DisplayPage[];
  readonly pageGeometryRef: readonly { index: number; box: Rect }[];
  readonly selectionFrameId: InteractionFrameId | null;
  readonly caretFrameId: InteractionFrameId | null;
  readonly selectionGeometryFrameId: InteractionFrameId | null;
}

export function adapterReadSnapshot(frame: InteractionFrame): FrameReadSnapshot {
  return {
    frameId: frame.id,
    modelRevision: frame.revisions.modelRevision,
    layoutRevision: frame.revisions.layoutRevision,
    resourceEpoch: frame.revisions.resourceEpoch,
    configurationEpoch: frame.revisions.configurationEpoch,
    completeness: frame.completeness,
    displayRef: frame.display,
    pageGeometryRef: frame.pageGeometry,
    selectionFrameId: frame.selection?.frameId ?? null,
    caretFrameId: frame.caret?.frameId ?? null,
    selectionGeometryFrameId: frame.selectionGeometry?.frameId ?? null,
  };
}

/** True when repeated adapter reads observe one coherent publication identity. */
export function readsAreCoherent(frame: InteractionFrame, reads: readonly FrameReadSnapshot[]): boolean {
  if (reads.length === 0) return true;
  const first = reads[0]!;
  for (const read of reads) {
    if (read.frameId.value !== first.frameId.value) return false;
    if (read.modelRevision !== first.modelRevision) return false;
    if (read.layoutRevision !== first.layoutRevision) return false;
    if (read.displayRef !== first.displayRef) return false;
    if (read.pageGeometryRef !== first.pageGeometryRef) return false;
    if (read.selectionFrameId?.value !== first.selectionFrameId?.value) return false;
    if (read.caretFrameId?.value !== first.caretFrameId?.value) return false;
    if (read.selectionGeometryFrameId?.value !== first.selectionGeometryFrameId?.value) return false;
    if (!frameMembersCoherent(frame)) return false;
  }
  return true;
}

export class InteractionFrameStore {
  private nextId = 1;
  private layoutRevision = 0;
  private current: InteractionFrame | null = null;
  private pending: { targetModelRevision: number; cancelled: boolean } | null = null;
  private navigationSidecar = new NavigationSidecarStore();

  getFrame(): InteractionFrame | null {
    return this.current;
  }

  getNavigationGeometry(frameId: InteractionFrameId): NavigationGeometry {
    return this.navigationSidecar.get(frameId);
  }

  clearNavigationSidecar(): void {
    this.navigationSidecar.clear();
  }

  getPendingTargetRevision(): number | null {
    return this.pending?.targetModelRevision ?? null;
  }

  private mintId(): InteractionFrameId {
    return deepFreezeValue({ value: this.nextId++ });
  }

  private buildFrame(
    id: InteractionFrameId,
    revisions: InteractionRevisions,
    completeness: FrameCompleteness,
    display: readonly DisplayPage[],
    semanticIndex: SemanticPositionIndex,
    selection: SemanticSelection | null,
    caret: CaretGeometry | null,
    selectionGeometry: SelectionGeometry | null,
    focus: FocusObservation,
    composition: CompositionObservation,
    currentPage: { viewport: number; caret: number },
    reuseGeometry?: {
      display: readonly DisplayPage[];
      pageGeometry: readonly { index: number; box: Rect }[];
      scrollGeometry: { contentHeight: number; pageTops: readonly number[]; pageGapPx: number };
    },
    pageGapPx: number = DEFAULT_PAGE_GAP_PX,
  ): InteractionFrame {
    const frozenDisplay = reuseGeometry?.display ?? freezeDisplay(display);
    const pageGeometry = reuseGeometry?.pageGeometry ?? pageGeometryFromDisplay(frozenDisplay, pageGapPx);
    const scrollGeometry = reuseGeometry?.scrollGeometry ?? scrollGeometryFromDisplay(frozenDisplay, pageGapPx);
    const frame: InteractionFrame = {
      id,
      revisions: deepFreezeValue({ ...revisions }),
      completeness: deepFreezeValue({ ...completeness }),
      display: frozenDisplay,
      semanticIndex: freezeSemanticIndex(semanticIndex),
      pageGeometry,
      scrollGeometry,
      selection: freezeSemanticSelection(id, selection),
      caret: freezeCaret(id, caret),
      selectionGeometry: freezeSelectionGeometry(id, selectionGeometry),
      focus: deepFreezeValue({ ...focus }),
      composition: deepFreezeValue({ ...composition }),
      currentPage: deepFreezeValue({ ...currentPage }),
    };
    if (!frameMembersCoherent(frame)) {
      throw new Error('InteractionFrameStore: incoherent frame publication');
    }
    this.current = deepFreezeFrame(frame);
    return this.current;
  }

  private attachNavigation(id: InteractionFrameId, geometry: NavigationGeometry | undefined, reuseFrom?: InteractionFrameId): void {
    if (geometry) {
      this.navigationSidecar.publish(id, geometry);
      return;
    }
    if (reuseFrom) this.navigationSidecar.rebase(reuseFrom, id);
  }

  /** Atomically publish a complete layout frame. */
  publishLayout(input: PublishLayoutInput): InteractionFrame {
    this.pending = null;
    this.layoutRevision += 1;
    const id = this.mintId();
    const revisions: InteractionRevisions = {
      modelRevision: input.modelRevision,
      layoutRevision: this.layoutRevision,
      resourceEpoch: input.resourceEpoch,
      configurationEpoch: input.configurationEpoch,
    };
    const frame = this.buildFrame(
      id,
      revisions,
      { kind: 'complete' },
      input.display,
      input.semanticIndex,
      input.selection,
      input.caret,
      input.selectionGeometry,
      input.focus,
      input.composition,
      input.currentPage,
      undefined,
      input.pageGapPx,
    );
    this.attachNavigation(id, input.navigationGeometry ?? emptyNavigationGeometry());
    return frame;
  }

  /** Publish selection/focus/composition overlay updates over an unchanged layout revision. */
  publishSelection(input: PublishSelectionInput): InteractionFrame {
    const base = this.current;
    if (!base) throw new Error('InteractionFrameStore: no frame to update');
    if (base.revisions.layoutRevision !== input.layoutRevision) {
      throw new Error('InteractionFrameStore: layout revision mismatch');
    }
    if (base.revisions.modelRevision !== input.modelRevision) {
      throw new Error('InteractionFrameStore: model revision mismatch');
    }
    const id = this.mintId();
    const revisions: InteractionRevisions = { ...base.revisions, modelRevision: input.modelRevision };
    const frame = this.buildFrame(
      id,
      revisions,
      base.completeness.kind === 'pending' ? base.completeness : { kind: 'complete' },
      base.display,
      base.semanticIndex,
      input.selection,
      input.caret,
      input.selectionGeometry,
      input.focus,
      input.composition,
      input.currentPage,
      {
        display: base.display,
        pageGeometry: base.pageGeometry,
        scrollGeometry: base.scrollGeometry,
      },
    );
    this.attachNavigation(id, undefined, base.id);
    return frame;
  }

  /** Mark derived layout work in flight; retain the last complete frame for reads. */
  beginPendingLayout(targetModelRevision: number): void {
    const base = this.current;
    if (!base) return;
    this.pending = { targetModelRevision, cancelled: false };
    const id = base.id;
    const pendingCompleteness: FrameCompleteness = {
      kind: 'pending',
      awaiting: 'layout',
      targetModelRevision,
    };
    this.current = deepFreezeFrame({
      ...base,
      completeness: deepFreezeValue(pendingCompleteness),
      selection: tagGeometry(id, base.selection),
      caret: tagGeometry(id, base.caret),
      selectionGeometry: tagGeometry(id, base.selectionGeometry),
    });
  }

  private restoreCompleteDiagnostics(): void {
    const base = this.current;
    if (!base || base.completeness.kind !== 'pending') return;
    const id = base.id;
    this.current = deepFreezeFrame({
      ...base,
      completeness: deepFreezeValue({ kind: 'complete' }),
      selection: tagGeometry(id, base.selection),
      caret: tagGeometry(id, base.caret),
      selectionGeometry: tagGeometry(id, base.selectionGeometry),
    });
  }

  cancelPendingLayout(): void {
    if (this.pending) this.pending.cancelled = true;
    this.pending = null;
    this.restoreCompleteDiagnostics();
  }

  /** Complete pending layout unless cancelled or superseded. Returns null when suppressed. */
  tryCompletePendingLayout(input: PublishLayoutInput): InteractionFrame | null {
    if (!this.pending || this.pending.cancelled) {
      this.restoreCompleteDiagnostics();
      return null;
    }
    if (input.modelRevision < this.pending.targetModelRevision) return null;
    if (input.modelRevision > this.pending.targetModelRevision) {
      this.pending = null;
      this.restoreCompleteDiagnostics();
      return null;
    }
    return this.publishLayout(input);
  }
}

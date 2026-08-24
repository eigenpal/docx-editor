// Active editing scope for the paginated surface (header/footer furniture).
//
// Body editing is the default. Opening a header/footer binds
// `EditorScope { kind: 'headerFooter'; rId }` and routes the same semantic input /
// formatting / IME / undo path at that story — never a parallel reduced editor.

import {
  caretStopsForBlocks,
  documentOrder,
  moveCaret,
  paragraphFragmentsOf,
} from '@docx-editor.dev/core/layout';
import type {
  BlockFragmentRecord,
  CaretGeometry,
  HeaderFooterStoryRecord,
  LayoutBox,
  NavigationCommand,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core/layout';
import type { EditorScope, ViewScope } from '../contracts/editor.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import type { OoxmlPart, StoryScope } from '@docx-editor.dev/core/store';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { hitTestFragments, pageAtY, type SemanticHit } from '../layout/semantic-hit-test.ts';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import { lineSegments } from '../layout/line-segments.ts';

export const SCOPE_BODY: ViewScope = Object.freeze({ kind: 'body' as const });

export type HeaderFooterViewScope = Extract<ViewScope, { kind: 'headerFooter' }>;

export interface ActiveHeaderFooterScope {
  readonly scope: HeaderFooterViewScope;
  /** Page whose furniture the user entered (preferred caret/hit target among shared copies). */
  readonly pageIndex: number;
  /**
   * Section the user opened (from `editHeaderFooter` / chrome). When absent, state derives
   * the section from resolution, preferring a declared slot over an inherited one.
   */
  readonly sectionIndex?: number;
  readonly kind: 'header' | 'footer';
  readonly variant: 'default' | 'first' | 'even';
  readonly partName: string;
  /** Body selection restored on exit. */
  readonly savedBodySelection: SemanticSelection;
}

export function isHeaderFooterScope(
  scope: EditorScope | ViewScope | null | undefined
): scope is HeaderFooterViewScope {
  return scope?.kind === 'headerFooter' && typeof scope.rId === 'string' && scope.rId.length > 0;
}

/**
 * The session reads {@link storyScopeOfNodeId} needs. A structural subset, so a caller can
 * hand it either the surface's session or the facade's.
 */
export type StoryScopeLookup = Pick<
  TreeDocxSessionView,
  'part' | 'headerFooterResolutionBySection' | 'partFor'
>;

/**
 * The story a NODE lives in, which is what a write about that node must target.
 *
 * The open scope is a near-enough proxy most of the time and wrong exactly when it matters:
 * nothing binds a node id to it, so a verb invoked on a control, a chip or a paragraph the
 * reader is not currently standing in wrote against the wrong store — or, where the id came
 * from a body-only index, against body content the reader could not see.
 *
 * Answered from the id's own PART NAME. Node ids are minted `${partName}#${path}`, so the
 * question is constant-time and needs no store to be opened. That last part is load-bearing:
 * asking each scope for its paragraph list instead OPENS a story store, the store cap is 64,
 * and a store whose part is still in the package is never evicted — on a many-section
 * document that left later headers unopenable for the rest of the session.
 *
 * Falls back to `fallback` for an id no story claims, so the store refuses it rather than this.
 */
/**
 * The part a NODE lives in, WITHOUT opening a story store.
 *
 * `session.partFor(scope)` resolves a scope by opening that story's store, and an open store is
 * retained for as long as its part is in the package. The cap is 64. So routing a pure READ —
 * "is this control locked", "what is its tab index" — through `partFor` spent a permanent slot
 * per part touched, and an id naming no node at all still spent one, because the part name is
 * matched from the id's prefix before anything is looked up. Sixty-four such reads and no
 * further header could be opened for the rest of the session, silently.
 *
 * Read straight from the live package instead. Ids carry the canonical part name, so this is a
 * map lookup.
 */
export function partOfNodeId(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part'>,
  nodeId: string | undefined
): OoxmlPart | null {
  const hash = nodeId?.indexOf('#') ?? -1;
  if (hash === -1) return null;
  const partName = nodeId!.slice(0, hash);
  if (partName.length === 0) return null;
  return session.currentPackage().parts.get(partName) ?? null;
}

export function storyScopeOfNodeId(
  session: StoryScopeLookup,
  nodeId: string | undefined,
  fallback: StoryScope
): StoryScope {
  const hash = nodeId?.indexOf('#') ?? -1;
  const partName = hash === -1 ? '' : nodeId!.slice(0, hash);
  if (partName.length === 0 || partName === session.part().name) return { kind: 'body' };
  for (const section of session.headerFooterResolutionBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) {
        if (slot.partName === partName) return { kind: 'headerFooter', rId: slot.rId };
      }
    }
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    if (session.partFor({ kind: 'notesPart', noteKind })?.name === partName) {
      return { kind: 'notesPart', noteKind };
    }
  }
  return fallback;
}

export function storyScopeOf(
  active: ActiveHeaderFooterScope | null,
  noteScope?: Extract<ViewScope, { kind: 'note' }> | null
): StoryScope {
  if (active) return { kind: 'headerFooter', rId: active.scope.rId };
  if (noteScope) {
    const parsed = parseNoteScopeId(noteScope.id);
    if (parsed) return { kind: 'notesPart', noteKind: parsed.noteKind };
  }
  return { kind: 'body' };
}

export function viewScopeOf(
  active: ActiveHeaderFooterScope | null,
  noteScope?: Extract<ViewScope, { kind: 'note' }> | null
): ViewScope {
  if (active) return active.scope;
  if (noteScope) return noteScope;
  return SCOPE_BODY;
}

/** Paragraph fragments addressable under the active scope (body / HF / note). */
export function scopedParagraphFragments(
  page: SemanticLayout['pages'][number],
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): ParagraphFragmentRecord[] {
  if (noteScopeId) {
    const notes: ParagraphFragmentRecord[] = [];
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        if (note.scopeId !== noteScopeId) continue;
        notes.push(...paragraphFragmentsFromBlocks(note.fragments));
      }
    }
    return notes;
  }
  if (!active) return paragraphFragmentsOf(page);
  const story = storyOnPage(page, active);
  if (!story) return [];
  return paragraphFragmentsFromBlocks(story.fragments);
}

export function storyOnPage(
  page: SemanticLayout['pages'][number],
  active: HeaderFooterScopeBinding
): HeaderFooterStoryRecord | undefined {
  const candidate = active.kind === 'header' ? page.header : page.footer;
  if (!candidate) return undefined;
  if (candidate.rId && candidate.rId === active.scope.rId) return candidate;
  if (!candidate.rId && candidate.partName === active.partName) return candidate;
  return undefined;
}

export function findStoryForRId(
  layout: SemanticLayout,
  rId: string
): {
  pageIndex: number;
  kind: 'header' | 'footer';
  story: HeaderFooterStoryRecord;
} | null {
  for (const page of layout.pages) {
    for (const kind of ['header', 'footer'] as const) {
      const story = page[kind];
      if (story?.rId === rId) return { pageIndex: page.index, kind, story };
    }
  }
  return null;
}

/** Binding fields the pointer layer needs without saved body selection. */
export type HeaderFooterScopeBinding = Pick<
  ActiveHeaderFooterScope,
  'scope' | 'pageIndex' | 'kind' | 'partName' | 'variant'
>;

export function storyMatchesBinding(
  story: HeaderFooterStoryRecord,
  active: HeaderFooterScopeBinding
): boolean {
  if (story.rId && story.rId === active.scope.rId) return true;
  if (!story.rId && story.partName === active.partName && story.kind === active.kind) return true;
  return false;
}

export function isBodyContentPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): boolean {
  const pageIndex = pageAtY(layout, sheet.y);
  const page = layout.pages[pageIndex];
  if (!page) return false;
  const x = sheet.x - pageOffsetX(pageIndex);
  const y = sheet.y;
  const box = page.contentBox;
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

export function hitTestStoryAtLocalPoint(
  layout: SemanticLayout,
  pageIndex: number,
  story: HeaderFooterStoryRecord,
  local: { readonly x: number; readonly y: number },
  options: { readonly measurer?: TextMeasurer } = {}
): SemanticHit | null {
  return hitTestFragments(layout, pageIndex, story.fragments, local, options);
}

/**
 * Story-scoped caret stops for an open header/footer. Coordinates stay story-relative so
 * arrow navigation follows tab advances and projected field atoms without mixing body sheet
 * offsets.
 */
export function activeStoryCaretStops(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding,
  measurer?: TextMeasurer
): CaretGeometry[] | null {
  const page = layout.pages[active.pageIndex] ?? layout.pages[0];
  if (!page) return null;
  const story = storyOnPage(page, active);
  if (!story) return null;
  return caretStopsForBlocks(layout, active.pageIndex, story.fragments, measurer);
}

/** Story-scoped caret stops for one open footnote/endnote, including continuations. */
export function activeNoteCaretStops(
  layout: SemanticLayout,
  scopeId: string,
  measurer?: TextMeasurer
): CaretGeometry[] | null {
  const stops: CaretGeometry[] = [];
  for (const page of layout.pages) {
    for (const area of [page.footnotes, page.endnotes]) {
      const note = area?.notes.find((candidate) => candidate.scopeId === scopeId);
      if (!note) continue;
      stops.push(...caretStopsForBlocks(layout, page.index, note.fragments, measurer));
    }
  }
  return stops.length > 0 ? stops : null;
}

/** Active `[data-docx-hf-active]` host for the preferred furniture page, if any. */
export function furnitureCaretHost(pagesLayer: HTMLElement, pageIndex: number): HTMLElement | null {
  return (
    pagesLayer.querySelector<HTMLElement>(
      `[data-page-index="${pageIndex}"] > [data-docx-hf-active]`
    ) ?? pagesLayer.querySelector<HTMLElement>('[data-docx-hf-active]')
  );
}

/** Painted note host for scoped caret geometry (which is relative to the note story). */
export function noteCaretHost(
  pagesLayer: HTMLElement,
  scopeId: string,
  preferredPageIndex?: number | null
): HTMLElement | null {
  const candidates = pagesLayer.querySelectorAll<HTMLElement>('[data-docx-note-scope]');
  let first: HTMLElement | null = null;
  for (const candidate of candidates) {
    if (candidate.dataset.docxNoteScope !== scopeId || !candidate.matches('[data-docx-note]')) {
      continue;
    }
    first ??= candidate;
    const pageIndex = Number(
      candidate.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex
    );
    if (preferredPageIndex !== null && pageIndex === preferredPageIndex) return candidate;
  }
  return first;
}

/**
 * Prefer the caller's visual occurrence when it still hosts the open story; otherwise the
 * lowest materialized page with that story, else the lowest page that paints it at all.
 *
 * Keeps one caret host after scroll/dematerialization without inventing a second selection.
 */
export function resolvePreferredFurniturePage(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding,
  materialized?: ReadonlySet<number>
): number {
  const hostsStory = (pageIndex: number): boolean => {
    const page = layout.pages[pageIndex];
    return !!page && !!storyOnPage(page, active);
  };
  if (
    hostsStory(active.pageIndex) &&
    (materialized === undefined || materialized.has(active.pageIndex))
  ) {
    return active.pageIndex;
  }
  let firstAny: number | null = null;
  for (const page of layout.pages) {
    if (!storyOnPage(page, active)) continue;
    if (firstAny === null) firstAny = page.index;
    if (materialized === undefined || materialized.has(page.index)) return page.index;
  }
  return firstAny ?? active.pageIndex;
}

/** Pointer-layer snapshot of an open furniture scope. */
export function pointerHeaderFooterState(active: ActiveHeaderFooterScope | null): {
  rId: string;
  pageIndex: number;
  kind: 'header' | 'footer';
  partName: string;
  variant: 'default' | 'first' | 'even';
} | null {
  if (!active) return null;
  return {
    rId: active.scope.rId,
    pageIndex: active.pageIndex,
    kind: active.kind,
    partName: active.partName,
    variant: active.variant,
  };
}

/** Screen-only chrome classes while a furniture scope is open (print CSS resets opacity). */
export function setHeaderFooterEditingChrome(
  container: HTMLElement,
  pagesLayer: HTMLElement,
  editing: boolean
): void {
  container.classList.toggle('docx-paginated-surface--hf-editing', editing);
  pagesLayer.classList.toggle('docx-pages--hf-editing', editing);
}

/**
 * Screen-only chrome for the editing mode.
 *
 * Viewing mode must show no WRITE affordance, and the blank header/footer band's
 * "double-click to add" hover is one the painter cannot know about. The class has to be
 * written on every mode change, not only on a repaint: `setEditingMode` moves the mode
 * without moving the document, so a reader who switched to Viewing kept the invitation
 * until some unrelated edit repainted the pages.
 */
export function setEditingModeChrome(container: HTMLElement, mode: SurfaceEditingMode): void {
  container.classList.toggle('docx-paginated-surface--viewing', mode === 'view');
}

/** Move the caret within body stops or an open furniture/note story's stops. */
export function navigateInActiveScope(
  layout: SemanticLayout,
  position: SemanticPosition,
  command: NavigationCommand,
  desiredX: number | null,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null,
  measurer?: TextMeasurer
): { position: SemanticPosition; desiredX: number | null; pageIndex?: number } | null {
  const storyStops = active
    ? activeStoryCaretStops(layout, active, measurer)
    : noteScopeId
      ? activeNoteCaretStops(layout, noteScopeId, measurer)
      : null;
  const moved = moveCaret(layout, position, command, desiredX, {
    ...(measurer ? { measurer } : {}),
    ...(storyStops ? { stops: storyStops } : {}),
  });
  if (!moved) return null;
  if (!storyStops) return moved;
  // Prefer an exact stop match so continuation-page geometry carries its pageIndex through
  // word/line gestures that rebuild the position without returning the stop itself.
  const stop = storyStops.find(
    (candidate) =>
      candidate.position.paragraphId === moved.position.paragraphId &&
      candidate.position.offset === moved.position.offset
  );
  return stop ? { ...moved, pageIndex: stop.pageIndex } : moved;
}

export function findNoteAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): {
  pageIndex: number;
  scopeId: string;
  noteKind: 'footnote' | 'endnote';
  noteId: number;
  local: { x: number; y: number };
  fragments: readonly BlockFragmentRecord[];
} | null {
  for (const page of layout.pages) {
    const ox = pageOffsetX(page.index);
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        const box = note.box;
        const left = box.x + ox;
        const top = box.y;
        if (
          sheet.x >= left &&
          sheet.x < left + box.width &&
          sheet.y >= top &&
          sheet.y < top + box.height
        ) {
          return {
            pageIndex: page.index,
            scopeId: note.scopeId,
            noteKind: note.noteKind,
            noteId: note.noteId,
            local: { x: sheet.x - left, y: sheet.y - top },
            fragments: note.fragments,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Word-style furniture activation band: the full header/footer margin region, not only
 * the flowed story box. Story content is often a thin strip inside a much taller margin;
 * clicks in that whitespace must still open the story.
 */
export function furnitureActivationBox(
  page: PageRecord,
  kind: 'header' | 'footer'
): LayoutBox | null {
  const story = page[kind];
  const content = page.contentBox;
  const sheet = page.box;
  if (kind === 'header') {
    const top = sheet.y;
    const bottom = content.y;
    const bandBottom = story ? Math.max(bottom, story.box.y + story.box.height) : bottom;
    const bandTop = story ? Math.min(top, story.box.y) : top;
    if (bandBottom <= bandTop) return null;
    return {
      x: content.x,
      y: bandTop,
      width: content.width,
      height: bandBottom - bandTop,
    };
  }
  const top = content.y + content.height;
  const bottom = sheet.y + sheet.height;
  const bandTop = story ? Math.min(top, story.box.y) : top;
  const bandBottom = story ? Math.max(bottom, story.box.y + story.box.height) : bottom;
  if (bandBottom <= bandTop) return null;
  return {
    x: content.x,
    y: bandTop,
    width: content.width,
    height: bandBottom - bandTop,
  };
}

/**
 * The header/footer margin band of a page that has NO story of that kind, or null.
 *
 * The counterpart of {@link findStoryAtSheetPoint} for blank furniture: Word lets a reader
 * double-click the empty top margin to create and open a header, and the hit test has to
 * answer from geometry because there is nothing painted to hit.
 */
export function findEmptyFurnitureBandAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): { pageIndex: number; kind: 'header' | 'footer' } | null {
  for (const page of layout.pages) {
    const ox = pageOffsetX(page.index);
    for (const kind of ['header', 'footer'] as const) {
      if (page[kind]) continue;
      const band = furnitureActivationBox(page, kind);
      if (!band) continue;
      const left = band.x + ox;
      if (
        sheet.x >= left &&
        sheet.x < left + band.width &&
        sheet.y >= band.y &&
        sheet.y < band.y + band.height
      ) {
        return { pageIndex: page.index, kind };
      }
    }
  }
  return null;
}

export function findStoryAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): {
  pageIndex: number;
  kind: 'header' | 'footer';
  story: HeaderFooterStoryRecord;
  local: { x: number; y: number };
} | null {
  for (const page of layout.pages) {
    const ox = pageOffsetX(page.index);
    for (const kind of ['header', 'footer'] as const) {
      const story = page[kind];
      if (!story) continue;
      // Prefer the tight story box when the point is inside it (correct local coords for
      // caret placement); otherwise accept the wider margin activation band.
      const tight = story.box;
      const band = furnitureActivationBox(page, kind) ?? tight;
      const left = band.x + ox;
      const top = band.y;
      if (
        sheet.x >= left &&
        sheet.x < left + band.width &&
        sheet.y >= top &&
        sheet.y < top + band.height
      ) {
        // Local coords stay relative to the story box origin so hit-testing / caret stops
        // remain story-relative even when the press landed in margin whitespace.
        return {
          pageIndex: page.index,
          kind,
          story,
          local: { x: sheet.x - (tight.x + ox), y: sheet.y - tight.y },
        };
      }
    }
  }
  return null;
}

/**
 * Document-order paragraph ids for the active scope (deduped across shared page copies).
 *
 * Body (no HF / no note) falls through to memoized {@link documentOrder} so per-keystroke
 * callers of `paragraphOrder()` reuse the semantic-interaction WeakMap instead of rebuilding
 * a Set+array over every page. HF and note scopes stay explicitly bounded to their story
 * fragments — those paths are small and must not leak body ids.
 */
export function scopedDocumentOrder(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): string[] {
  if (!active && !noteScopeId) return documentOrder(layout);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of scopedParagraphFragments(page, active, noteScopeId)) {
      // From the LINES, the way `documentOrder` reads the body. A resolved display mode lays a
      // run of paragraphs out as ONE fragment named after the survivor, and a paragraph missing
      // from this order compares as before every other one — which would put a selection
      // anchored in it at the top of the story.
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          if (seen.has(segment.paragraphId)) continue;
          seen.add(segment.paragraphId);
          order.push(segment.paragraphId);
        }
      }
      if (fragment.lines.length === 0 && !seen.has(fragment.paragraphId)) {
        seen.add(fragment.paragraphId);
        order.push(fragment.paragraphId);
      }
    }
  }
  return order;
}

export function clampSelectionToScope(
  layout: SemanticLayout,
  selection: SemanticSelection,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): SemanticSelection {
  const order = scopedDocumentOrder(layout, active, noteScopeId);
  if (order.length === 0) return selection;
  const allowed = new Set(order);
  const clamp = (position: SemanticPosition): SemanticPosition => {
    if (allowed.has(position.paragraphId)) return position;
    return { paragraphId: order[0]!, offset: 0 };
  };
  return { anchor: clamp(selection.anchor), head: clamp(selection.head) };
}

function paragraphFragmentsFromBlocks(
  blocks: readonly BlockFragmentRecord[]
): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  return found;
}

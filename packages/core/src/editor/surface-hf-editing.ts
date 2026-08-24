// Header/footer scope enter/exit for the paginated surface.
//
// Keeps the composition root under the max-lines budget while owning the furniture
// scope transitions that bind EditorScope { kind: 'headerFooter', rId }.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type {
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import type { ViewScope } from '../contracts/editor.ts';
import { enumerateDocumentSections } from '../layout/section-properties.ts';
import {
  type ActiveHeaderFooterScope,
  clampSelectionToScope,
  findStoryForRId,
  resolvePreferredFurniturePage,
  storyOnPage,
  storyScopeOf,
  viewScopeOf,
} from './surface-scope.ts';

export type HeaderFooterStateSnapshot = {
  readonly editing: 'header' | 'footer' | null;
  readonly sectionIndex: number;
  readonly variant?: 'default' | 'first' | 'even';
  readonly rId?: string;
  readonly partName?: string;
  readonly inherited?: boolean;
  readonly titlePage?: boolean;
  readonly evenAndOddHeaders?: boolean;
  /** Section `w:pgMar w:header` — header distance from sheet edge, twips. */
  readonly headerDistanceTwips?: number;
  /** Section `w:pgMar w:footer` — footer distance from sheet edge, twips. */
  readonly footerDistanceTwips?: number;
};

export interface HeaderFooterScopeController {
  getActive(): ActiveHeaderFooterScope | null;
  activeScope(): ViewScope;
  setActiveScope(scope: ViewScope): boolean;
  enterHeaderFooter(args: {
    readonly rId: string;
    readonly pageIndex?: number;
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly position?: SemanticPosition;
  }): boolean;
  exitHeaderFooter(): void;
  /**
   * Keep the visual occurrence on a page that still paints the open story after
   * scroll/materialization. Does not change canonical selection or EditorScope.
   */
  reconcileOccurrence(): void;
  headerFooterState(): HeaderFooterStateSnapshot | null;
  /** Stable frozen snapshot for Editor.getHeaderFooterState / selectors. */
  headerFooterStateStable(packageRevision: number): HeaderFooterStateSnapshot | null;
}

export function createHeaderFooterScopeController(deps: {
  session: TreeDocxSessionView;
  layout(): SemanticLayout;
  /**
   * The section a painted page belongs to.
   *
   * One header part can be the default of SEVERAL sections, so "the first section that names
   * this rId" is a different page's geometry from the one the reader is on. Binding the
   * PAINTED page's section is what keeps a programmatic entry agreeing with a pointer entry,
   * which already forwards it.
   */
  sectionAtPage(pageIndex: number): { sectionIndex: number; sectionStart: number };
  selection(): SemanticSelection;
  setScopeSelection(next: SemanticSelection): void;
  noteModelMoved(): void;
  render(): void;
  mirrorToDom(): void;
  notify(): void;
  /** Pages currently built in the viewport; absent/undefined treats every page as available. */
  materializedPages?(): ReadonlySet<number> | undefined;
  /**
   * Whether entering a furniture story is refused right now.
   *
   * Asked HERE rather than at each caller because there are three of them — the pointer's
   * double click, the surface's own `enterHeaderFooter`, and `setActiveScope` — and gating
   * one left the other two opening the dimmed body, the active band and the whole
   * header options bar on a document open for viewing.
   */
  entryRefused?(): boolean;
  /**
   * Close any OTHER story that is open before this one takes over.
   *
   * Two stories cannot both be the reader's. A note left open behind a header put the two
   * scope resolvers into disagreement — one answers by header first, the other by note first
   * — so `paragraphOrder()` listed the note's paragraphs while the selection sat in the
   * header, and Select All followed by typing was refused as `unknown-paragraph`. The pointer
   * path already refuses to cross stories; the toolbar command and the review rail did not.
   */
  leaveOtherStories?(): void;
}): HeaderFooterScopeController {
  let activeHf: ActiveHeaderFooterScope | null = null;
  let cachedState: HeaderFooterStateSnapshot | null = null;
  let cachedStateKey = '';

  const reconcileOccurrence = (): void => {
    if (!activeHf) return;
    const next = resolvePreferredFurniturePage(deps.layout(), activeHf, deps.materializedPages?.());
    if (next === activeHf.pageIndex) return;
    // The SECTION moves with the page. `resolvePreferredFurniturePage` scans every page
    // hosting this story and takes the first materialized one, and for a header shared across
    // sections that page can be in a different section from the one bound at entry. Carrying
    // the old index over meant a repagination or a scroll left the bound section pointing at a
    // page the reader is no longer on — the same wrong-section write the entry path was just
    // fixed for, arriving by a different route.
    activeHf = {
      ...activeHf,
      pageIndex: next,
      sectionIndex: deps.sectionAtPage(next).sectionIndex,
    };
  };

  const enterHeaderFooter = (args: {
    readonly rId: string;
    readonly pageIndex?: number;
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly position?: SemanticPosition;
  }): boolean => {
    // Re-entering the story that is ALREADY open is a caret move inside it, not an entry —
    // a mode that changed under an open band must not strand the caret there.
    if (deps.entryRefused?.() === true && activeHf?.scope.rId !== args.rId) return false;
    if (!args.rId || deps.session.partFor({ kind: 'headerFooter', rId: args.rId }) === null) {
      return false;
    }
    // Before anything is resolved against it: leaving a note re-scopes the layout this entry
    // reads, so doing it afterwards would resolve the header against the note's order.
    if (activeHf?.scope.rId !== args.rId) deps.leaveOtherStories?.();
    const layout = deps.layout();
    const found = findStoryForRId(layout, args.rId);
    const prior = activeHf;
    const alreadyOpen = prior?.scope.rId === args.rId;
    // Even (or first) furniture may not paint on the current page set — e.g. even on a
    // one-page document. Fall back to package resolution so programmatic editHeaderFooter
    // can still open the story after create.
    const fromPackage = found ? null : resolveFurnitureByRId(deps.session, args.rId);
    if (!found && !fromPackage) return false;

    const pageIndex =
      args.pageIndex ?? (alreadyOpen && prior ? prior.pageIndex : (found?.pageIndex ?? 0));
    const kind =
      args.kind ?? (alreadyOpen && prior ? prior.kind : (found?.kind ?? fromPackage!.kind));
    const variant =
      args.variant ??
      (alreadyOpen && prior ? prior.variant : (found?.story.variant ?? fromPackage!.variant));
    const partName =
      alreadyOpen && prior ? prior.partName : (found?.story.partName ?? fromPackage!.partName);
    const page = layout.pages[pageIndex] ?? layout.pages[found?.pageIndex ?? 0];
    const story = (page
      ? storyOnPage(page, {
          scope: { kind: 'headerFooter', rId: args.rId },
          pageIndex,
          kind,
          variant,
          partName,
        })
      : null) ??
      found?.story ?? {
        scope: { kind: 'headerFooter' as const, rId: args.rId },
        pageIndex,
        kind,
        variant,
        partName,
      };

    const selection = deps.selection();
    const savedBodySelection = prior
      ? prior.savedBodySelection
      : {
          anchor: { ...selection.anchor },
          head: { ...selection.head },
        };

    // The PAGE the reader is on decides the section, and only a re-scope that names no new
    // page keeps the prior one.
    //
    // Leaving this undefined for a painted story sent every downstream reader to "the first
    // section naming this rId" — which, for a header shared by several sections, is not the
    // page the reader is looking at. Page Setup then wrote that other section's `w:sectPr` and
    // the ruler clamped to its geometry. Keeping the prior section when the caller DID name a
    // new page is the same defect a step later: the page moves and the section it belongs to
    // does not.
    const staysOnPriorPage =
      alreadyOpen && prior?.sectionIndex !== undefined && pageIndex === prior.pageIndex;
    const sectionIndex =
      args.sectionIndex ??
      (staysOnPriorPage
        ? prior.sectionIndex
        : found
          ? deps.sectionAtPage(pageIndex).sectionIndex
          : fromPackage?.sectionIndex);

    activeHf = {
      scope: { kind: 'headerFooter', rId: args.rId },
      pageIndex,
      ...(sectionIndex !== undefined ? { sectionIndex } : {}),
      kind,
      variant: story.variant,
      partName: story.partName,
      savedBodySelection,
    };

    const ids = deps.session.paragraphIdsIn(storyScopeOf(activeHf));
    const first = ids[0];
    if (!first) {
      activeHf = null;
      return false;
    }
    // Same shared part, new visual occurrence: keep the canonical selection unless the
    // pointer supplied a position. Fresh enter still starts at the story head.
    const next = args.position
      ? clampSelectionToScope(layout, { anchor: args.position, head: args.position }, activeHf)
      : alreadyOpen
        ? clampSelectionToScope(layout, selection, activeHf)
        : {
            anchor: { paragraphId: first, offset: 0 },
            head: { paragraphId: first, offset: 0 },
          };
    deps.setScopeSelection(next);
    deps.noteModelMoved();
    deps.render();
    deps.mirrorToDom();
    deps.notify();
    return true;
  };

  const exitHeaderFooter = (): void => {
    if (!activeHf) return;
    const restore = activeHf.savedBodySelection;
    activeHf = null;
    deps.setScopeSelection(clampSelectionToScope(deps.layout(), restore, null));
    deps.noteModelMoved();
    deps.render();
    deps.mirrorToDom();
    deps.notify();
  };

  return {
    getActive: () => activeHf,
    activeScope: () => viewScopeOf(activeHf),
    setActiveScope(scope) {
      if (scope.kind === 'body') {
        exitHeaderFooter();
        return true;
      }
      if (scope.kind === 'headerFooter') {
        return enterHeaderFooter({ rId: scope.rId });
      }
      return false;
    },
    enterHeaderFooter,
    exitHeaderFooter,
    reconcileOccurrence,
    headerFooterState() {
      if (!activeHf) return null;
      const bySection = deps.session.headerFooterResolutionBySection();
      let sectionIndex = activeHf.sectionIndex ?? 0;
      let inherited: boolean | undefined;
      let titlePage: boolean | undefined;
      let evenAndOddHeaders: boolean | undefined;

      const applySection = (index: number): boolean => {
        const section = bySection[index];
        if (!section) return false;
        const slots = activeHf!.kind === 'header' ? section.headers : section.footers;
        const slot = slots.get(activeHf!.variant);
        if (!slot || slot.rId !== activeHf!.scope.rId) return false;
        sectionIndex = index;
        inherited = slot.inherited;
        titlePage = section.titlePage;
        evenAndOddHeaders = section.evenAndOddHeaders;
        return true;
      };

      if (!(activeHf.sectionIndex !== undefined && applySection(activeHf.sectionIndex))) {
        // Shared rIds appear in multiple sections — prefer declared over inherited, then
        // the lowest section index, so chrome "Same as Previous" matches the authored ref.
        let bestInherited: boolean | undefined;
        bySection.forEach((section, index) => {
          const slots = activeHf!.kind === 'header' ? section.headers : section.footers;
          const slot = slots.get(activeHf!.variant);
          if (!slot || slot.rId !== activeHf!.scope.rId) return;
          const better =
            bestInherited === undefined ||
            (bestInherited && !slot.inherited) ||
            (bestInherited === slot.inherited && index < sectionIndex);
          if (!better) return;
          sectionIndex = index;
          inherited = slot.inherited;
          titlePage = section.titlePage;
          evenAndOddHeaders = section.evenAndOddHeaders;
          bestInherited = slot.inherited;
        });
      }
      const sections = enumerateDocumentSections(deps.session.part());
      const sectionProps = sections[sectionIndex]?.properties ?? sections.at(-1)?.properties;
      const headerDistanceTwips = sectionProps?.margins.headerTwips;
      const footerDistanceTwips = sectionProps?.margins.footerTwips;
      return {
        editing: activeHf.kind,
        sectionIndex,
        variant: activeHf.variant,
        rId: activeHf.scope.rId,
        partName: activeHf.partName,
        ...(inherited !== undefined ? { inherited } : {}),
        ...(titlePage !== undefined ? { titlePage } : {}),
        ...(evenAndOddHeaders !== undefined ? { evenAndOddHeaders } : {}),
        ...(headerDistanceTwips !== undefined ? { headerDistanceTwips } : {}),
        ...(footerDistanceTwips !== undefined ? { footerDistanceTwips } : {}),
      };
    },
    headerFooterStateStable(packageRevision) {
      if (!activeHf) {
        cachedState = null;
        cachedStateKey = '';
        return null;
      }
      const fresh = this.headerFooterState();
      if (!fresh) return null;
      const key = [
        packageRevision,
        fresh.editing,
        fresh.sectionIndex,
        fresh.variant ?? '',
        fresh.rId ?? '',
        fresh.partName ?? '',
        String(fresh.inherited),
        String(fresh.titlePage),
        String(fresh.evenAndOddHeaders),
        String(fresh.headerDistanceTwips ?? ''),
        String(fresh.footerDistanceTwips ?? ''),
      ].join('|');
      if (cachedState && cachedStateKey === key) return cachedState;
      cachedState = Object.freeze({ ...fresh });
      cachedStateKey = key;
      return cachedState;
    },
  };
}

/** Lifecycle op kinds the surface may commit as package-level undo units. */
export type SurfaceLifecycleOp = Extract<
  TreeDocOp,
  | { op: 'createHeaderFooter' }
  | { op: 'deleteHeaderFooter' }
  | { op: 'linkToPrevious' }
  | { op: 'unlinkFromPrevious' }
  | { op: 'setSectionFurnitureOptions' }
>;

function resolveFurnitureByRId(
  session: TreeDocxSessionView,
  rId: string
): {
  readonly sectionIndex: number;
  readonly kind: 'header' | 'footer';
  readonly variant: 'default' | 'first' | 'even';
  readonly partName: string;
} | null {
  const bySection = session.headerFooterResolutionBySection();
  for (let sectionIndex = 0; sectionIndex < bySection.length; sectionIndex += 1) {
    const section = bySection[sectionIndex]!;
    for (const kind of ['header', 'footer'] as const) {
      const slots = kind === 'header' ? section.headers : section.footers;
      for (const [variant, slot] of slots) {
        if (slot.rId === rId) {
          return { sectionIndex, kind, variant, partName: slot.partName };
        }
      }
    }
  }
  return null;
}

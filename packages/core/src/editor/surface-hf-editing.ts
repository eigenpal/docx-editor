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
  selection(): SemanticSelection;
  setScopeSelection(next: SemanticSelection): void;
  noteModelMoved(): void;
  render(): void;
  mirrorToDom(): void;
  notify(): void;
  /** Pages currently built in the viewport; absent/undefined treats every page as available. */
  materializedPages?(): ReadonlySet<number> | undefined;
}): HeaderFooterScopeController {
  let activeHf: ActiveHeaderFooterScope | null = null;
  let cachedState: HeaderFooterStateSnapshot | null = null;
  let cachedStateKey = '';

  const reconcileOccurrence = (): void => {
    if (!activeHf) return;
    const next = resolvePreferredFurniturePage(deps.layout(), activeHf, deps.materializedPages?.());
    if (next === activeHf.pageIndex) return;
    activeHf = { ...activeHf, pageIndex: next };
  };

  const enterHeaderFooter = (args: {
    readonly rId: string;
    readonly pageIndex?: number;
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly position?: SemanticPosition;
  }): boolean => {
    if (!args.rId || deps.session.partFor({ kind: 'headerFooter', rId: args.rId }) === null) {
      return false;
    }
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

    const sectionIndex =
      args.sectionIndex ??
      (alreadyOpen && prior?.sectionIndex !== undefined
        ? prior.sectionIndex
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

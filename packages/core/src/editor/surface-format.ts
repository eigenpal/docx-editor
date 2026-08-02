// Run and paragraph property edits at the selection (paginated-surface seam).
//
// The formatting lane: toggling a run property, setting one outright, and setting a
// paragraph property. They share one rule the structural edits do not — a change that
// covers a WHOLE paragraph also writes its mark, because that is what a list marker
// inherits its face from.

import type { TreeApplyResult, TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import {
  documentOrder,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import {
  directParagraphMarkProperties,
  directParagraphProperties,
  formattingAt,
  isRunPropertyActive,
  mergedProperties,
  paragraphMarkOps,
  runPropertyEdits,
  type SurfaceProperty,
} from './surface-formatting.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** What the composition root lends this lane. */
export interface SurfaceFormatDeps {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null
  ): void;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  textOf(paragraphId: string): string;
  /**
   * The cells a rectangular table selection covers, when one is live.
   *
   * A rectangle is NOT the text range it stands in for: rows one and two of column one, read
   * as a range, sweep through every cell between them — so a toolbar reading the range
   * reports formatting from cells the user never selected.
   */
  selectedCells?(): readonly string[] | undefined;
}

type FormatMethods = Pick<
  PaginatedSurface,
  'setRunProperty' | 'setParagraphProperty' | 'toggleRunProperty' | 'formatting'
>;

export function createSurfaceFormat(deps: SurfaceFormatDeps): FormatMethods {
  const { session, commit, orderedRange, selectionMark, textOf } = deps;
  const currentLayout = {
    get value(): SemanticLayout {
      return deps.layout();
    },
  };
  const selectionNow = {
    get value(): SemanticSelection {
      return deps.selection();
    },
  };

  /**
   * Write one run property across the range: one op per run it covers, each stating that
   * run's own properties plus the incoming one, and — when the range is a whole paragraph —
   * the same change to the paragraph mark over the mark's own properties.
   *
   * Every base comes from the canonical tree rather than the layout, because the layout
   * publishes the cascade and an op that restates the cascade is either refused outright or
   * silently freezes inherited formatting as direct — see `runPropertyEdits`.
   */
  const writeRunProperty = (
    from: SemanticPosition,
    to: SemanticPosition,
    incoming: SurfaceProperty
  ): void => {
    const part = session.part();
    const edits = runPropertyEdits(part, from.paragraphId, from.offset, to.offset, incoming);
    // No run in range means nothing was formatted, so the mark must not move either.
    if (edits.length === 0) return;
    const markProperties = mergedProperties(
      directParagraphMarkProperties(part, from.paragraphId),
      incoming
    );
    commit(() =>
      session.applyTreeOps(
        [
          ...edits.map((edit) => ({
            op: 'setRunProperties' as const,
            paragraphId: from.paragraphId,
            start: edit.start,
            end: edit.end,
            properties: edit.properties,
          })),
          ...paragraphMarkOps(textOf(from.paragraphId), from, to, markProperties),
        ],
        selectionMark()
      )
    );
  };

  return {
    setRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      writeRunProperty(from, to, { localName, ...(attributes ? { attributes } : {}) });
    },

    setParagraphProperty(localName, attributes) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return;
      // EVERY paragraph the selection touches, not just the one the caret is in: selecting
      // three paragraphs and pressing centre must centre three paragraphs.
      //
      // Merged against what each paragraph ITSELF authors, never the cascade the layout
      // publishes: the op replaces the properties it names and drops the ones it does not,
      // so its base has to be the paragraph's own `w:pPr` — see `directParagraphProperties`.
      const ops = order.slice(firstIndex, lastIndex + 1).map((paragraphId) => ({
        op: 'setParagraphProperties' as const,
        paragraphId,
        properties: mergedProperties(directParagraphProperties(session.part(), paragraphId), {
          localName,
          ...(attributes ? { attributes } : {}),
        }),
      }));
      if (ops.length === 0) return;
      commit(() => session.applyTreeOps(ops, selectionMark()));
    },

    formatting: () =>
      formattingAt(
        currentLayout.value,
        selectionNow.value,
        (paragraphId: string, runProperties) =>
          session.effectiveRunDefaults(paragraphId, runProperties),
        deps.selectedCells?.()
      ),

    toggleRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      // A collapsed caret has no range to format. Stored marks — formatting that applies to
      // the NEXT character typed — are a separate lane; refusing is honest rather than
      // formatting a character the user did not select.
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      const active = isRunPropertyActive(
        currentLayout.value,
        selectionNow.value,
        localName,
        deps.selectedCells?.()
      );
      writeRunProperty(
        from,
        to,
        active
          ? // Toggling OFF sends an explicit `val="0"` rather than dropping the element: the
            // property may be inherited from a style, and removing the local override would
            // let the inherited value come back. `w:u` is a closed enumeration, not a
            // boolean: its off value is `none`, and `val="0"` is one Word rejects outright.
            { localName, attributes: { val: localName === 'u' ? 'none' : '0' } }
          : { localName, ...(attributes ? { attributes } : {}) }
      );
    },
  };
}

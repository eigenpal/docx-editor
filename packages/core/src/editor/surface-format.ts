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
  isAuthorableRunProperty,
  isRunPropertyActive,
  mergedProperties,
  paragraphMarkOps,
  pendingPropertyState,
  runPropertyEdits,
  withPendingFormatting,
  type SurfaceProperty,
} from './surface-formatting.ts';
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import { paragraphsInCells } from '@docx-editor.dev/core-contract/layout';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** What the composition root lends this lane. */
export interface SurfaceFormatDeps {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null,
    options?: { readonly keepCellSelection?: boolean }
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
  /**
   * The stored-marks lane: run properties armed at a collapsed caret, applied to the next
   * characters typed there. Owned by the composition root because IT knows when the caret
   * moves (which discards them) and when `type()` consumes them.
   */
  pendingFormats(): readonly SurfaceProperty[] | null;
  setPendingFormats(next: readonly SurfaceProperty[] | null): void;
  /**
   * The document's default paragraph style, so a paragraph that names none reports the
   * style it is actually written in rather than nothing.
   */
  defaultParagraphStyleId?(): string | null;
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
   * Write one run property across the selected range — however many paragraphs it spans.
   *
   * One op per run the range covers, each stating that run's own properties plus the
   * incoming one, and — for every paragraph the range covers WHOLE — the same change to that
   * paragraph's mark over the mark's own properties.
   *
   * The range is walked the same way `deleteRangeOps` walks it: the tail of the first
   * paragraph, every paragraph in between entire, then the head of the last. Formatting used
   * to stop at the first pilcrow, which left the whole run-formatting half of the toolbar
   * disabled on a cross-paragraph selection while the READS (already range-wide) reported
   * state no control could change.
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
    if (from.paragraphId === to.paragraphId) {
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
      return;
    }
    const order = documentOrder(currentLayout.value);
    const firstIndex = order.indexOf(from.paragraphId);
    const lastIndex = order.indexOf(to.paragraphId);
    // An endpoint the published order does not know is a layout that has not caught up;
    // writing a partial range would be worse than writing none.
    if (firstIndex === -1 || lastIndex === -1) return;
    const ops: TreeDocOp[] = [];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const paragraphId = order[index]!;
      const text = textOf(paragraphId);
      const start = index === firstIndex ? from.offset : 0;
      const end = index === lastIndex ? to.offset : text.length;
      const edits = start < end ? runPropertyEdits(part, paragraphId, start, end, incoming) : [];
      for (const edit of edits) {
        ops.push({
          op: 'setRunProperties',
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
        });
      }
      // The mark follows a paragraph the range covers WHOLE and no other: that is what a
      // list marker inherits its face from, and formatting part of a paragraph must not
      // restyle its pilcrow. An empty paragraph between the endpoints is covered whole by
      // definition and has no run to carry the change, so its mark is the only place the
      // format can live — without it, typing into that line came out unformatted.
      const covered =
        index > firstIndex && index < lastIndex
          ? true
          : start === 0 && end === text.length && text.length > 0;
      if (covered && (edits.length > 0 || text.length === 0)) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId,
          properties: mergedProperties(directParagraphMarkProperties(part, paragraphId), incoming),
        });
      }
    }
    if (ops.length === 0) return;
    commit(() => session.applyTreeOps(ops, selectionMark()));
  };

  /**
   * Write one run property over every paragraph of a rectangular cell selection.
   *
   * The read side already reports the CELLS rather than the range they stand in for, so the
   * write has to match or the toolbar shows a state its own button cannot change — pressing
   * Bold over selected cells was a silent no-op, because a rectangle spans several paragraphs
   * and the single-paragraph guard refused every one of them.
   */
  const writeRunPropertyOverCells = (
    cells: readonly string[],
    incoming: SurfaceProperty
  ): boolean => {
    const part = session.part();
    const ops: TreeDocOp[] = [];
    for (const paragraphId of paragraphsInCells(currentLayout.value, cells)) {
      const text = textOf(paragraphId);
      if (text.length === 0) continue;
      for (const edit of runPropertyEdits(part, paragraphId, 0, text.length, incoming)) {
        ops.push({
          op: 'setRunProperties' as const,
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
        });
      }
      ops.push({
        op: 'setParagraphMarkProperties' as const,
        paragraphId,
        properties: mergedProperties(directParagraphMarkProperties(part, paragraphId), incoming),
      });
    }
    if (ops.length === 0) return false;
    // Word leaves the cells selected after formatting them, so the rectangle survives.
    commit(() => session.applyTreeOps(ops, selectionMark()), undefined, {
      keepCellSelection: true,
    });
    return true;
  };

  /**
   * Arm one property for the next characters typed at the caret.
   *
   * REFUSED HERE if the store could not author it. An armed property is applied inside the
   * KEYSTROKE's transaction, so a name outside the D8 run vocabulary would not fail at the
   * press — it would reject the insert too, and go on rejecting every keystroke at that
   * caret in silence. Every other write reaches the store in the same turn as the press and
   * surfaces its own refusal; this one has to be checked before it can be stored.
   */
  const armPending = (incoming: SurfaceProperty): void => {
    if (!isAuthorableRunProperty(incoming.localName)) return;
    deps.setPendingFormats(mergedProperties(deps.pendingFormats() ?? [], incoming));
  };

  return {
    setRunProperty(localName, attributes) {
      const incoming = { localName, ...(attributes ? { attributes } : {}) };
      const cells = deps.selectedCells?.();
      if (cells && cells.length > 0) {
        writeRunPropertyOverCells(cells, incoming);
        return;
      }
      const { from, to } = orderedRange();
      if (from.paragraphId === to.paragraphId && from.offset === to.offset) {
        // A collapsed caret arms the value for the NEXT characters typed — picking a font
        // with nothing selected is how Word starts typing in that font.
        armPending(incoming);
        return;
      }
      writeRunProperty(from, to, incoming);
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
      // Pending caret formatting overlays the document's answer, so the toolbar shows what
      // the next character typed will look like while a stored format is armed.
      withPendingFormatting(
        formattingAt(
          currentLayout.value,
          selectionNow.value,
          (paragraphId: string, runProperties) =>
            session.effectiveRunDefaults(paragraphId, runProperties),
          deps.selectedCells?.(),
          deps.defaultParagraphStyleId?.() ?? null
        ),
        deps.pendingFormats()
      ),

    toggleRunProperty(localName, attributes) {
      const cells = deps.selectedCells?.();
      // A pending entry answers for the toggle state ahead of the document — pressing Bold
      // twice at a caret must cancel, not double-arm.
      const active =
        pendingPropertyState(deps.pendingFormats(), localName) ??
        isRunPropertyActive(currentLayout.value, selectionNow.value, localName, cells);
      // Toggling OFF sends an explicit `val="0"` rather than dropping the element: the
      // property may be inherited from a style, and removing the local override would let the
      // inherited value come back. `w:u` is a closed enumeration, not a boolean: its off
      // value is `none`, and `val="0"` is one Word rejects outright.
      const incoming = active
        ? { localName, attributes: { val: localName === 'u' ? 'none' : '0' } }
        : { localName, ...(attributes ? { attributes } : {}) };
      if (cells && cells.length > 0) {
        writeRunPropertyOverCells(cells, incoming);
        return;
      }
      const { from, to } = orderedRange();
      if (from.paragraphId === to.paragraphId && from.offset === to.offset) {
        // The stored-marks lane: a collapsed caret has no range to format, so the toggle is
        // remembered and applied to the next characters typed at this position (Word's
        // behavior). Moving the caret discards it — the composition root owns that rule.
        //
        // A toggle that lands BACK on what the document already gives disarms the entry
        // rather than arming an explicit override: Bold pressed twice must leave nothing
        // pending, or typing would split the run to write a redundant `b val="0"`.
        const pending = deps.pendingFormats() ?? [];
        const documentActive = isRunPropertyActive(
          currentLayout.value,
          selectionNow.value,
          localName
        );
        if (!active === documentActive) {
          const kept = pending.filter((property) => property.localName !== localName);
          deps.setPendingFormats(kept.length > 0 ? kept : null);
        } else {
          armPending(incoming);
        }
        return;
      }
      writeRunProperty(from, to, incoming);
    },
  };
}

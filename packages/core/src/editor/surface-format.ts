// Run and paragraph property edits at the selection (paginated-surface seam).
//
// The formatting lane: toggling a run property, setting one outright, and setting a
// paragraph property. They share one rule the structural edits do not — a change that
// covers a WHOLE paragraph also writes its mark, because that is what a list marker
// inherits its face from.

import type { TreeApplyResult, TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { StoryScope } from '@docx-editor.dev/core-contract/store';
import {
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import {
  directParagraphMarkProperties,
  directParagraphProperties,
  formattingAt,
  hasAuthoredRunProperties,
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
  /** Active story for mutations — body or `{ kind: 'headerFooter', rId }`. */
  storyScope(): StoryScope;
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
  /** Paragraph ids in reading order for the active scope (body or open furniture story). */
  paragraphOrder(): readonly string[];
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
  /**
   * The face a run with no authored font is measured in, so `formatting()` reports it
   * instead of null (the run-defaults twin of `defaultParagraphStyleId`).
   */
  defaultFontFamily?(): string | null;
}

type FormatMethods = Pick<
  PaginatedSurface,
  'setRunProperty' | 'setParagraphProperty' | 'toggleRunProperty' | 'formatting' | 'clearFormatting'
>;

export function createSurfaceFormat(deps: SurfaceFormatDeps): FormatMethods {
  const { session, commit, orderedRange, selectionMark, textOf } = deps;
  const storyPart = () => session.partFor(deps.storyScope()) ?? session.part();
  const applyOps = (
    ops: Parameters<TreeDocxSession['applyTreeOps']>[0],
    before?: Parameters<TreeDocxSession['applyTreeOps']>[1],
    after?: Parameters<TreeDocxSession['applyTreeOps']>[2]
  ) => session.applyTreeOps(ops, before, after, deps.storyScope());
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
   * The range is walked the same way `planRangeDeletion` walks it: the tail of the first
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
    const part = storyPart();
    if (from.paragraphId === to.paragraphId) {
      const edits = runPropertyEdits(part, from.paragraphId, from.offset, to.offset, incoming);
      // No run in range means nothing was formatted, so the mark must not move either.
      if (edits.length === 0) return;
      const markProperties = mergedProperties(
        directParagraphMarkProperties(part, from.paragraphId),
        incoming
      );
      commit(() =>
        applyOps(
          [
            ...edits.map((edit) => ({
              op: 'setRunProperties' as const,
              paragraphId: from.paragraphId,
              start: edit.start,
              end: edit.end,
              properties: edit.properties,
              ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
            })),
            ...paragraphMarkOps(textOf(from.paragraphId), from, to, markProperties),
          ],
          selectionMark()
        )
      );
      return;
    }
    const order = deps.paragraphOrder();
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
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
      // The mark follows a paragraph whose PILCROW the selection contains, which is what a
      // list marker inherits its face from.
      //
      // In Word the pilcrow is a character in the stream, so a selection cannot reach the
      // next paragraph without passing through this one's: every paragraph before the last
      // has its mark inside the range no matter where the range started. Requiring whole
      // coverage instead missed the FIRST paragraph of a drag that began mid-text — bolding
      // from the middle of a bulleted item through the next one left that item's bullet
      // unbolded while the one below it grew.
      //
      // The last paragraph is the one whose pilcrow is genuinely outside the range, so it
      // keeps the conservative whole-text rule `paragraphMarkOps` applies to a
      // single-paragraph edit: formatting part of a paragraph must not restyle its mark.
      //
      // A paragraph before the last takes its mark whether or not any TEXT of it was
      // covered, and that is not a detail: dragging from the very end of one paragraph to
      // the very start of the next selects nothing but the pilcrow between them, and
      // requiring an edit first left that press with no ops at all — `can` said yes, `exec`
      // reported `changed: false`, and the document did not move. Same reasoning for an
      // empty paragraph inside the range, which has no run to carry the change at all.
      const covered = index < lastIndex || (start === 0 && end === text.length && text.length > 0);
      if (covered) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId,
          properties: mergedProperties(directParagraphMarkProperties(part, paragraphId), incoming),
        });
      }
    }
    if (ops.length === 0) return;
    commit(() => applyOps(ops, selectionMark()));
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
    const part = storyPart();
    const ops: TreeDocOp[] = [];
    for (const paragraphId of paragraphsInCells(currentLayout.value, cells)) {
      const text = textOf(paragraphId);
      // An EMPTY paragraph in a selected cell is still selected: it has no run to carry the
      // change, so its mark below is the only place the format can live, and skipping it
      // outright left typing into that line unformatted. Same rule the range walk applies to
      // an empty paragraph inside its endpoints.
      for (const edit of runPropertyEdits(part, paragraphId, 0, text.length, incoming)) {
        ops.push({
          op: 'setRunProperties' as const,
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
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
    commit(() => applyOps(ops, selectionMark()), undefined, {
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

    setParagraphProperty(localName, attributes, options) {
      const { from, to } = orderedRange();
      const order = deps.paragraphOrder();
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return;
      // EVERY paragraph the selection touches, not just the one the caret is in: selecting
      // three paragraphs and pressing centre must centre three paragraphs.
      //
      // Merged against what each paragraph ITSELF authors, never the cascade the layout
      // publishes: the op replaces the properties it names and drops the ones it does not,
      // so its base has to be the paragraph's own `w:pPr` — see `directParagraphProperties`.
      const part = storyPart();
      const ops = order.slice(firstIndex, lastIndex + 1).map((paragraphId) => {
        const own = directParagraphProperties(part, paragraphId);
        // `mergeAttributes` is for the properties that carry SEVERAL independent settings
        // in one element. `w:spacing` holds the line rule, the space before and the space
        // after; replacing it wholesale meant picking a line spacing deleted the paragraph's
        // space-before, and adding space after deleted the line spacing. A null-valued
        // attribute REMOVES that one, which is how Word's "Remove space before paragraph"
        // differs from setting it to zero.
        const merged = options?.mergeAttributes
          ? {
              ...(own.find((property) => property.localName === localName)?.attributes ?? {}),
              ...attributes,
            }
          : (attributes ?? {});
        const kept = Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== null && value !== undefined)
        ) as Record<string, string>;
        return {
          op: 'setParagraphProperties' as const,
          paragraphId,
          properties: mergedProperties(own, {
            localName,
            ...(Object.keys(kept).length > 0 ? { attributes: kept } : {}),
          }),
        };
      });
      if (ops.length === 0) return;
      commit(() => applyOps(ops, selectionMark()));
    },

    formatting: () =>
      // Pending caret formatting overlays the document's answer, so the toolbar shows what
      // the next character typed will look like while a stored format is armed.
      withPendingFormatting(
        formattingAt(
          currentLayout.value,
          selectionNow.value,
          (paragraphId: string, runProperties) => {
            const resolved = session.effectiveRunDefaults(paragraphId, runProperties);
            // A run whose chain authored NOTHING is still measured in the surface's
            // default face; report that face rather than null, per span — so a blank
            // document reads "Calibri" while a genuinely mixed selection still
            // disagrees its way to null.
            if (resolved.fontFamily !== null) return resolved;
            const fallback = deps.defaultFontFamily?.() ?? null;
            return fallback === null ? resolved : { ...resolved, fontFamily: fallback };
          },
          deps.selectedCells?.(),
          deps.defaultParagraphStyleId?.() ?? null
        ),
        deps.pendingFormats()
      ),

    toggleRunProperty(localName, attributes) {
      const cells = deps.selectedCells?.();
      // The VALUE this press means, for a property whose on-state is one member of an
      // enumeration rather than a boolean: `w:vertAlign` carries superscript AND subscript,
      // so "is it on" is only answerable against the value being toggled.
      const value = attributes?.val;
      // A pending entry answers for the toggle state ahead of the document — pressing Bold
      // twice at a caret must cancel, not double-arm.
      const active =
        pendingPropertyState(deps.pendingFormats(), localName, value) ??
        isRunPropertyActive(currentLayout.value, selectionNow.value, localName, cells, value);
      // Toggling OFF sends an explicit off value rather than dropping the element: the
      // property may be inherited from a style, and removing the local override would let the
      // inherited value come back. Two of these are closed enumerations, not booleans, and
      // `val="0"` is a value Word rejects in both: `w:u` turns off as `none`, `w:vertAlign`
      // as `baseline`.
      const incoming = active
        ? { localName, attributes: { val: OFF_VALUES[localName] ?? '0' } }
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
          localName,
          undefined,
          value
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

    clearFormatting() {
      // Word's eraser, and Word's split: character formatting is a RANGE, paragraph
      // formatting is not. The selected text loses its direct `w:rPr`; every paragraph the
      // selection touches loses its direct `w:pPr` — which includes `w:pStyle`, so the
      // paragraph falls back to the document's default style — and its mark.
      //
      // Every op states an EMPTY property list, which is how the applier is told to drop
      // what it can name and keep what it cannot: `w:rStyle`, `w:lang`, `w:sectPr`, `w:pBdr`
      // and the rest survive, because an op that cannot say a thing cannot mean to delete it
      // (see `mergedPropertyChildren`).
      //
      // The armed typing format goes FIRST, and unconditionally: nothing is selected at a
      // caret, so the existing text keeps what it has and the pending entry is the only
      // formatting the press can actually clear there. Retiring it after the early return
      // below meant an eraser pressed on a paragraph the layout had not published yet left
      // the armed format standing, and the next characters typed came out in exactly the
      // formatting the user had just asked to be rid of.
      deps.setPendingFormats(null);
      const layout = currentLayout.value;
      const order = deps.paragraphOrder();
      const cells = deps.selectedCells?.();
      const paragraphIds =
        cells && cells.length > 0
          ? [...paragraphsInCells(layout, cells)]
          : paragraphsInRange(order, orderedRange());
      if (paragraphIds.length === 0) return;
      const { from, to } = orderedRange();
      const rectangular = cells !== undefined && cells.length > 0;
      const part = storyPart();
      const ops: TreeDocOp[] = [];
      for (const paragraphId of paragraphIds) {
        const text = textOf(paragraphId);
        // A rectangle stands for whole cells, so every paragraph in it clears entirely.
        const start = rectangular || paragraphId !== from.paragraphId ? 0 : from.offset;
        const end = rectangular || paragraphId !== to.paragraphId ? text.length : to.offset;
        // ONE op for the whole range rather than one per run: the other writes split per run
        // so each keeps its own bag, and here there is no bag to keep. Clearing is the one
        // change that legitimately homogenises the range.
        //
        // Each op is emitted only where there is something to drop. An op that names nothing
        // still counts as APPLIED — the store publishes a revision and pushes an undo entry
        // for it even though the tree comes back identical — so an unconditional three ops
        // per paragraph made the eraser report `changed: true` over clean text and cost an
        // undo press that undid nothing.
        if (start < end && hasAuthoredRunProperties(part, paragraphId, start, end)) {
          ops.push({ op: 'setRunProperties', paragraphId, start, end, properties: [] });
        }
        // The MARK first: `setParagraphProperties` cannot name `w:rPr`, so it preserves the
        // mark and leaves the container non-empty, and the applier drops a `w:pPr` only once
        // it has no children left. Clearing the paragraph first therefore left an empty
        // `<w:pPr/>` behind, which is not what a paragraph that never had properties
        // serialises as.
        if (directParagraphMarkProperties(part, paragraphId).length > 0) {
          ops.push({ op: 'setParagraphMarkProperties', paragraphId, properties: [] });
        }
        if (directParagraphProperties(part, paragraphId).length > 0) {
          ops.push({ op: 'setParagraphProperties', paragraphId, properties: [] });
        }
      }
      if (ops.length === 0) return;
      commit(() => applyOps(ops, selectionMark()), undefined, {
        keepCellSelection: rectangular,
      });
    },
  };
}

/** The off value for a property whose on-state is one member of a closed enumeration. */
const OFF_VALUES: Readonly<Record<string, string>> = {
  u: 'none',
  vertAlign: 'baseline',
};

/** Every paragraph a range touches, in document order — the span paragraph-level writes cover. */
function paragraphsInRange(
  order: readonly string[],
  range: { from: SemanticPosition; to: SemanticPosition }
): readonly string[] {
  const firstIndex = order.indexOf(range.from.paragraphId);
  const lastIndex = order.indexOf(range.to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return [];
  return order.slice(firstIndex, lastIndex + 1);
}

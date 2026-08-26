// The section-break lane's pure parts (paginated-surface seam).
//
// A break is the one structural edit whose answer depends on a node OUTSIDE the paragraph it
// splits: `w:type` states how a section starts relative to the one before it (ECMA-376
// §17.6.22), so the type a caller asks for belongs to the section that STARTS at the mark.
// Working out which section that is, and whether the answer is even reachable cheaply, is
// the same question for the gate and for the write — so it is spelled once, here.

import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  allSectionNodes,
  bodySectionOf,
  governingSectionAt,
  isTableNested,
  sectionBreakTypeOf,
} from '../store/store/tree-op-section-address.ts';
import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import type { RangeDeletionPlan } from './surface-selection-ops.ts';

/**
 * The one break this engine cannot propose. Spelled once, and listed in
 * `DISABLED_REASON_KEYS` so chrome renders it in the reader's language rather than raw
 * English — an engine `disabledReason` is text a user reads.
 */
export const SUGGESTED_BREAK_REFUSAL =
  'a section break that changes where the next section starts cannot be suggested; ' +
  'turn off suggesting to insert it';

/** The store's own rule, published so the control can grey out instead of failing on press. */
export const TABLE_CELL_BREAK_REFUSAL = 'a section break cannot be inserted inside a table cell';

/**
 * The store refuses a retype reaching a locked or data-bound control, and names the paragraph
 * the section hangs on — which is not the one the caret is in. Said in the lane's own words,
 * because the store's `locked` is a diagnostic: read as a sentence it would claim the
 * SELECTION is locked, and the selection is ordinary editable text.
 */
export const LOCKED_SECTION_BREAK_REFUSAL =
  'a section break cannot change a section that a locked or linked content control holds';

/** The store's other lock pair: the mark itself, in content a control holds. */
export const LOCKED_CONTENT_BREAK_REFUSAL =
  'a section break cannot be inserted in locked or linked content';

/**
 * Whether ANY content control in the part declares a lock or a binding a break could hit.
 *
 * A fast-path exit: a document with none — which is nearly every document — skips both lock
 * questions for a range without ordering the selection or planning anything, and the ones
 * that do have them pay for the answer. It reads the same two declarations the store's own
 * guards read, so it cannot answer "no" where one of them would refuse.
 */
export function partDeclaresContentControlLocks(part: OoxmlPart): boolean {
  let found = false;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue' || !('localName' in node)) return;
    // NAMESPACE-QUALIFIED, and by what the lock says. Matching `lock` on its local name alone
    // matched VML's `o:lock`, which Word writes inside `v:shapetype` for every legacy picture
    // — so one shape anywhere turned this true and cost the gate its cheap exact answers. A
    // `sdtLocked` control is not a match either: it refuses REMOVAL of the wrapper and leaves
    // the content editable, which is not a refusal a break can hit.
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      if (node.localName === 'dataBinding') {
        found = true;
        return;
      }
      if (node.localName === 'lock') {
        const value = node.attributes?.find(
          (attribute) =>
            attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI
        )?.value;
        if (value === 'contentLocked' || value === 'sdtContentLocked') found = true;
        return;
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

/**
 * Every paragraph the part holds inside a `w:tbl`, in one walk.
 *
 * The same predicate `isTableNested` answers one id at a time. A RANGE needs it for the whole
 * span — the landing is somewhere in there and a section cannot end in a cell — and asking per
 * paragraph would be a walk each.
 */
export function tableNestedParagraphIds(part: OoxmlPart): ReadonlySet<string> {
  const nested = new Set<string>();
  const walk = (node: OoxmlNode, inTable: boolean): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      if (inTable) nested.add(node.id);
      return;
    }
    const below = inTable || node.kind === 'table';
    for (const child of node.children ?? []) walk(child, below);
  };
  walk(part.root, false);
  return nested;
}

/**
 * How far a break gate will plan a deletion to find its exact answer.
 *
 * The gate runs on every toolbar derivation, twice, once per section-break row, and the plan
 * it needs for an exact answer is not cheap: measured on an 8000-paragraph part it costs about
 * 15ms before the range is even considered, plus about 0.9ms per paragraph of it. Unbounded,
 * a select-all was a seconds-long stall. Bounded here it is tens of milliseconds, and only for
 * a document that declares a lock or holds a table — everything else is answered without a
 * plan at all. Past the bound the row stays enabled and the press reports the refusal.
 */
export const MAX_GATED_BREAK_SPAN = 32;

/**
 * The break type EVERY section in the part starts with, or `null` when they disagree.
 *
 * A document whose sections all start the same way answers the gate's question without
 * anyone working out which section a break would land in. The implicit tail section counts:
 * a part with no body-level `w:sectPr` still has one, and it starts on a new page.
 */
export function uniformSectionBreakType(part: OoxmlPart): string | null {
  const types = new Set(allSectionNodes(part).map((section) => sectionBreakTypeOf(section)));
  if (!bodySectionOf(part)) types.add('nextPage');
  return types.size === 1 ? [...types][0]! : null;
}

/**
 * Where a section break actually lands, which is not the selection's head.
 *
 * The plan's `replaceAt`, like the tab and break lanes: in suggesting mode the struck words
 * stay, and a split at the range START cut the paragraph in FRONT of them — the break and
 * the strike read as two unrelated edits. EXCEPT when the landing sits in a table cell: a
 * section mark cannot be minted there (the store refuses it, and one refused op vetoes the
 * strike with it), so the break falls back to `collapseTo`. That only saves the gesture when
 * the range STARTS outside the table — a selection wholly inside one is still refused by the
 * store, as it always was.
 *
 * Both the gate and the write resolve it here. Reading `selection.head` instead put the two
 * on different paragraphs whenever the drag ran backwards over a section boundary, and they
 * then disagreed about which section the break would retype.
 */
export function sectionBreakLanding(part: OoxmlPart, plan: RangeDeletionPlan): SemanticPosition {
  const landing = plan.replaceAt ?? plan.collapseTo;
  return isTableNested(part, landing.paragraphId) ? plan.collapseTo : landing;
}

/** Whether a content control refuses content edits at this paragraph, by lock or by binding. */
export const heldByControl = (part: OoxmlPart, paragraphId: string): boolean =>
  isBoundAt(part, paragraphId) || effectiveContentLockAt(part, paragraphId).content;

/**
 * Every refusal a break at ONE KNOWN LANDING carries, or null.
 *
 * All three are about the section that STARTS at the mark, so all three are questions only a
 * landing can answer. `suggesting` is passed in rather than read, because the gate and the
 * write reach here from different places and there must be one answer.
 */
export function landedBreakRefusal(
  part: OoxmlPart,
  paragraphId: string,
  breakType: 'nextPage' | 'continuous',
  suggesting: boolean
): string | null {
  // A cell first, in the SAME order the write asks: it falls back to `collapseTo` when the
  // landing is nested, and refuses when that is nested too. Checking it only at the two cheap
  // selections left a plain drag inside one cell answering "allowed" from the plan path — the
  // gate computed the landing and then never asked the one question the write asks about it.
  if (isTableNested(part, paragraphId)) return TABLE_CELL_BREAK_REFUSAL;
  // The store guards TWO paragraphs, so this mirrors both. First the mark itself: a section
  // cannot end inside content a control holds, whatever the break would do to the section
  // after it. Mirroring only the second one left a caret in a locked control with two live
  // rows and a press that failed with the store's `locked`.
  if (heldByControl(part, paragraphId)) return LOCKED_CONTENT_BREAK_REFUSAL;
  // The rest only arise when the break actually retypes the section that follows.
  const { section, ownerId } = governingSectionAt(part, paragraphId);
  if (sectionBreakTypeOf(section) === breakType) return null;
  // Then the section's OWN paragraph, which is not the one the caret is in. Said in the
  // lane's words: the store's `locked` is a diagnostic, and read as a sentence it would
  // claim the selection is locked when the selection is ordinary editable text.
  if (ownerId !== null && heldByControl(part, ownerId)) return LOCKED_SECTION_BREAK_REFUSAL;
  // Suggesting comes LAST of the three. It tells the user to turn suggesting off, and that is
  // only worth saying when doing so would actually let the break through.
  return suggesting ? SUGGESTED_BREAK_REFUSAL : null;
}

/** What {@link sectionBreakGate} needs from the surface to answer without asking twice. */
export interface SectionBreakGateInput {
  /** Read per step: `orderedRange` flushes, and the sections must come from the tree after it. */
  part(): OoxmlPart;
  readonly breakType: 'nextPage' | 'continuous';
  readonly suggesting: boolean;
  /** A rectangle is by construction inside a table. */
  readonly cellRectangle: boolean;
  /** The paragraph a COLLAPSED caret is in, or null for a range. */
  readonly caretParagraphId: string | null;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  paragraphOrder(): readonly string[];
  deleteSelectionPlan(): RangeDeletionPlan;
}

/**
 * Why a section break is refused right now, or null — everything but the story scope.
 *
 * Ordered by cost, because `can` runs it on every toolbar derivation while the Insert menu is
 * open, twice, once per section-break row. The exact answer needs the LANDING, and finding
 * that costs a range-deletion plan that scales with the selection: asking for it eagerly made
 * `can(insertBreak)` take seconds on a select-all in a long document, on the next-page row
 * that had no gate at all before this feature as well as on the new one.
 */
export function sectionBreakGate(input: SectionBreakGateInput): string | null {
  const { breakType, suggesting } = input;
  // In a table cell a section cannot end at all: Word never writes one there, and the read
  // side would ignore it. Refused whatever the mode, from the two selections that say so
  // without ordering anything. A RECTANGLE is the table gesture, and leaving it out left both
  // rows enabled and always failing. A caret answers for itself. A plain RANGE that starts in
  // a table is the one shape still left to `exec`, because only the landing settles it.
  if (input.cellRectangle) return TABLE_CELL_BREAK_REFUSAL;
  if (input.caretParagraphId !== null) {
    // A CARET is its own landing, so it settles every question with no ordering, no flush and
    // one walk — and a caret is what a toolbar derives against nearly always. `orderedRange()`
    // flushes pending input, which is a write, and this is a read React runs during render.
    const part = input.part();
    if (isTableNested(part, input.caretParagraphId)) return TABLE_CELL_BREAK_REFUSAL;
    return landedBreakRefusal(part, input.caretParagraphId, breakType, suggesting);
  }
  // A RANGE has two questions left, and each needs a reason to exist: the suggesting one needs
  // suggesting, and the lock one needs a control that declares a lock or a binding. Neither,
  // and there is nothing to work out — which is nearly every document, and one walk is what it
  // costs to know that without ordering the selection.
  const mayHold = partDeclaresContentControlLocks(input.part());
  // A cell refuses whatever the mode, so a document holding one cannot take this exit even in
  // edit mode. Both walks happen before `orderedRange()`, which is fine: flushing pending
  // input adds no table and declares no lock.
  const cells = tableNestedParagraphIds(input.part());
  if (!suggesting && !mayHold && cells.size === 0) return null;
  // AFTER the flush `orderedRange` runs, so the sections come from the tree the plan would be
  // built against.
  const { from, to } = input.orderedRange();
  const part = input.part();
  // Two exact short-circuits, so nearly every answer costs no deletion plan. The landing is
  // somewhere in `[from, to]` — `replacementTarget` walks it BACK from `to` through the
  // author's own pending paragraph marks — so any rule that holds for EVERY paragraph in that
  // span holds for the landing.
  //
  // First: the same governing NODE at both ends. The governing section is the first `w:sectPr`
  // at or after a paragraph, which only moves forward, so one node at both ends means that
  // node governs everything between them. Comparing the resolved TYPE here instead of the node
  // was wrong — two different sections share a type routinely, and an intermediate landing
  // could then carry a third.
  const atStart = governingSectionAt(part, from.paragraphId);
  const atEnd = governingSectionAt(part, to.paragraphId);
  const oneSection = atStart.section === atEnd.section;
  // Second: every section in the document starts the same way. Then the landing's section does
  // too, whichever it is — which answers a selection spanning sections.
  const settled = oneSection ? sectionBreakTypeOf(atStart.section) : uniformSectionBreakType(part);
  // Two things the cheap path cannot see could refuse FIRST: a cell anywhere in the span, and
  // content a control holds. Both are about the LANDING, which is what the cheap path does not
  // have — so they are ruled out for the whole span instead.
  const order = input.paragraphOrder();
  const first = order.indexOf(from.paragraphId);
  const last = order.indexOf(to.paragraphId);
  const mayNest =
    first === -1 || last === -1 || order.slice(first, last + 1).some((id) => cells.has(id));
  const exact = !mayHold && !mayNest;
  // A settled type that is NOT the requested one means the break definitely retypes.
  if (settled !== null && settled !== breakType) {
    // The section's own owner is known whenever both ends resolve to one section, and it
    // outranks the mode — see `landedBreakRefusal`.
    if (oneSection && atStart.ownerId !== null && heldByControl(part, atStart.ownerId)) {
      return LOCKED_SECTION_BREAK_REFUSAL;
    }
    // Suggesting refuses it, and says so here only when nothing else could have refused
    // first: otherwise the plan below names the real reason, which is what the press will.
    if (suggesting && exact) return SUGGESTED_BREAK_REFUSAL;
  }
  // A settled type that IS the requested one refuses nothing — once the two unseen things
  // are ruled out.
  if (exact && settled !== null) return null;
  // So the plan is BOUNDED by how much it would have to walk (see `MAX_GATED_BREAK_SPAN`).
  // Past it the control stays enabled and the press reports the refusal exactly, from `exec`,
  // which has already paid for a write.
  //
  // Past it a definite retype still REFUSES while suggesting — the press will too, and the
  // reason may be the more specific one. Answering `null` there was a live row for a break
  // the gate already knew would fail.
  if (last - first > MAX_GATED_BREAK_SPAN) {
    return suggesting && settled !== null && settled !== breakType ? SUGGESTED_BREAK_REFUSAL : null;
  }
  const landing = sectionBreakLanding(part, input.deleteSelectionPlan());
  return landedBreakRefusal(part, landing.paragraphId, breakType, suggesting);
}

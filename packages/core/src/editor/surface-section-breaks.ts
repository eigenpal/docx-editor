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
        const value = node.attributes?.find((attribute) => attribute.localName === 'val')?.value;
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
 * How far a break gate will plan a deletion to find its exact answer.
 *
 * Planning is superlinear in the range, and the gate runs on every toolbar derivation — twice,
 * once per section-break row — so an unbounded one turned a select-all in a long document into
 * a seconds-long stall. Measured on an 8000-paragraph part, the plan path costs about
 * 0.37ms per paragraph of the range: 200 paragraphs is 74ms, which is already too much to
 * spend on a read. This bound keeps it near 20ms in the worst case and still covers a caret
 * and any ordinary drag. Past it the row stays enabled and the press reports the refusal.
 */
export const MAX_GATED_BREAK_SPAN = 64;

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
  if (!suggesting && !mayHold) return null;
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
  // A settled type that is NOT the requested one means the break definitely retypes, and the
  // two refusals that follow from that are answerable right here. Running these only when no
  // control declares a lock threw them away for any document that has one: past the bound
  // below, the gate then answered "allowed" for a break it already knew would refuse.
  if (settled !== null && settled !== breakType) {
    if (oneSection && atStart.ownerId !== null && heldByControl(part, atStart.ownerId)) {
      return LOCKED_SECTION_BREAK_REFUSAL;
    }
    if (suggesting) return SUGGESTED_BREAK_REFUSAL;
  }
  // What is left needs the landing ITSELF: whether the mark lands in content a control holds,
  // and — where the sections disagree — which section it lands in. Neither can arise when
  // nothing declares a lock and the type is settled.
  if (!mayHold && settled !== null) return null;
  // So the plan is BOUNDED by how much it would have to walk (see `MAX_GATED_BREAK_SPAN`).
  // Past it the control stays enabled and the press reports the refusal exactly, from `exec`,
  // which has already paid for a write.
  const order = input.paragraphOrder();
  const span = order.indexOf(to.paragraphId) - order.indexOf(from.paragraphId);
  if (span > MAX_GATED_BREAK_SPAN) return null;
  const landing = sectionBreakLanding(part, input.deleteSelectionPlan());
  return landedBreakRefusal(part, landing.paragraphId, breakType, suggesting);
}

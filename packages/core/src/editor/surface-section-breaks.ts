// The section-break lane's pure parts (paginated-surface seam).
//
// A break is the one structural edit whose answer depends on a node OUTSIDE the paragraph it
// splits: `w:type` states how a section starts relative to the one before it (ECMA-376
// §17.6.22), so the type a caller asks for belongs to the section that STARTS at the mark.
// Working out which section that is, and whether the answer is even reachable cheaply, is
// the same question for the gate and for the write — so it is spelled once, here.

import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import {
  allSectionNodes,
  bodySectionOf,
  isTableNested,
  sectionBreakTypeOf,
} from '../store/store/tree-op-section-address.ts';
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
 * How far a break gate will plan a deletion to find its exact answer.
 *
 * Planning is superlinear in the range, and the gate runs on every toolbar derivation, so an
 * unbounded one turned a select-all in a long document into a seconds-long stall. A few
 * hundred paragraphs is milliseconds and covers a caret and any ordinary drag.
 */
export const MAX_GATED_BREAK_SPAN = 256;

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

// Leave property changes that change nothing out of the review queue.
//
// A tracked paragraph or run property change whose earlier and current properties resolve to
// the same formatting is not a decision anyone can make: Accept and Reject leave the document
// looking the same. Such records are left out of the queue, the rail and navigation. They stay
// in the file, and Accept All or Reject All over the whole document still clears them, because
// that resolves every site in each story rather than the listed items.

import type { ReviewItemFilter, ReviewItemFilterInputs } from '../binding/review-item-filter.ts';
import {
  paragraphChangeIsInert,
  propertyChangeContext,
  runChangeIsInert,
  type PropertyChangeContext,
} from '../layout/revision-property-effect.ts';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  revisionSiteNodeIdsOf,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';

/** How far up a change element can sit below its paragraph: rPr, run, wrappers, paragraph. */
const MAX_ANCESTORS = 64;

/** The answer per change element, valid while its context and containers are unchanged. */
const answers = new WeakMap<
  OoxmlElement,
  {
    readonly context: PropertyChangeContext;
    readonly current: OoxmlElement;
    readonly paragraph: OoxmlElement | undefined;
    readonly inert: boolean;
  }
>();

function isCandidate(item: ReviewItem): item is ReviewRevisionItem {
  return (
    item.kind === 'revision' &&
    item.revisionKind === 'format' &&
    (item.formattingKind === 'pPrChange' || item.formattingKind === 'rPrChange') &&
    item.ranges.length > 0
  );
}

/** The paragraph holding `id`, or null when a table cell or nothing holds it first. */
function paragraphAbove(part: OoxmlPart, id: string): OoxmlElement | null {
  let current = parentNodeOf(part, id);
  for (let depth = 0; current && depth < MAX_ANCESTORS; depth += 1) {
    if (current.kind === 'paragraph') {
      // Table styles are not resolved by the check, so content in a table always lists.
      for (
        let above = parentNodeOf(part, current.id);
        above;
        above = parentNodeOf(part, above.id)
      ) {
        if (above.kind === 'tableCell') return null;
      }
      return current;
    }
    if (current.kind === 'tableCell') return null;
    current = parentNodeOf(part, current.id);
  }
  return null;
}

function paragraphProperties(paragraph: OoxmlElement): OoxmlElement | undefined {
  for (const child of paragraph.children) {
    if (child.kind !== 'textValue' && child.localName === 'pPr') return child;
  }
  return undefined;
}

function siteIsInert(part: OoxmlPart, id: string, context: PropertyChangeContext): boolean {
  const change = findNode(part, id);
  if (!change || change.kind === 'textValue') return false;
  const current = parentNodeOf(part, id);
  if (!current) return false;
  const paragraph = paragraphAbove(part, current.id);
  if (!paragraph) return false;
  const pPr = paragraphProperties(paragraph);
  const known = answers.get(change);
  if (known && known.context === context && known.current === current && known.paragraph === pPr) {
    return known.inert;
  }
  const inert =
    change.localName === 'pPrChange'
      ? current === pPr && paragraphChangeIsInert(context, change, current)
      : change.localName === 'rPrChange' && runChangeIsInert(context, change, current, pPr);
  answers.set(change, { context, current, paragraph: pPr, inert });
  return inert;
}

function isInert(
  item: ReviewItem,
  inputs: ReviewItemFilterInputs,
  context: PropertyChangeContext
): boolean {
  if (!isCandidate(item)) return false;
  const part = inputs.pkg.parts.get(item.ranges[0]!.partName);
  const ids = revisionSiteNodeIdsOf(item);
  return !!part && ids.length > 0 && ids.every((id) => siteIsInert(part, id, context));
}

export const withoutInertPropertyChanges: ReviewItemFilter = (items, inputs) => {
  if (!items.some(isCandidate)) return items;
  const context = propertyChangeContext(inputs.stylesRoot, inputs.numberingRoot);
  const kept = items.filter((item) => !isInert(item, inputs, context));
  return kept.length === items.length ? items : kept;
};

/**
 * The records {@link withoutInertPropertyChanges} leaves out, for a bulk decision that names no
 * keys: Accept All and Reject All clear them with the listed changes.
 */
export function inertPropertyChanges(
  items: readonly ReviewRevisionItem[],
  inputs: ReviewItemFilterInputs
): readonly ReviewRevisionItem[] {
  if (!items.some(isCandidate)) return [];
  const context = propertyChangeContext(inputs.stylesRoot, inputs.numberingRoot);
  return items.filter((item) => isInert(item, inputs, context));
}

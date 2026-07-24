// Canonicalize modeled paragraph properties so a degenerate value (an empty object, an empty-string
// styleId/numId, a non-integer ilvl) never survives differently through export vs digest. Both the
// serializer (pPrFromProps) and the authored-state digest run authored props through this first, so
// `{}`, `{styleId: ''}`, and `{ilvl: NaN}` all canonicalize to the same absence the parser produces
// on reopen — closing the round-trip asymmetry a truthiness-only check leaves open.

import type { ParagraphProps } from './authored-model.ts';

/** Return the canonical form of paragraph props, or undefined when nothing meaningful remains.
 *  Empty-string ids are dropped; ilvl is kept only when a finite integer. */
export function canonicalParagraphProps(props: ParagraphProps | undefined): ParagraphProps | undefined {
  if (!props) return undefined;
  const out: { styleId?: string; numId?: string; ilvl?: number } = {};
  if (props.styleId) out.styleId = props.styleId; // non-empty only
  if (props.numId) out.numId = props.numId;
  if (props.ilvl !== undefined && Number.isInteger(props.ilvl)) out.ilvl = props.ilvl;
  return Object.keys(out).length > 0 ? out : undefined;
}

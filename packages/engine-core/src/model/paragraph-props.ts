// Canonicalize modeled paragraph properties so a degenerate value (an empty object, an empty-string
// styleId/numId, a non-integer ilvl) never survives differently through export vs digest. Both the
// serializer (pPrFromProps) and the authored-state digest run authored props through this first, so
// `{}`, `{styleId: ''}`, and `{ilvl: NaN}` all canonicalize to the same absence the parser produces
// on reopen — closing the round-trip asymmetry a truthiness-only check leaves open.

import type { ParagraphProps, RunProps, StyleRecord, DocDefaults } from './authored-model.ts';

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

/** Canonical form of run props, or undefined when nothing meaningful remains. An empty object or an
 *  empty-string styleId collapses to absent (matching what the parser yields), so a degenerate value
 *  never breaks run-merge / hash symmetry. Boolean formatting flags are kept as authored. */
export function canonicalRunProps(props: RunProps | undefined): RunProps | undefined {
  if (!props) return undefined;
  const out: { styleId?: string; bold?: boolean; italic?: boolean; underline?: boolean } = {};
  if (props.styleId) out.styleId = props.styleId; // non-empty only
  if (props.bold !== undefined) out.bold = props.bold;
  if (props.italic !== undefined) out.italic = props.italic;
  if (props.underline !== undefined) out.underline = props.underline;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The run-property subset that survives inside a w:style / w:docDefaults w:rPr: only the bold/italic/
 *  underline toggles round-trip there (rPrXml emits and parseRPr reads exactly these). A run styleId
 *  (w:rStyle) is a character-style LINK, meaningless as a style default and neither emitted nor parsed
 *  in that context, so it is dropped — otherwise it would drift out of the model on reopen. */
function canonicalStyleRunProps(props: RunProps | undefined): RunProps | undefined {
  const rp = canonicalRunProps(props);
  if (!rp) return undefined;
  const out: { bold?: boolean; italic?: boolean; underline?: boolean } = {};
  if (rp.bold !== undefined) out.bold = rp.bold;
  if (rp.italic !== undefined) out.italic = rp.italic;
  if (rp.underline !== undefined) out.underline = rp.underline;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Canonical form of a style record, matching what the serializer emits and the parser reads back:
 *  isDefault only when true, basedOn only when non-empty, runProps reduced to the toggles that
 *  round-trip in a style context. (id/name/type are required and passed through.) */
export function canonicalStyle(s: StyleRecord): StyleRecord {
  const rp = canonicalStyleRunProps(s.runProps);
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    ...(s.isDefault ? { isDefault: true as const } : {}),
    ...(s.basedOn ? { basedOn: s.basedOn } : {}),
    ...(rp ? { runProps: rp } : {}),
  };
}

/** Canonical document defaults, or undefined when the run-property defaults are empty (matching what
 *  the serializer emits and the parser yields on reopen). */
export function canonicalDocDefaults(d: DocDefaults | undefined): DocDefaults | undefined {
  const rp = canonicalStyleRunProps(d?.runProps);
  return rp ? { runProps: rp } : undefined;
}

// Canonicalize modeled paragraph properties so a degenerate value (an empty object, an empty-string
// styleId/numId, a non-integer ilvl) never survives differently through export vs digest. Both the
// serializer (pPrFromProps) and the authored-state digest run authored props through this first, so
// `{}`, `{styleId: ''}`, and `{ilvl: NaN}` all canonicalize to the same absence the parser produces
// on reopen — closing the round-trip asymmetry a truthiness-only check leaves open.

import {
  MAX_RUN_SIZE_HALF_POINTS,
  isUnderlineColor,
  isUnderlineVariant,
  type ParagraphProps,
  type RunProps,
  type RunUnderline,
  type StyleRecord,
  type DocDefaults,
} from './authored-model.ts';

/** Return the canonical form of paragraph props, or undefined when nothing meaningful remains.
 *  Empty-string ids are dropped; ilvl is kept only when a finite integer. */
export function canonicalParagraphProps(
  props: ParagraphProps | undefined
): ParagraphProps | undefined {
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
  const out: {
    styleId?: string;
    fonts?: NonNullable<RunProps['fonts']>;
    sizeHalfPoints?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: RunUnderline;
  } = {};
  if (props.styleId) out.styleId = props.styleId; // non-empty only
  if (props.fonts) {
    const fonts: Record<string, string> = {};
    for (const key of [
      'ascii',
      'hAnsi',
      'eastAsia',
      'cs',
      'asciiTheme',
      'hAnsiTheme',
      'eastAsiaTheme',
      'csTheme',
    ] as const) {
      const value = props.fonts[key];
      if (value !== undefined) fonts[key] = value;
    }
    if (Object.keys(fonts).length > 0) out.fonts = fonts;
  }
  if (
    props.sizeHalfPoints !== undefined &&
    Number.isSafeInteger(props.sizeHalfPoints) &&
    props.sizeHalfPoints >= 0 &&
    props.sizeHalfPoints <= MAX_RUN_SIZE_HALF_POINTS
  )
    out.sizeHalfPoints = props.sizeHalfPoints;
  if (props.color !== undefined) out.color = props.color;
  if (props.bold !== undefined) out.bold = props.bold;
  if (props.italic !== undefined) out.italic = props.italic;
  // Rebuilt field-by-field, like `fonts` above, so an underline carrying extra keys can
  // never reach the hash or the serializer through a canonicalized record.
  if (props.underline !== undefined && isUnderlineVariant(props.underline.val)) {
    out.underline = isUnderlineColor(props.underline.color)
      ? { val: props.underline.val, color: props.underline.color }
      : { val: props.underline.val };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Canonical style/default run properties. A run styleId is a character-style
 * link, meaningless inside style defaults, so it is the only run property dropped. */
function canonicalStyleRunProps(props: RunProps | undefined): RunProps | undefined {
  const rp = canonicalRunProps(props);
  if (!rp) return undefined;
  const { styleId: _styleId, ...out } = rp;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Canonical form of a style record, matching what the serializer emits and the parser reads back:
 *  isDefault only when true, basedOn only when non-empty, and runProps without a
 *  character-style link. (id/name/type are required and passed through.) */
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

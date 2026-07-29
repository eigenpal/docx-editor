// The accepted run property boundary, resolved for layout (task 7.2).
//
// Raw `w:rPr` children are authored OOXML: half-points, twips, percentages, toggle elements
// whose absence means "inherit" and whose `w:val="0"` means "off". Layout needs typed values
// in one unit system, and it needs them ONCE per run rather than re-derived by every
// consumer — the measurer, the style span and the painter must agree exactly or a caret
// lands where no glyph is.
//
// Every field here is resolved from the run's own properties. Style and document-default
// inheritance is a separate layer (the style resolver); this is the direct-formatting half,
// which is what the D8 boundary covers.

import type { OoxmlProperty } from '@docx-editor.dev/engine-core';

export type VerticalAlign = 'baseline' | 'superscript' | 'subscript';

export interface ResolvedUnderline {
  /** The authored `ST_Underline` variant. */
  readonly variant: string;
  /** RRGGBB, or null when the underline follows the text colour. */
  readonly color: string | null;
}

export interface ResolvedRunStyle {
  readonly fontFamily: string | null;
  /** Points. `w:sz` is half-points, so 22 becomes 11. */
  readonly fontSizePt: number;
  /** RRGGBB, or null for the inherited/automatic colour. */
  readonly color: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: ResolvedUnderline | null;
  readonly strike: boolean;
  readonly doubleStrike: boolean;
  /** An `ST_HighlightColor` name, or null. */
  readonly highlight: string | null;
  readonly verticalAlign: VerticalAlign;
  /** `w:position`, in points. Positive raises the baseline. */
  readonly baselineShiftPt: number;
  readonly caps: boolean;
  readonly smallCaps: boolean;
  /** `w:spacing`, in points. Added to every advance. */
  readonly characterSpacingPt: number;
  /** `w:w`, as a percentage. 100 is unscaled. */
  readonly horizontalScalePercent: number;
  /** `w:kern`, in points: the size at or above which kerning applies. 0 disables it. */
  readonly kerningMinPt: number;
}

/** The style a run inherits when it authors nothing. */
export const DEFAULT_RUN_STYLE: ResolvedRunStyle = Object.freeze({
  fontFamily: null,
  fontSizePt: 11,
  color: null,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  doubleStrike: false,
  highlight: null,
  verticalAlign: 'baseline',
  baselineShiftPt: 0,
  caps: false,
  smallCaps: false,
  characterSpacingPt: 0,
  horizontalScalePercent: 100,
  kerningMinPt: 0,
});

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

/** OOXML toggle semantics: present means on unless `w:val` says otherwise. */
function toggle(property: OoxmlProperty): boolean {
  const value = property.attributes?.val;
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

function integer(raw: string | undefined, allowNegative = false): number | null {
  if (raw === undefined) return null;
  if (!(allowNegative ? /^-?\d{1,7}$/ : /^\d{1,7}$/).test(raw)) return null;
  return Number(raw);
}

function hexColor(raw: string | undefined): string | null {
  if (raw === undefined || raw === 'auto') return null;
  return HEX_COLOR.test(raw) ? raw.toUpperCase() : null;
}

/**
 * Resolve one run's direct formatting.
 *
 * Unrecognised values are DROPPED rather than guessed: a `w:sz` of `"large"` leaves the
 * default size rather than inventing one, because a wrong measurement moves every glyph
 * after it and a missing one is visible immediately.
 */
export function resolveRunStyle(props: readonly OoxmlProperty[]): ResolvedRunStyle {
  const style: {
    -readonly [K in keyof ResolvedRunStyle]: ResolvedRunStyle[K];
  } = { ...DEFAULT_RUN_STYLE };

  for (const property of props) {
    switch (property.localName) {
      case 'rFonts': {
        // `w:ascii` is the Latin face; `w:hAnsi` is the fallback this lane uses when it is
        // the only one authored. Theme fonts resolve through the theme part, which is a
        // deferred lane, so a theme-only rFonts leaves the family inherited.
        const family = property.attributes?.ascii ?? property.attributes?.hAnsi;
        if (family && family.length <= 128) style.fontFamily = family;
        break;
      }
      case 'sz': {
        const halfPoints = integer(property.attributes?.val);
        if (halfPoints !== null && halfPoints > 0) style.fontSizePt = halfPoints / 2;
        break;
      }
      case 'color': {
        style.color = hexColor(property.attributes?.val);
        break;
      }
      case 'b':
        style.bold = toggle(property);
        break;
      case 'i':
        style.italic = toggle(property);
        break;
      case 'u': {
        const variant = property.attributes?.val ?? 'single';
        style.underline =
          variant === 'none' || !toggle(property)
            ? null
            : { variant, color: hexColor(property.attributes?.color) };
        break;
      }
      case 'strike':
        style.strike = toggle(property);
        break;
      case 'dstrike':
        style.doubleStrike = toggle(property);
        break;
      case 'highlight': {
        const value = property.attributes?.val;
        style.highlight = value && value !== 'none' ? value : null;
        break;
      }
      case 'vertAlign': {
        const value = property.attributes?.val;
        if (value === 'superscript' || value === 'subscript') style.verticalAlign = value;
        else if (value === 'baseline') style.verticalAlign = 'baseline';
        break;
      }
      case 'position': {
        // Half-points, signed: positive raises.
        const halfPoints = integer(property.attributes?.val, true);
        if (halfPoints !== null) style.baselineShiftPt = halfPoints / 2;
        break;
      }
      case 'caps':
        style.caps = toggle(property);
        break;
      case 'smallCaps':
        style.smallCaps = toggle(property);
        break;
      case 'spacing': {
        // Twips, signed. Inside `w:rPr` this is CHARACTER spacing; the identically named
        // child of `w:pPr` is paragraph spacing, which is why the two are resolved by
        // different functions rather than one shared reader.
        const twips = integer(property.attributes?.val, true);
        if (twips !== null) style.characterSpacingPt = twips / 20;
        break;
      }
      case 'w': {
        const percent = integer(property.attributes?.val);
        if (percent !== null && percent > 0) style.horizontalScalePercent = percent;
        break;
      }
      case 'kern': {
        const halfPoints = integer(property.attributes?.val);
        if (halfPoints !== null) style.kerningMinPt = halfPoints / 2;
        break;
      }
      default:
        // `szCs`, `bCs`, `iCs` are the complex-script counterparts; they belong to the
        // bidi lane, not to this one, and are preserved by the tree either way.
        break;
    }
  }
  return style;
}

/** The text as it is DRAWN, after case transforms. Measurement must use this, not the source. */
export function displayText(text: string, style: ResolvedRunStyle): string {
  if (style.caps) return text.toUpperCase();
  // Small caps changes glyph selection rather than the characters; the shaper handles it,
  // and uppercasing here would corrupt the text a copy would produce.
  return text;
}

/** Whether two resolved styles are identical, for span merging and cache keys. */
export function runStylesEqual(a: ResolvedRunStyle, b: ResolvedRunStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.doubleStrike === b.doubleStrike &&
    a.highlight === b.highlight &&
    a.verticalAlign === b.verticalAlign &&
    a.baselineShiftPt === b.baselineShiftPt &&
    a.caps === b.caps &&
    a.smallCaps === b.smallCaps &&
    a.characterSpacingPt === b.characterSpacingPt &&
    a.horizontalScalePercent === b.horizontalScalePercent &&
    a.kerningMinPt === b.kerningMinPt &&
    a.underline?.variant === b.underline?.variant &&
    a.underline?.color === b.underline?.color
  );
}

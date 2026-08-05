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

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { resolveOoxmlShadingFill } from './ooxml-shading.ts';

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
  /**
   * Character shading fill (`w:rPr/w:shd`), validated RRGGBB, or null.
   *
   * Paint applies this as the glyph-box background; a recognised highlight overrides it.
   * Measurement ignores shading.
   */
  readonly shading: string | null;
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
  /**
   * `w:vanish` (ECMA-376 §17.3.2.45): the run is hidden text.
   *
   * Word does not draw it AND does not paginate it — hidden index or comment text takes no
   * space at all. So this cannot be a paint-time opacity: a hidden run that is still measured
   * pushes every following line, and every following page break, to the wrong place. Layout
   * drops the content instead (see `piecesOfParagraph`).
   *
   * `w:specVanish` (§17.3.2.36) is a different property — an always-hidden paragraph mark on
   * a heading — and never sets this.
   */
  readonly hidden: boolean;
}

/** The style a run inherits when it authors nothing. */
export const DEFAULT_RUN_STYLE: ResolvedRunStyle = Object.freeze({
  fontFamily: null,
  // OOXML leaves the terminal fallback application-defined when no level in the style
  // hierarchy authors `w:sz`. Microsoft Word uses 10pt; 11pt comes from modern Normal
  // templates explicitly authoring `w:sz="22"`, not from the absence of a size.
  fontSizePt: 10,
  color: null,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  doubleStrike: false,
  highlight: null,
  shading: null,
  verticalAlign: 'baseline',
  baselineShiftPt: 0,
  caps: false,
  smallCaps: false,
  characterSpacingPt: 0,
  horizontalScalePercent: 100,
  kerningMinPt: 0,
  hidden: false,
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
 * The theme part's two Latin typefaces, for resolving `w:rFonts` theme attributes.
 *
 * Structurally identical to the binding lane's `DocumentThemeFonts` and assignable from it.
 * Declared here so this lane reads two validated strings rather than the theme tree.
 */
export interface ThemeFonts {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
}

/**
 * A `w:rFonts` theme attribute resolved to a typeface.
 *
 * Only the LATIN slots resolve: `minorEastAsia`/`minorBidi` (and major) name the `a:ea`/
 * `a:cs` faces this lane does not read, and an honest null — which falls back to the
 * explicit attribute beside it — beats the wrong font.
 */
function themeFamilyOf(value: string | undefined, themeFonts: ThemeFonts): string | null {
  if (value === 'minorAscii' || value === 'minorHAnsi') return themeFonts.minor;
  if (value === 'majorAscii' || value === 'majorHAnsi') return themeFonts.major;
  return null;
}

/**
 * Resolve one run's direct formatting.
 *
 * Unrecognised values are DROPPED rather than guessed: a `w:sz` of `"large"` leaves the
 * default size rather than inventing one, because a wrong measurement moves every glyph
 * after it and a missing one is visible immediately.
 *
 * `themeFonts` resolves `w:rFonts` theme references. Absent, a theme-only `rFonts` leaves
 * the family inherited — which is what every run of a theme-fonted document does, so the
 * whole document falls back to the surface default face.
 */
export function resolveRunStyle(
  props: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts
): ResolvedRunStyle {
  const style: {
    -readonly [K in keyof ResolvedRunStyle]: ResolvedRunStyle[K];
  } = { ...DEFAULT_RUN_STYLE };

  for (const property of props) {
    switch (property.localName) {
      case 'rFonts': {
        // `w:ascii` is the Latin face; `w:hAnsi` is the fallback this lane uses when it is
        // the only one authored. A theme attribute OVERRIDES the explicit one beside it
        // (§17.3.2.26): Word writes both, the concrete name only so legacy readers have
        // something to use, and following it would ignore a retheme the author can see.
        // An unresolvable theme slot falls back to that explicit name rather than to
        // nothing, because a stale face still beats no face at all.
        const attributes = property.attributes;
        const themed = themeFonts
          ? (themeFamilyOf(attributes?.asciiTheme, themeFonts) ??
            themeFamilyOf(attributes?.hAnsiTheme, themeFonts))
          : null;
        const family = themed ?? attributes?.ascii ?? attributes?.hAnsi;
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
      case 'shd': {
        // Strict hex fill only; theme/pattern rendering is deferred. Paint lets highlight
        // override this colour when both are present.
        style.shading = resolveOoxmlShadingFill(property.attributes) ?? null;
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
      case 'vanish':
        // A toggle like `w:b`, so a later `w:val="0"` from direct formatting un-hides text a
        // character style hid. `w:specVanish` is deliberately not folded in here.
        style.hidden = toggle(property);
        break;
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
  // Small caps changes glyph selection rather than the characters, so uppercasing here would
  // corrupt the text a copy produces. Resolving it belongs to the shaper — which does not do
  // it yet: no `smcp` feature is requested, so a small-caps run measures as plain lowercase
  // while paint asks the browser to synthesize it. That leaves the span the wrong WIDTH, but
  // breaking and caret edges agree with each other, so nothing drifts inside a run.
  return text;
}

/** Measure run text the way layout breaks lines and paints glyphs (caps/small-caps aware). */
export function measureDisplayText(
  text: string,
  style: ResolvedRunStyle,
  measurer: import('./semantic-records.ts').TextMeasurer
): number {
  return measurer.measure(displayText(text, style), style);
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
    a.shading === b.shading &&
    a.verticalAlign === b.verticalAlign &&
    a.baselineShiftPt === b.baselineShiftPt &&
    a.caps === b.caps &&
    a.smallCaps === b.smallCaps &&
    a.characterSpacingPt === b.characterSpacingPt &&
    a.horizontalScalePercent === b.horizontalScalePercent &&
    a.kerningMinPt === b.kerningMinPt &&
    a.hidden === b.hidden &&
    a.underline?.variant === b.underline?.variant &&
    a.underline?.color === b.underline?.color
  );
}

/**
 * How far a run's glyphs are lifted off the line's baseline, in points. Positive is up.
 *
 * Super and subscript move the GLYPHS without moving the run's box, so the box keeps tiling
 * the line and the selection band stays continuous. Anything drawing at the glyphs — the
 * painter, and the caret — has to apply this itself, and from one place, or the two drift.
 */
export function baselineShiftPtOf(style: ResolvedRunStyle): number {
  if (style.verticalAlign === 'superscript') return style.baselineShiftPt + style.fontSizePt * 0.33;
  if (style.verticalAlign === 'subscript') return style.baselineShiftPt - style.fontSizePt * 0.16;
  return style.baselineShiftPt;
}

// Which of a document's font families will actually RENDER in a substitute face.
//
// Paint and measurement share one fallback stack, so a family the platform cannot
// resolve still lays out and paints consistently — but in a different face than the
// author chose. Word surfaces that as a compatibility notice; this module answers the
// question the notice needs: "which declared families fell through to the fallback?".
//
// Detection is a canvas width probe, not `document.fonts.check`: `check()` answers
// "could the font system produce SOMETHING for this string", which is `true` for any
// installable family name, resolved or not. Comparing the advance of a sample string
// under `"<family>", monospace` against bare `monospace` (and again under `serif`)
// detects actual resolution: a family that resolved changes at least one of the two
// measurements, while an unresolved one leaves both at the generic face. A family
// metrically identical to BOTH generic defaults could in principle hide, but no real
// text face matches a monospace grid.
//
// "Resolved" is not the same question as "renders in a face the author would notice".
// A declared family the platform cannot resolve still measures and paints against the
// surface fallback stack, and for Calibri that stack names Carlito — the metric twin.
// Identical advance widths mean wrap and pagination land where Word puts them, so no
// fidelity is lost and there is nothing for a fidelity notice to report. Detection asks
// about the face measurement will really use, never about the declared name alone.

import { METRIC_COMPATIBLE_FALLBACK_FAMILIES } from '../layout/canvas-measurer.ts';

/** Measures a fixed sample under one CSS font shorthand; width in px. */
export type FontProbeMeasure = (font: string) => number;

const SAMPLE = 'The quick brown fox 0123 — {}#@';
const GENERIC_BASELINES = ['monospace', 'serif'] as const;

/**
 * The same family-name shape every other font sink enforces. Re-validated here because a
 * probe builds a CSS shorthand out of a file-derived name.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/**
 * A local-resolution probe over a canvas 2d context, memoized per family.
 *
 * `null` (no DOM, no canvas — headless hosts) yields a probe that reports every family
 * as resolved: without evidence a face is missing, no notice is shown.
 */
export function createLocalFontProbe(
  context: { font: string; measureText(text: string): { width: number } } | null
): (family: string) => boolean {
  if (!context) return () => true;
  const memo = new Map<string, boolean>();
  const measure: FontProbeMeasure = (font) => {
    context.font = font;
    return context.measureText(SAMPLE).width;
  };
  return (family: string): boolean => {
    const known = memo.get(family);
    if (known !== undefined) return known;
    // A name the shorthand grammar could misparse is never probed; reporting it resolved
    // keeps a hostile name out of both the probe and the notice.
    if (!FONT_NAME.test(family)) {
      memo.set(family, true);
      return true;
    }
    let resolved = false;
    for (const generic of GENERIC_BASELINES) {
      const base = measure(`32px ${generic}`);
      const withFamily = measure(`32px "${family}", ${generic}`);
      if (withFamily !== base) {
        resolved = true;
        break;
      }
    }
    memo.set(family, resolved);
    return resolved;
  };
}

/**
 * Symbol faces a document may claim from the resolver bound, whatever else it declares.
 *
 * Appending symbol faces after the declared list alone would let a template naming `cap`
 * families crowd every one of them out, so an app could never supply the face a private-use
 * glyph needs. Small on purpose: a file uses one or two symbol fonts, and the reservation
 * comes out of the declared families' share.
 */
const RESERVED_SYMBOL_FAMILIES = 4;

/**
 * The families one font-resolver call may ask for, in priority order and capped.
 *
 * Declared families first, symbol faces after them. Both are genuinely wanted — a symbol
 * face is the only thing that can paint an unmapped private-use glyph — but a face carrying
 * one dingbat must not spend the bound ahead of the face a page of text renders in.
 */
export function fontResolverFamilies(
  declared: readonly string[],
  symbols: readonly string[],
  cap: number
): readonly string[] {
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const family of symbols) {
    const fold = family.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    wanted.push(family);
  }
  // A FLOOR, not a ceiling: it only decides how much of the declared list steps aside, and
  // never more than half the bound, so a small `cap` cannot invert the priority. Whatever
  // room is left over still goes to the remaining symbol faces.
  const reserved = Math.min(wanted.length, RESERVED_SYMBOL_FAMILIES, Math.floor(cap / 2));
  const head = declared.slice(0, Math.max(cap - reserved, 0));
  // Deduplicate against the families that SURVIVED the cut, not the whole declared list.
  // Word writes a symbol face on the run too, so a checkbox face is usually declared as
  // well — and `documentFonts()` sorts by code point, which puts Symbol, Webdings and
  // Wingdings near the end of a long list. Folding them against a name the cut already
  // dropped would spend the reservation on nothing.
  const kept = new Set(head.map((family) => family.toLowerCase()));
  const tail = wanted.filter((family) => !kept.has(family.toLowerCase()));
  return [...head, ...tail].slice(0, cap);
}

/**
 * The document families that will render in a face with DIFFERENT metrics: not covered by
 * an embedded or app-supplied face, not resolvable by the platform, and with no
 * metric-compatible twin in the surface fallback stack either. Order follows `families`
 * (already sorted by the catalog).
 */
export function detectFontSubstitutions(
  families: readonly string[],
  covered: (family: string) => boolean,
  resolves: (family: string) => boolean
): readonly string[] {
  const substituted: string[] = [];
  for (const family of families) {
    if (covered(family)) continue;
    if (resolves(family)) continue;
    // The declared face is missing, but the stack may still fall through to its metric
    // twin. That is a substitution the user cannot measure and Word cannot out-paginate,
    // so it is not what this notice reports.
    const twin = METRIC_COMPATIBLE_FALLBACK_FAMILIES.get(family.toLowerCase());
    if (twin !== undefined && resolves(twin)) continue;
    substituted.push(family);
  }
  return substituted;
}

/**
 * The families a font configuration makes available, case-folded: every family a byte
 * source was ADMITTED for, plus every family a redirect points at one of those.
 *
 * The redirect half is what keeps the notice honest. `defaultFonts()` deliberately
 * answers "Times New Roman" with metric-compatible Liberation Serif, so the family IS
 * available — a document naming it wraps and paginates exactly as Word does, and
 * reporting it as unavailable told the user the opposite of the truth. A redirect whose
 * TARGET never made it through admission is not coverage, so the target is checked.
 *
 * Run to a fixed point, because redirects chain: A to B and B to C resolve whatever order
 * the list happens to be in. Bounded by the list length — each pass either adds a family
 * or is the last.
 */
export function coveredFontFamiliesOf(
  admitted: readonly { readonly request: { readonly family: string } }[],
  substitutions: readonly {
    readonly from: { readonly family: string };
    readonly to: { readonly family: string };
  }[]
): ReadonlySet<string> {
  const covered = new Set(admitted.map((source) => source.request.family.toLowerCase()));
  for (let pass = 0; pass < substitutions.length; pass += 1) {
    let grew = false;
    for (const substitution of substitutions) {
      const from = substitution.from.family.toLowerCase();
      if (covered.has(from) || !covered.has(substitution.to.family.toLowerCase())) continue;
      covered.add(from);
      grew = true;
    }
    if (!grew) break;
  }
  return covered;
}

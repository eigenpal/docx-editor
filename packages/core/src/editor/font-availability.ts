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

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
 * The document families that will render in a substitute: not covered by an embedded or
 * app-supplied face, and not resolvable by the platform. Order follows `families`
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
    substituted.push(family);
  }
  return substituted;
}

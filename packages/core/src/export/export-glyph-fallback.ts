import { shapeExportClusterFallback } from './export-cluster-fallback.ts';
import { orderFallbackFacesForCluster } from './export-color-font.ts';
import { shapeExportHyphenFallback } from './export-hyphen-fallback.ts';
import { synthesizeExportSmallCaps } from './export-small-caps.ts';
// Optional export fallback over admitted faces. Measurement and PDF glyph publication
// share this shaper, so fallback changes pagination before any painter runs.
import { createShapingEnvironment, type TextShaper } from '../layout/shaped-run.ts';
import {
  FontResolutionError,
  type FontRequest,
  type ResolvedFont,
} from '../layout/font-resource.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';

export function withExportGlyphFallbacks(
  shaping: LayoutShapingOptions,
  requests: readonly FontRequest[]
): LayoutShapingOptions {
  if (requests.length === 0) return shaping;
  if (requests.length > 16) throw new RangeError('At most 16 glyph fallback faces are supported');
  const fonts = requests
    .map((request) => shaping.fonts.resolve(request))
    .filter((font): font is ResolvedFont => !(font instanceof FontResolutionError));
  const compatible: TextShaper = {
    shape(input) {
      return shapeExportHyphenFallback(shaping.shaper, input, shaping.shaper.shape(input));
    },
  };
  const shaper: TextShaper = {
    shape(input) {
      const primary = synthesizeExportSmallCaps(compatible, input, compatible.shape(input));
      // Controls have no ink and are not evidence that a text face lacks coverage.
      if (!primary.glyphs.some((glyph) => glyph.id === 0) || /^[\t\n\r\f]*$/.test(input.text))
        return primary;
      // Preserve the authored face around missing symbols. Moving an entire Latin/CJK
      // run to a fallback also changes its supported letters, spaces and line breaks.
      // Joining scripts retain whole-run fallback so font boundaries do not sever joins.
      if (/^(Latn|Cyrl|Grek|Hani|Hira|Kana|Hang|Zyyy|Zinh)$/.test(input.environment.script)) {
        const mixed = shapeExportClusterFallback(compatible, input, primary, fonts);
        if (mixed) return mixed;
      }
      // Color faces go first for emoji presentation and last otherwise, so a dingbat stays a
      // symbol glyph and an emoji-default pictograph gets its color face.
      for (const font of orderFallbackFacesForCluster(fonts, input.text)) {
        if (
          font.hash === input.environment.font.hash &&
          font.faceIndex === input.environment.font.faceIndex
        )
          continue;
        try {
          const next = {
            ...input,
            environment: createShapingEnvironment({ ...input.environment, font }),
          };
          const run = synthesizeExportSmallCaps(compatible, next, compatible.shape(next));
          if (!run.glyphs.some((glyph) => glyph.id === 0)) return run;
        } catch {
          /* One unsupported fallback face does not hide later admitted faces. */
        }
      }
      // Partial font replacement cannot safely preserve joining-script context yet.
      // Keep uncovered runs explicit so strict exporters refuse them.
      return primary;
    },
  };
  return { ...shaping, shaper };
}

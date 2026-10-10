import type { FontConfiguration } from '../contracts/editor.ts';
import {
  createLayoutShapedMeasurer,
  FontResolutionError,
  fontRequestKey,
  resolveDefaultSurfaceMeasurer,
} from '../layout/index.ts';
import type { LayoutShapingOptions } from '../layout/index.ts';

export function resolvedFontMeasurement(
  shaping: LayoutShapingOptions,
  fonts: FontConfiguration,
  fallback: ReturnType<typeof resolveDefaultSurfaceMeasurer>,
  scale: number,
  epoch: number
) {
  const resolvedFonts = new Map<
    string,
    Exclude<ReturnType<typeof shaping.fonts.resolve>, FontResolutionError> | null
  >();
  const measurer = createLayoutShapedMeasurer(shaping, {
    resolveFont: (style) => {
      // The run family is FILE-DERIVED and reaches `resolve` on every measured run.
      // `resolve` ASSERTS its request (a whitespace-only family throws), and the
      // measurer calls this outside its own guard, so an unusable family must return
      // the fixed fallback here rather than throw through layout — which would fail
      // the remount and take the mounted document with it.
      const family = style.fontFamily ?? fonts.defaultFont.family;
      if (family.trim().length === 0) return null;
      const request = {
        family,
        weight: style.bold ? 700 : 400,
        style: style.italic ? ('italic' as const) : ('normal' as const),
      };
      const key = fontRequestKey(request);
      if (resolvedFonts.has(key)) return resolvedFonts.get(key) ?? null;
      let resolved: ReturnType<typeof shaping.fonts.resolve>;
      try {
        resolved = shaping.fonts.resolve(request);
      } catch {
        resolvedFonts.set(key, null);
        return null;
      }
      const usable = resolved instanceof FontResolutionError ? null : resolved;
      resolvedFonts.set(key, usable);
      return usable;
    },
    fallback: fallback.measurer,
  });
  // The fallback is part of the geometry producer: the same HarfBuzz faces over a
  // different unresolved-family measurer must never share paragraph-cache entries.
  const producer =
    `shaped:${shaping.operation.extensionFingerprint}` +
    `+algorithm:${shaping.operation.shapingHash}` +
    `+producer:${shaping.operation.producerVersion}` +
    `+fallback:${fallback.producer}@scale:${scale}+fonts:${epoch}`;
  return { measurer, producer };
}

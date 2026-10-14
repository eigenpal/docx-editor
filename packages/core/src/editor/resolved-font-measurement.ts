import { EditorFontError, type FontConfiguration } from '../contracts/editor.ts';
import {
  createLayoutShapedMeasurer,
  FontResolutionError,
  HarfBuzzShapingError,
  fontRequestKey,
  resolveDefaultSurfaceMeasurer,
} from '../layout/index.ts';
import type { LayoutShapingOptions, ResolvedFont, ShapeInput } from '../layout/index.ts';

export function resolvedFontMeasurement(
  shaping: LayoutShapingOptions,
  fonts: FontConfiguration,
  fallback: ReturnType<typeof resolveDefaultSurfaceMeasurer>,
  scale: number,
  epoch: number,
  onFontError?: (error: EditorFontError) => void
) {
  const resolvedFonts = new Map<
    string,
    Exclude<ReturnType<typeof shaping.fonts.resolve>, FontResolutionError> | null
  >();
  // Report a face's execution refusal once per measurement owner. Keep the original
  // exception and the bounded fallback; observation must not change layout geometry.
  const reportedFonts = new WeakSet<ResolvedFont>();
  const shaper = onFontError
    ? {
        shape(input: ShapeInput) {
          try {
            return shaping.shaper.shape(input);
          } catch (error) {
            const font = input.environment.font;
            if (
              error instanceof HarfBuzzShapingError &&
              error.code === 'fontOverLimit' &&
              !reportedFonts.has(font)
            ) {
              reportedFonts.add(font);
              // The face's own bytes exceed a limit: the same answer as an admission cap, not
              // a shaper that failed to initialize.
              const { family, weight, style } = font.request;
              try {
                onFontError(
                  new EditorFontError('overLimit', error.message, {
                    request: Object.freeze({ family, weight, style }),
                    diagnostic: error.diagnostic ?? error.message,
                    cause: error,
                  })
                );
              } catch {
                // A host diagnostic callback must not replace a shaping refusal.
              }
            }
            throw error;
          }
        },
      }
    : shaping.shaper;
  const measurer = createLayoutShapedMeasurer(
    { ...shaping, shaper },
    {
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
    }
  );
  // The fallback is part of the geometry producer: the same HarfBuzz faces over a
  // different unresolved-family measurer must never share paragraph-cache entries.
  const producer =
    `shaped:${shaping.operation.extensionFingerprint}` +
    `+algorithm:${shaping.operation.shapingHash}` +
    `+producer:${shaping.operation.producerVersion}` +
    `+fallback:${fallback.producer}@scale:${scale}+fonts:${epoch}`;
  return { measurer, producer };
}

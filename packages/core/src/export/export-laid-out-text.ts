// Exact shaped glyphs for laid-out spans, using the same policy as measurement.

import { FontResolutionError, fontRequestKey, type ResolvedFont } from '../layout/font-resource.ts';
import { displayText } from '../layout/run-style.ts';
import { styleForFontSlot } from '../layout/script-itemization.ts';
import { layoutFaceHasSmallCaps, shapeLayoutStyleRun } from '../layout/layout-run-shape.ts';
import type { ShapedRun } from '../layout/shaped-run.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import {
  describeAdmittedFontIdentity,
  type ExportAdmittedFontIdentity,
} from './document-export-font-resolution.ts';
import { ExportResourceError } from './export-session.ts';

/**
 * Exact shaped glyph run and admitted font identity for one published span.
 *
 * The run is shaped at the base size measurement uses. Callers apply the span's drawn-size
 * factor, horizontal scale, and character spacing from {@link StyleSpanRecord.style}.
 * `font` is a frozen byte-free descriptor; obtain bytes from the session font capability.
 * @public
 */
export interface ExportLaidOutText {
  readonly run: ShapedRun;
  readonly font: ExportAdmittedFontIdentity;
  readonly fixedPointScale: number;
}

/** Additive laid-out text shaping for font-backed export sessions and shared shaping. @public */
export interface ExportLaidOutTextApi {
  /**
   * Shape one published span with the same configuration and policy as measurement.
   * Returns null when measurement used the bounded fallback.
   */
  shapeLaidOutText(span: StyleSpanRecord): ExportLaidOutText | null;
}

/** Whether a value publishes {@link ExportLaidOutTextApi}. @public */
export function hasExportLaidOutText<T extends object>(
  value: T
): value is T & ExportLaidOutTextApi {
  return typeof (value as Partial<ExportLaidOutTextApi>).shapeLaidOutText === 'function';
}

function resolveShapingFont(
  shaping: LayoutShapingOptions,
  family: string,
  style: StyleSpanRecord['style'],
  cache: Map<string, ResolvedFont | FontResolutionError>
): ResolvedFont | null {
  if (family.trim().length === 0) return null;
  const request = {
    family,
    weight: style.bold ? 700 : 400,
    style: style.italic ? ('italic' as const) : ('normal' as const),
  };
  const key = fontRequestKey(request);
  let result = cache.get(key);
  if (!result) {
    try {
      result = shaping.fonts.resolve(request);
    } catch {
      return null;
    }
    cache.set(key, result);
  }
  return result instanceof FontResolutionError ? null : result;
}

/**
 * Bind one shaping substrate to the exporter-neutral laid-out text API.
 * @internal
 */
export function bindExportLaidOutText(
  shaping: LayoutShapingOptions
): ExportLaidOutTextApi['shapeLaidOutText'] {
  const resolved = new Map<string, ResolvedFont | FontResolutionError>();
  const smallCapsSupportByFont = new WeakMap<ResolvedFont, boolean>();
  return (span: StyleSpanRecord): ExportLaidOutText | null => {
    const faceStyle = styleForFontSlot(span.style, span.fontSlot);
    const text = displayText(span.text, faceStyle);
    if (text.length === 0) return null;
    const family = faceStyle.fontFamily ?? shaping.defaultFont.family;
    const font = resolveShapingFont(shaping, family, faceStyle, resolved);
    if (!font) return null;
    try {
      if (
        faceStyle.smallCaps &&
        !layoutFaceHasSmallCaps(
          shaping.shaper,
          shaping.environment,
          font,
          faceStyle,
          smallCapsSupportByFont
        )
      ) {
        return null;
      }
      const run = shapeLayoutStyleRun(shaping.shaper, shaping.environment, font, faceStyle, text);
      return Object.freeze({
        run,
        font: describeAdmittedFontIdentity(font),
        fixedPointScale: shaping.environment.fixedPointScale,
      });
    } catch {
      return null;
    }
  };
}

/**
 * Refuse laid-out shaping after abort or disposal; previously returned records stay readable.
 * @internal
 */
export function bindSessionExportLaidOutText(options: {
  readonly status: () => 'active' | 'aborted' | 'disposed';
  readonly unavailable: () => ExportResourceError;
  readonly shaping: () => ExportLaidOutTextApi | undefined;
}): ExportLaidOutTextApi['shapeLaidOutText'] {
  return (span: StyleSpanRecord): ExportLaidOutText | null => {
    if (options.status() !== 'active') throw options.unavailable();
    return options.shaping()?.shapeLaidOutText(span) ?? null;
  };
}

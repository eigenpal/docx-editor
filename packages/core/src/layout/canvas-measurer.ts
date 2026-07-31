// Browser/canvas-backed text measurement for the semantic layout lane.
//
// Layout itself stays DOM-free: this module is an optional adapter of the `TextMeasurer`
// port. The editor composition root selects it when a 2d canvas context is available and
// no host/shaping measurer was configured. SSR, tests under happy-dom (no real canvas),
// and non-browser runtimes keep the deterministic fixed measurer.
//
// Font shorthand construction mirrors `semantic-paint.ts` run-style semantics (family,
// point size, bold, italic, super/subscript shrink) so measured advances agree with the
// painted glyphs. Family names are file-derived: only the paint sink's allowlist is
// interpolated into the CSS font shorthand — never an unsanitized string.

import type { TextMeasurer } from './semantic-records.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { createFixedMeasurer } from './fixed-measurer.ts';

/**
 * The stack used when a run names no font (or names one the sink refuses).
 *
 * Paint only sets `font-family` when `w:rFonts` supplies a validated name, so an unstyled
 * run inherits the surrounding face. Measuring one stack and painting another drifts every
 * advance; this is the Word-like Latin fallback the canvas path measures against.
 */
export const DEFAULT_CANVAS_FONT_STACK = 'Calibri, Carlito, Helvetica, Arial, sans-serif';

/**
 * The same shape `semantic-paint.ts` enforces at the CSS sink (`FONT_NAME`).
 *
 * Kept in sync by value rather than import: layout must not depend on the output lane, and
 * the paint module re-validates at its own sink either way.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

export interface CanvasMeasurerOptions {
  /**
   * Layout units to CSS pixels — the same value the painter uses.
   *
   * Measuring at the layout size and multiplying afterwards is not the same as measuring at
   * the painted size: font metrics are hinted per pixel size. Everything here measures at
   * the painted size and converts back.
   */
  readonly scale?: number;
  readonly fallbackFamily?: string;
  /**
   * Test / host seam: supply a 2d context instead of creating a canvas.
   *
   * `undefined` means "create one from `document`"; an explicit `null` or a failed
   * `getContext` makes `tryCreateCanvasMeasurer` return null.
   */
  readonly context?: CanvasRenderingContext2D | null;
  /** Document used for the optional line-height probe. Defaults to the global `document`. */
  readonly ownerDocument?: Document | null;
}

export interface ResolvedSurfaceMeasurer {
  readonly measurer: TextMeasurer;
  /** Cache-invalidation identity when the caller did not supply `producer`. */
  readonly producer: 'canvas-measurer' | 'fixed-measurer';
}

/** Whether this environment can build a canvas-backed measurer without an injected context. */
export function isCanvasMeasurementAvailable(
  ownerDocument: Document | null | undefined = typeof document !== 'undefined' ? document : null
): boolean {
  if (!ownerDocument) return false;
  try {
    const canvas = ownerDocument.createElement('canvas');
    return Boolean(canvas.getContext?.('2d'));
  } catch {
    return false;
  }
}

/**
 * Build a canvas-backed measurer, or `null` when no 2d context is available.
 *
 * Prefer {@link resolveDefaultSurfaceMeasurer} at the editor surface: that keeps the
 * fixed fallback for SSR/tests in one place.
 */
export function tryCreateCanvasMeasurer(
  options: CanvasMeasurerOptions = {}
): TextMeasurer | null {
  const scale = options.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const fallbackFamily = options.fallbackFamily ?? DEFAULT_CANVAS_FONT_STACK;

  let context: CanvasRenderingContext2D | null;
  if (options.context !== undefined) {
    context = options.context;
  } else {
    const owner =
      options.ownerDocument !== undefined
        ? options.ownerDocument
        : typeof document !== 'undefined'
          ? document
          : null;
    if (!owner) return null;
    try {
      context = owner.createElement('canvas').getContext('2d');
    } catch {
      return null;
    }
  }
  if (!context) return null;

  const ownerDocument =
    options.ownerDocument !== undefined
      ? options.ownerDocument
      : typeof document !== 'undefined'
        ? document
        : null;

  const widthCache = new Map<string, number>();
  const metricsCache = new Map<string, { height: number; baseline: number }>();

  /**
   * A hidden element used to read the browser's own `line-height: normal` box.
   *
   * Canvas cannot report the line gap (`fontBoundingBox` is ascent + descent only), so a
   * DOM probe is the only way to match what paint's `line-height: normal` actually reserves.
   * Created lazily and reused.
   */
  let probe: HTMLElement | null = null;
  const lineProbe = (): HTMLElement | null => {
    if (probe) return probe;
    if (!ownerDocument?.body) return null;
    probe = ownerDocument.createElement('span');
    probe.textContent = 'Hxg';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.top = '-9999px';
    probe.style.left = '0';
    probe.style.whiteSpace = 'pre';
    probe.style.lineHeight = 'normal';
    ownerDocument.body.append(probe);
    return probe;
  };

  const fontOf = (style: ResolvedRunStyle): string => {
    // Re-validated at the sink: a font name is file-derived and this builds a CSS font
    // shorthand, so a name that could close the string is refused rather than escaped.
    const family =
      style.fontFamily && FONT_NAME.test(style.fontFamily)
        ? `"${style.fontFamily}", ${fallbackFamily}`
        : fallbackFamily;
    const weight = style.bold ? 'bold' : 'normal';
    const slant = style.italic ? 'italic' : 'normal';
    const size = style.fontSizePt * (style.verticalAlign === 'baseline' ? 1 : 0.75) * scale;
    return `${slant} ${weight} ${size}px ${family}`;
  };

  /** Painted pixels back to layout units, then the properties layout applies itself. */
  const scaled = (width: number, text: string, style: ResolvedRunStyle): number =>
    (width / scale) * (style.horizontalScalePercent / 100) +
    text.length * style.characterSpacingPt;

  return {
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = fontOf(style);
      const key = `${font}\0${text}`;
      const cached = widthCache.get(key);
      if (cached !== undefined) return scaled(cached, text, style);
      context.font = font;
      const width = context.measureText(text).width;
      widthCache.set(key, width);
      return scaled(width, text, style);
    },
    lineMetrics(style) {
      const size = style.fontSizePt * (style.verticalAlign === 'baseline' ? 1 : 0.75);
      const font = fontOf(style);
      const cached = metricsCache.get(font);
      if (cached) return cached;
      let height = size * 1.15;
      let baseline = size * 0.8;
      const el = lineProbe();
      if (el) {
        el.style.font = font;
        const rectHeight = el.getBoundingClientRect().height / scale;
        if (rectHeight > 0) height = rectHeight;
      }
      context.font = font;
      const ascent = context.measureText('Hxg').fontBoundingBoxAscent;
      if (Number.isFinite(ascent) && ascent > 0) baseline = ascent / scale;
      if (!(height > 0)) height = size * 1.15;
      const result = { height, baseline };
      metricsCache.set(font, result);
      return result;
    },
  };
}

/**
 * The surface's default measurer: canvas when a 2d context exists, otherwise fixed.
 *
 * Host-supplied and shaping measurers override this entirely — call only when the options
 * did not already name one.
 */
export function resolveDefaultSurfaceMeasurer(
  scale = 1,
  options: CanvasMeasurerOptions = {}
): ResolvedSurfaceMeasurer {
  const canvas = tryCreateCanvasMeasurer({ ...options, scale: options.scale ?? scale });
  if (canvas) return { measurer: canvas, producer: 'canvas-measurer' };
  return { measurer: createFixedMeasurer(), producer: 'fixed-measurer' };
}

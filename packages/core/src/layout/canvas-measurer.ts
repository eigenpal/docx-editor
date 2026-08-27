// Browser/canvas-backed text measurement for the semantic layout lane.
//
// Layout itself stays DOM-free: this module is an optional adapter of the `TextMeasurer`
// port. The editor composition root creates a 2d canvas context (the only browser seam)
// and injects it here. SSR, tests under happy-dom (no real canvas), and non-browser
// runtimes keep the deterministic fixed measurer.
//
// Font shorthand construction mirrors `semantic-paint.ts` run-style semantics (family,
// point size, bold, italic, super/subscript shrink) so measured advances agree with the
// painted glyphs. Family names are file-derived: only the paint sink's allowlist is
// interpolated into the CSS font shorthand — never an unsanitized string.
//
// Line metrics come from canvas `fontBoundingBox*` (ascent + descent) when the host
// reports them, otherwise a bounded size×1.15 / 0.8 fallback. Paint consumes the
// layout-published line height as an explicit pixel value — never CSS `line-height:
// normal` — so this module must not mount a DOM probe or call `getBoundingClientRect`.
//
// The line box has to agree with `shaped-measurer.ts`, because this measurer is not only a
// per-run fallback: `resolveDefaultSurfaceMeasurer` hands it to the surface as the WHOLE
// document's measurer whenever a 2d context exists and no shaper was injected. A file that
// paginated one way with HarfBuzz loaded and another without it is a fidelity bug, not a
// degraded fallback.
//
// Word's single-spaced line box is ascent + descent + `hhea.lineGap`, and `TextMetrics`
// reports no leading at all — there is no `fontBoundingBoxLeading`, and the one place a
// browser sums the three is CSS `line-height: normal`, which this module may not reach for.
// What the face box IS, though, is a lower bound on Word's box, because the term it omits
// is non-negative. So the height below is the larger of that bound and the deterministic
// 1.15 em floor. Measured in Chrome against the five shipped faces, at 10/20/40/80 px:
//
//   Liberation Sans   face -4.3%   max  0.0%      Caladea          face 0..4.3%  max same
//   Liberation Serif  face -4.3%   max  0.0%      Liberation Mono  face -2.9..1.5%  max 1.5%
//   Carlito           face -1.7..6.5%  max same
//
// The two faces carrying a gap — Arial's and Times New Roman's — come onto Word's number,
// and no face gets worse than the 1.5% ceiling. Chrome also rounds `fontBoundingBox*` to
// whole pixels, which is why the face box alone wanders at small sizes.

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
 * Declared family (case-folded) → the METRIC-COMPATIBLE face this stack falls through to
 * when the declared one is not installed.
 *
 * Only families whose substitute actually appears in {@link DEFAULT_CANVAS_FONT_STACK}
 * belong here, because only those are what the browser will really pick: a run declaring
 * `Times New Roman` is measured against `"Times New Roman", ${DEFAULT_CANVAS_FONT_STACK}`,
 * which names no serif substitute, so an installed Liberation Serif never gets used and
 * must not be claimed. Carlito is Calibri's metric twin — identical advance widths — so a
 * Calibri run on a host with Carlito wraps and paginates exactly where Word puts it, in
 * both measurement and paint (the paint sink trails the same stack).
 *
 * The compatibility notice reads this to avoid warning about a substitution that costs no
 * fidelity. `packages/core/src/layout/__tests__/canvas-measurer.test.ts` pins every entry
 * against the stack so the two cannot drift.
 */
export const METRIC_COMPATIBLE_FALLBACK_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['calibri', 'Carlito'],
]);

/**
 * Default width-cache capacity before least-recently-used eviction.
 *
 * Sized past the working set of a several-hundred-page document: the canvas path carries
 * whole cold opens (fonts still resolving) and the per-run fallback of the shaped
 * measurer, and a cap under the distinct-string count made every full pass re-measure
 * what the previous one had just evicted.
 */
export const DEFAULT_MAX_CANVAS_WIDTH_CACHE_ENTRIES = 65536;
/** Default line-metrics cache capacity (one entry per distinct font shorthand). */
export const DEFAULT_MAX_CANVAS_METRICS_CACHE_ENTRIES = 256;

interface BoundedLruCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly size: number;
  readonly evictions: number;
}

/** Finite positive cache capacity: undefined → fallback; invalid explicit → 1; else floor. */
function normalizeCacheCapacity(raw: number | undefined, fallback: number): number {
  if (raw === undefined) return Math.max(1, Math.floor(fallback));
  if (!(Number.isFinite(raw) && raw > 0)) return 1;
  return Math.max(1, Math.floor(raw));
}

function createBoundedLruCache<K, V>(capacity: number): BoundedLruCache<K, V> {
  const entries = new Map<K, V>();
  let evictions = 0;
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
        evictions += 1;
      }
    },
    get size() {
      return entries.size;
    },
    get evictions() {
      return evictions;
    },
  };
}

/**
 * The same shape `semantic-paint.ts` enforces at the CSS sink (`FONT_NAME`).
 *
 * Kept in sync by value rather than import: layout must not depend on the output lane, and
 * the paint module re-validates at its own sink either way.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/**
 * The canvas text-metrics surface the editor injects.
 *
 * Structural subset of `CanvasRenderingContext2D` — declared here so the layout lane stays
 * off the DOM lib. Hosts pass a real 2d context; tests pass a controllable mock.
 */
export interface CanvasTextMetrics {
  readonly width: number;
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
}

/**
 * The slice of a 2D canvas context measurement needs.
 *
 * A structural subset rather than `CanvasRenderingContext2D`, so layout stays DOM-free and a test
 * can supply a deterministic stub.
 */
export interface CanvasTextContext {
  font: string;
  measureText(text: string): CanvasTextMetrics;
}

/**
 * How the canvas measurer resolves fonts, scales, and bounds its caches. Every field optional.
 *
 * Layout never creates a canvas itself: without a `context` this measurer does not exist and the
 * surface falls back to fixed metrics.
 */
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
   * The engine-minted family a document-embedded face was registered under, if any.
   *
   * Paint prefers this alias over the declared family, so measurement has to as well: a
   * document whose face is embedded rather than installed would otherwise be measured
   * against the fallback and painted with the embedded glyphs, and every advance, wrap
   * point and page break would be taken from a font the reader never sees.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /**
   * Injected 2d text context from the editor/browser seam.
   *
   * `undefined` or `null` makes {@link tryCreateCanvasMeasurer} return null so the surface
   * falls back to the fixed measurer. Layout never creates a canvas element itself.
   */
  readonly context?: CanvasTextContext | null;
  /**
   * Unique `(font, text)` width entries retained before LRU eviction.
   *
   * Long editing sessions measure many transient paragraph states; bounding this cache keeps
   * memory predictable without changing layout output.
   */
  readonly maxWidthEntries?: number;
  /** Distinct font-shorthand line metrics retained before LRU eviction. */
  readonly maxMetricsEntries?: number;
}

/**
 * The measurer a surface ended up with, plus the identity its cache keys must include.
 *
 * The `producer` string is load-bearing: the same canvas measuring against document-embedded
 * faces produces DIFFERENT advances, so the two must not share a cache key space or a document
 * would keep its pre-font pagination after the font arrived.
 */
export interface ResolvedSurfaceMeasurer {
  readonly measurer: TextMeasurer;
  /**
   * Cache-invalidation identity when the caller did not supply `producer`.
   *
   * `canvas-measurer+embedded` is the canvas measurer resolving document-embedded faces:
   * the same canvas, different advances, so it must not share a cache key space.
   */
  readonly producer: 'canvas-measurer' | 'canvas-measurer+embedded' | 'fixed-measurer';
}

/**
 * Whether an injected canvas text context is usable for measurement.
 *
 * Availability is decided by the editor seam (which alone may create a canvas). Layout
 * never probes `document` — a missing context is simply "unavailable".
 */
export function isCanvasMeasurementAvailable(
  context: CanvasTextContext | null | undefined = null
): boolean {
  return context != null && typeof context.measureText === 'function';
}

/**
 * Build a canvas-backed measurer, or `null` when no 2d context was injected.
 *
 * Prefer {@link resolveDefaultSurfaceMeasurer} at the editor surface: that keeps the
 * fixed fallback for SSR/tests in one place.
 */
export function tryCreateCanvasMeasurer(options: CanvasMeasurerOptions = {}): TextMeasurer | null {
  const scale = options.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const fallbackFamily = options.fallbackFamily ?? DEFAULT_CANVAS_FONT_STACK;
  const context = options.context ?? null;
  if (!isCanvasMeasurementAvailable(context)) return null;
  // Narrowed by the guard above.
  const ctx = context!;

  const widthCache = createBoundedLruCache<string, number>(
    normalizeCacheCapacity(options.maxWidthEntries, DEFAULT_MAX_CANVAS_WIDTH_CACHE_ENTRIES)
  );
  const metricsCache = createBoundedLruCache<string, { height: number; baseline: number }>(
    normalizeCacheCapacity(options.maxMetricsEntries, DEFAULT_MAX_CANVAS_METRICS_CACHE_ENTRIES)
  );

  const fontAlias = options.fontAlias;
  const fontOf = (style: ResolvedRunStyle): string => {
    // Re-validated at the sink: a font name is file-derived and this builds a CSS font
    // shorthand, so a name that could close the string is refused rather than escaped.
    // The alias is engine-minted, never file-derived, and is validated on the same rule
    // so one code path cannot become the hole the other closed.
    const declared = style.fontFamily && FONT_NAME.test(style.fontFamily) ? style.fontFamily : null;
    const aliased = declared ? fontAlias?.(declared) : undefined;
    const alias = aliased && FONT_NAME.test(aliased) ? aliased : null;
    const family = declared
      ? alias
        ? `"${alias}", "${declared}", ${fallbackFamily}`
        : `"${declared}", ${fallbackFamily}`
      : fallbackFamily;
    const weight = style.bold ? 'bold' : 'normal';
    const slant = style.italic ? 'italic' : 'normal';
    const size = style.fontSizePt * (style.verticalAlign === 'baseline' ? 1 : 0.75) * scale;
    return `${slant} ${weight} ${size}px ${family}`;
  };

  /** Painted pixels back to layout units, then the properties layout applies itself. */
  const scaled = (width: number, text: string, style: ResolvedRunStyle): number =>
    (width / scale) * (style.horizontalScalePercent / 100) + text.length * style.characterSpacingPt;

  return {
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = fontOf(style);
      const key = `${font}\0${text}`;
      const cached = widthCache.get(key);
      if (cached !== undefined) return scaled(cached, text, style);
      ctx.font = font;
      const width = ctx.measureText(text).width;
      widthCache.set(key, width);
      return scaled(width, text, style);
    },
    lineMetrics(style) {
      const size = style.fontSizePt * (style.verticalAlign === 'baseline' ? 1 : 0.75);
      const font = fontOf(style);
      const cached = metricsCache.get(font);
      if (cached) return cached;

      // Deterministic fallback: same 1.15 / 0.8 ratios the pre-canvas path used when the
      // host could not report font bounding boxes.
      let height = size * 1.15;
      let baseline = size * 0.8;

      ctx.font = font;
      const metrics = ctx.measureText('Hxg');
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      if (typeof ascent === 'number' && Number.isFinite(ascent) && ascent > 0) {
        baseline = ascent / scale;
        if (typeof descent === 'number' && Number.isFinite(descent) && descent >= 0) {
          // Canvas reports the face box (ascent + descent) and no leading, so it is a LOWER
          // BOUND on Word's ascent + descent + `hhea.lineGap`: short by the gap for a face
          // that carries one, exact for a face that does not. Take the larger of it and the
          // deterministic 1.15 em floor, which is Word's own ratio for the gapped faces.
          // See the module header for the measured error per face.
          const box = (ascent + descent) / scale;
          if (box > 0) height = Math.max(box, height);
        }
      }
      if (!(height > 0)) height = size * 1.15;
      const result = { height, baseline };
      metricsCache.set(font, result);
      return result;
    },
  };
}

/**
 * The surface's default measurer: canvas when a 2d context was injected, otherwise fixed.
 *
 * Host-supplied and shaping measurers override this entirely — call only when the options
 * did not already name one. The editor seam is responsible for creating the canvas context.
 */
export function resolveDefaultSurfaceMeasurer(
  scale = 1,
  options: CanvasMeasurerOptions = {}
): ResolvedSurfaceMeasurer {
  const canvas = tryCreateCanvasMeasurer({ ...options, scale: options.scale ?? scale });
  // The producer folds into every layout cache key. Registering embedded faces changes
  // every advance in the document while no content changes to say so, so a measurer that
  // resolves aliases must not share a key space with one that does not.
  if (canvas) {
    return {
      measurer: canvas,
      producer: options.fontAlias ? 'canvas-measurer+embedded' : 'canvas-measurer',
    };
  }
  return { measurer: createFixedMeasurer(), producer: 'fixed-measurer' };
}

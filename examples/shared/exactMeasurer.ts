// A measurer and a painted face that are guaranteed to be the SAME font (task 7.7).
//
// Exact metrics only buy exactness if the bytes measured are the bytes painted. Measure
// Calibri's real tables, paint whatever the browser substitutes, and the disagreement just
// moves from the measurer to the renderer — advances drift along the line and every run
// ends a fraction away from where layout put it.
//
// So the same `ArrayBuffer` does both jobs: it is handed to the shaper as font resources,
// and registered with the browser through `FontFace` so CSS resolves that exact face. The
// document then renders in the demo face rather than in whatever the document asked for,
// which is honest for a harness — it is proving metric agreement, not font coverage.
//
// Falls back to canvas measurement when the fonts cannot be loaded, so the demo still runs.

import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type ResolvedFont,
  type TextMeasurer,
} from '@docx-editor.dev/engine-layout';
import { createCanvasMeasurer } from './canvasMeasurer.ts';
import { resolveFontFamily, type FontOrigin } from './fontAvailability.ts';
import { requestRemoteFont } from './remoteFonts.ts';

/** The face the harness measures and paints with. */
export const EXACT_FONT_FAMILY = 'DejaVu Sans';

/**
 * Families the harness ALIASES onto the demo face.
 *
 * The painter applies whatever family a run names, so a run asking for Times New Roman is
 * painted in the real Times while the shaper measured the demo face — advances disagree and
 * the run overruns the line reserved for it. Registering the demo bytes under these names
 * makes CSS resolve exactly what was measured.
 *
 * This is a HARNESS device, not font coverage: it proves metric agreement. Real coverage
 * means metric-compatible substitutes per family (Carlito for Calibri, Caladea for
 * Cambria), which is the remaining half of task 7.7.
 */
const ALIASED_FAMILIES = [
  'Arial',
  'Calibri',
  'Cambria',
  'Courier New',
  'Georgia',
  'Times New Roman',
  'Verdana',
] as const;

const REGULAR: FontRequest = { family: EXACT_FONT_FAMILY, weight: 400, style: 'normal' };
const BOLD: FontRequest = { family: EXACT_FONT_FAMILY, weight: 700, style: 'normal' };

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url.pathname} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Register a face with the browser from the very bytes the shaper was given. */
async function paintWith(bytes: Uint8Array, weight: number, family: string): Promise<void> {
  // A copy per registration, because `FontFace` takes ownership of the buffer it is handed
  // and the shaper still needs its own.
  const face = new FontFace(family, bytes.slice().buffer as ArrayBuffer, {
    weight: String(weight),
    style: 'normal',
  });
  await face.load();
  document.fonts.add(face);
}

/**
 * Where each family the document names ended up coming from.
 *
 * Reported rather than hidden, because "we painted Calibri" and "we painted something that
 * is not Calibri" are different claims and only one of them is fidelity.
 */
export type FontOriginReport = ReadonlyMap<string, FontOrigin>;

export interface ExactMeasurer {
  readonly measurer: TextMeasurer;
  /** The CSS family to paint with, or null when the exact face is unavailable. */
  readonly fontFamily: string | null;
  /** Resolve one family through the chain, recording where it came from. */
  readonly resolve: (family: string) => FontOrigin;
  readonly origins: FontOriginReport;
}

export interface ExactMeasurerOptions {
  /**
   * Allow fetching families the machine lacks from a third-party provider.
   *
   * Off unless the host says otherwise: a family name comes out of the document, so the
   * request itself discloses something about it.
   */
  readonly allowRemoteFonts?: boolean;
}

export async function createExactMeasurer(
  scale: number,
  options: ExactMeasurerOptions = {}
): Promise<ExactMeasurer> {
  try {
    await initializeHarfBuzz();
    const [regular, bold] = await Promise.all([
      fetchBytes(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
      fetchBytes(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
    ]);
    await Promise.all(
      [EXACT_FONT_FAMILY, ...ALIASED_FAMILIES].flatMap((family) => [
        paintWith(regular, 400, family),
        paintWith(bold, 700, family),
      ])
    );

    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 4_000_000,
      resources: [
        { request: REGULAR, id: 'demo-400', bytes: regular, hash: sha256FontBytes(regular), faceIndex: 0 },
        { request: BOLD, id: 'demo-700', bytes: bold, hash: sha256FontBytes(bold), faceIndex: 0 },
      ],
      validateFont: harfBuzzFontValidator,
    });

    const resolve = (request: FontRequest): ResolvedFont | null => {
      const result = snapshot.resolve(request);
      return result instanceof FontResolutionError ? null : result;
    };

    // The chain, in order: what the document embeds, then what the machine has, then a
    // provider if the host allowed one, then an honest fallback.
    const embeddedFamilies = new Set<string>([EXACT_FONT_FAMILY, ...ALIASED_FAMILIES]);
    const origins = new Map<string, FontOrigin>();
    const requested = new Set<string>();
    const resolve = (family: string): FontOrigin => {
      const known = origins.get(family);
      if (known) return known;
      const resolution = resolveFontFamily(family, {
        embedded: embeddedFamilies,
        fetchRemote: (name) =>
          requestRemoteFont(name, { enabled: options.allowRemoteFonts === true, requested }),
      });
      origins.set(family, resolution.origin);
      return resolution.origin;
    };

    return {
      measurer: createShapedMeasurer({
        shaper: createHarfBuzzTextShaper(),
        // Weight is the only axis the demo carries two faces for; italic is synthesised by
        // the browser, so measuring the upright face is what actually gets painted.
        resolveFont: (style) => resolve(style.bold ? BOLD : REGULAR),
        fallback: createFixedMeasurer(),
        shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
        unicodeDataVersion: '15.1',
      }),
      fontFamily: EXACT_FONT_FAMILY,
      resolve,
      origins,
    };
  } catch {
    // No exact face: measure the browser's own metrics instead, and let CSS pick the family.
    // No exact face: measure the browser's own metrics, and report every family as a
    // fallback rather than implying a match.
    return {
      measurer: createCanvasMeasurer(scale),
      fontFamily: null,
      resolve: () => 'fallback',
      origins: new Map(),
    };
  }
}

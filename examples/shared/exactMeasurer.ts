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

/** The face the harness measures and paints with. */
export const EXACT_FONT_FAMILY = 'DejaVu Sans';

const REGULAR: FontRequest = { family: EXACT_FONT_FAMILY, weight: 400, style: 'normal' };
const BOLD: FontRequest = { family: EXACT_FONT_FAMILY, weight: 700, style: 'normal' };

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url.pathname} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Register a face with the browser from the very bytes the shaper was given. */
async function paintWith(bytes: Uint8Array, weight: number): Promise<void> {
  // A copy, because `FontFace` takes ownership of the buffer it is handed and the shaper
  // still needs its own.
  const face = new FontFace(EXACT_FONT_FAMILY, bytes.slice().buffer as ArrayBuffer, {
    weight: String(weight),
    style: 'normal',
  });
  await face.load();
  document.fonts.add(face);
}

export interface ExactMeasurer {
  readonly measurer: TextMeasurer;
  /** The CSS family to paint with, or null when the exact face is unavailable. */
  readonly fontFamily: string | null;
}

export async function createExactMeasurer(scale: number): Promise<ExactMeasurer> {
  try {
    await initializeHarfBuzz();
    const [regular, bold] = await Promise.all([
      fetchBytes(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
      fetchBytes(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
    ]);
    await Promise.all([paintWith(regular, 400), paintWith(bold, 700)]);

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
    };
  } catch {
    // No exact face: measure the browser's own metrics instead, and let CSS pick the family.
    return { measurer: createCanvasMeasurer(scale), fontFamily: null };
  }
}

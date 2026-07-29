// Immutable shaping inputs for one layout operation, plus a contract-level test double.
import {
  FontResolutionError,
  createFontResourceSnapshot,
  sha256FontBytes,
  type FontRequest,
  type FontResourceSnapshot,
} from './font-resource.ts';
import type {
  FixedPointRoundingMode,
  NormalizationPolicy,
  TextShaper,
  VersionedShapingLibrary,
} from './shaped-run.ts';
import { createShapedRun, createShapingEnvironment, fixedPoint } from './shaped-run.ts';
import type { OperationSnapshot } from './resolved-cache.ts';
import { segmentGraphemes } from './grapheme.ts';

export interface LayoutShapingOptions {
  readonly fonts: FontResourceSnapshot;
  readonly shaper: TextShaper;
  readonly defaultFont: {
    readonly family: string;
    readonly sizeHalfPoints: number;
  };
  readonly environment: {
    readonly variationAxes: Readonly<Record<string, number>>;
    readonly shapingLibrary: VersionedShapingLibrary;
    readonly unicodeDataVersion: string;
    readonly normalization: NormalizationPolicy;
    readonly language: string;
    readonly features: Readonly<Record<string, number>>;
    readonly fixedPointScale: number;
    readonly roundingMode: FixedPointRoundingMode;
  };
  readonly ligatureCaretPolicy: 'cluster-edges-only';
  readonly operation: OperationSnapshot;
}

const DETERMINISTIC_LIBRARY = Object.freeze({ name: 'DeterministicTestShaper', version: '1.0.0' });
const SYNTHETIC_SFNT = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const SYNTHETIC_HASH = sha256FontBytes(SYNTHETIC_SFNT);

export interface DeterministicLayoutShapingOptions {
  readonly regularAdvance?: number;
  readonly boldAdvance?: number;
  readonly lineHeight?: number;
  readonly family?: string;
  readonly families?: readonly string[];
}

/** Deterministic test double expressed only through the production font and shaper contracts. */
export function createDeterministicLayoutShaping(
  options: DeterministicLayoutShapingOptions = {}
): LayoutShapingOptions {
  const family = options.family ?? 'Deterministic Test';
  const families = [...new Set([family, ...(options.families ?? [])])];
  const requests: readonly FontRequest[] = families.flatMap((requestFamily) => [
    { family: requestFamily, weight: 400, style: 'normal' },
    { family: requestFamily, weight: 700, style: 'normal' },
    { family: requestFamily, weight: 400, style: 'italic' },
    { family: requestFamily, weight: 700, style: 'italic' },
  ]);
  const fonts = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: SYNTHETIC_SFNT.byteLength,
    resources: requests.map((request) => ({
      request,
      id: `${family}-${request.weight}-${request.style}`,
      bytes: SYNTHETIC_SFNT,
      hash: SYNTHETIC_HASH,
      faceIndex: 0,
    })),
    validateFont: () => ({ valid: true }),
  });
  const regularAdvance = options.regularAdvance ?? 120;
  const boldAdvance = options.boldAdvance ?? 130;
  const lineHeight = options.lineHeight ?? 240;
  const shaper: TextShaper = {
    shape(input) {
      const font = fonts.resolve(input.environment.font.request);
      if (font instanceof FontResolutionError) throw font;
      const scale = input.fontSizeHalfPoints / 24;
      const advance = Math.round(
        (input.environment.font.request.weight >= 700 ? boldAdvance : regularAdvance) * scale
      );
      const glyphs = [];
      const clusters = [];
      let glyphIndex = 0;
      let originX = 0;
      for (const segment of segmentGraphemes(input.text)) {
        glyphs.push({
          id: input.text.codePointAt(segment.utf16From) ?? 0,
          cluster: segment.utf16From,
          originX: fixedPoint(originX),
          originY: fixedPoint(0),
          advanceX: fixedPoint(advance),
          advanceY: fixedPoint(0),
          offsetX: fixedPoint(0),
          offsetY: fixedPoint(0),
          outline: Object.freeze({
            path: 'M0,0L750,0L750,750L0,750Z',
            unitsPerEm: 1000,
          }),
        });
        clusters.push({
          textStart: segment.utf16From,
          textEnd: segment.utf16To,
          glyphStart: glyphIndex,
          glyphEnd: glyphIndex + 1,
          advance: fixedPoint(advance),
          caretEdges: [fixedPoint(0), fixedPoint(advance)],
          fontSpan: 0,
        });
        glyphIndex += 1;
        originX += advance;
      }
      const environment = createShapingEnvironment(input.environment);
      return createShapedRun(
        {
          text: input.text,
          direction: input.environment.direction,
          bidiLevel: input.bidiLevel,
          glyphs,
          clusters,
          fontSpans:
            glyphs.length > 0
              ? [{ glyphStart: 0, glyphEnd: glyphs.length, font, fallbackIndex: null }]
              : [],
          metrics: {
            ascent: fixedPoint(Math.round(lineHeight * 0.8 * scale)),
            descent: fixedPoint(Math.round(lineHeight * 0.2 * scale)),
            lineGap: fixedPoint(0),
          },
        },
        environment
      );
    },
  };
  return Object.freeze({
    fonts,
    shaper,
    defaultFont: Object.freeze({ family, sizeHalfPoints: 24 }),
    environment: Object.freeze({
      variationAxes: Object.freeze({}),
      shapingLibrary: DETERMINISTIC_LIBRARY,
      unicodeDataVersion: '16.0.0',
      normalization: 'none',
      language: 'und',
      features: Object.freeze({ kern: 0, liga: 0 }),
      fixedPointScale: 20,
      roundingMode: 'halfAwayFromZero',
    }),
    ligatureCaretPolicy: 'cluster-edges-only',
    operation: Object.freeze({
      resourceEpoch: fonts.epoch,
      configEpoch: 0,
      extensionFingerprint: 'test:none',
      shapingHash: 'deterministic-test-shaper:1',
      producerVersion: 1,
    }),
  });
}

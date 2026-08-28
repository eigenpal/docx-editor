// Word font-metric regression gate over privacy-safe synthetic strings.
//
// Expected advances and vertical metrics come from Word PDF font subsets. The source
// documents and their text stay outside the repository. Each string was authored for this gate.

import { readFileSync } from 'node:fs';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type ResolvedRunStyle,
} from '../../core/src/layout/index.ts';
import { GOOGLE_FONT_CATALOG } from '../src/google-catalog.generated.ts';

interface WidthCase {
  readonly family: 'Century Gothic' | 'Montserrat' | 'Montserrat Light';
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
  readonly text: string;
  readonly wordWidthPt: number;
  readonly wordLineHeightPt: number;
  readonly wordBaselinePt: number;
}

const WIDTH_TOLERANCE_PT = 0.4;
const VERTICAL_TOLERANCE_PT = 0.1;
const WIDTH_CASES: readonly WidthCase[] = [
  {
    family: 'Century Gothic',
    weight: 400,
    style: 'normal',
    text: 'Document layout',
    wordWidthPt: 84.95,
    wordLineHeightPt: 11.9140625,
    wordBaselinePt: 9.7119140625,
  },
  {
    family: 'Century Gothic',
    weight: 400,
    style: 'normal',
    text: 'Reliable page breaks',
    wordWidthPt: 103.15,
    wordLineHeightPt: 11.9140625,
    wordBaselinePt: 9.7119140625,
  },
  {
    family: 'Montserrat',
    weight: 400,
    style: 'normal',
    text: 'Page metrics',
    wordWidthPt: 66.45,
    wordLineHeightPt: 12.2,
    wordBaselinePt: 9.7,
  },
  {
    family: 'Montserrat Light',
    weight: 400,
    style: 'normal',
    text: 'Design project',
    wordWidthPt: 72.75,
    wordLineHeightPt: 12.2,
    wordBaselinePt: 9.7,
  },
  {
    family: 'Montserrat',
    weight: 700,
    style: 'normal',
    text: 'Contact details',
    wordWidthPt: 79.4,
    wordLineHeightPt: 12.2,
    wordBaselinePt: 9.7,
  },
];

const assetsDir = new URL('../assets/', import.meta.url);

async function bytesFor(testCase: WidthCase): Promise<Uint8Array> {
  if (testCase.family === 'Century Gothic') {
    const suffix =
      testCase.style === 'italic'
        ? testCase.weight === 700
          ? 'BoldItalic'
          : 'Italic'
        : testCase.weight === 700
          ? 'Bold'
          : 'Regular';
    return new Uint8Array(readFileSync(new URL(`TeXGyreAdventor-${suffix}.otf`, assetsDir)));
  }
  const face = GOOGLE_FONT_CATALOG.find(
    (candidate) =>
      candidate.family === testCase.family &&
      candidate.weight === testCase.weight &&
      candidate.style === testCase.style
  );
  if (!face) throw new Error(`No catalog face for ${testCase.family}`);
  const response = await fetch(face.url);
  if (!response.ok) throw new Error(`${face.url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== face.byteLength || sha256FontBytes(bytes) !== face.hash) {
    throw new Error(`Catalog bytes changed for ${testCase.family}`);
  }
  return bytes;
}

await initializeHarfBuzz();
const shaper = createHarfBuzzTextShaper();
try {
  for (const testCase of WIDTH_CASES) {
    const bytes = await bytesFor(testCase);
    const resolvedFamily =
      testCase.family === 'Century Gothic' ? 'TeX Gyre Adventor' : testCase.family;
    const resolvedRequest = {
      family: resolvedFamily,
      weight: testCase.weight,
      style: testCase.style,
    };
    const requestedFace = {
      family: testCase.family,
      weight: testCase.weight,
      style: testCase.style,
    };
    const fonts = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 2 * 1024 * 1024,
      resources: [
        {
          request: resolvedRequest,
          id: `width-fidelity:${resolvedFamily}:${testCase.weight}:${testCase.style}`,
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      ...(testCase.family === 'Century Gothic'
        ? {
            substitutions: [
              {
                from: requestedFace,
                to: resolvedRequest,
                lineMetrics: { heightEm: 1.19140625, baselineEm: 0.97119140625 },
              },
            ],
          }
        : {}),
      validateFont: harfBuzzFontValidator,
    });
    const font = fonts.resolve(requestedFace);
    if (font instanceof FontResolutionError) throw font;
    const measurer = createShapedMeasurer({
      shaper,
      resolveFont: () => font,
      fallback: createFixedMeasurer(),
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      fixedPointScale: 20,
    });
    const runStyle: ResolvedRunStyle = {
      ...DEFAULT_RUN_STYLE,
      fontFamily: testCase.family,
      fontSizePt: 10,
      bold: testCase.weight === 700,
      italic: testCase.style === 'italic',
    };
    const actual = measurer.measure(testCase.text, runStyle);
    const difference = Math.abs(actual - testCase.wordWidthPt);
    if (difference > WIDTH_TOLERANCE_PT + Number.EPSILON) {
      throw new Error(
        `${testCase.family} ${testCase.weight}/${testCase.style} width ${actual.toFixed(2)}pt ` +
          `differs from Word by ${difference.toFixed(2)}pt; limit ${WIDTH_TOLERANCE_PT.toFixed(2)}pt`
      );
    }
    const line = measurer.lineMetrics(runStyle);
    const heightDifference = Math.abs(line.height - testCase.wordLineHeightPt);
    const baselineDifference = Math.abs(line.baseline - testCase.wordBaselinePt);
    if (
      heightDifference > VERTICAL_TOLERANCE_PT + Number.EPSILON ||
      baselineDifference > VERTICAL_TOLERANCE_PT + Number.EPSILON
    ) {
      throw new Error(
        `${testCase.family} ${testCase.weight}/${testCase.style} line metrics ` +
          `${line.height.toFixed(2)}pt/${line.baseline.toFixed(2)}pt differ from Word ` +
          `${testCase.wordLineHeightPt.toFixed(2)}pt/${testCase.wordBaselinePt.toFixed(2)}pt; ` +
          `limit ${VERTICAL_TOLERANCE_PT.toFixed(2)}pt`
      );
    }
  }
} finally {
  (shaper as { dispose?: () => void }).dispose?.();
}

console.log(
  `font metric fidelity OK (${WIDTH_CASES.length} cases, width ±${WIDTH_TOLERANCE_PT.toFixed(2)}pt, ` +
    `vertical ±${VERTICAL_TOLERANCE_PT.toFixed(2)}pt)`
);

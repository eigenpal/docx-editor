// Word font-metric regression gate over privacy-safe synthetic strings.
//
// Expected advances come from Word PDF font subsets (`/Widths`, scaled by the run size).
// The source documents and their text stay outside the repository, and each string here
// was authored for this gate.
//
// The two halves of the vertical check have different provenance, so read them differently:
//
//   - Century Gothic's line box is a WORD reading, and the gate takes it from the shipped
//     `FAMILY_PLANS` rather than restating the numbers. Restating them made the assertion
//     a tautology: the gate fed its own literal into the snapshot and then checked the
//     snapshot returned it, so a wrong `lineMetrics` in `src/index.ts` still passed.
//   - Montserrat's 12.2/9.7 are the FONT's own `hhea` values (ascender 968, descender
//     -213, gap 38 over 1000 upem), which is what the engine falls back to when no
//     override exists. They pin that fallback; they are not an independent Word oracle.

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
import { FAMILY_PLANS, planFaceFile } from '../src/family-plans.ts';

/** The Word families this gate covers that resolve through a PACKAGED plan. */
type PackagedFamily = 'Century Gothic';

interface WidthCase {
  readonly family: PackagedFamily | 'Montserrat' | 'Montserrat Light';
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

/**
 * Substituted families this gate does NOT cover yet, and why. Listed rather than left
 * unsaid: #507 asks for the families that cannot meet the tolerance to be recorded, and a
 * gate with five green cases reads like five is all there is.
 */
const KNOWN_GAPS: readonly { readonly family: string; readonly gap: string }[] = [
  {
    family: 'Garamond',
    gap: 'no packaged or catalogued face is metric-compatible; the resolvers deliberately return nothing, and Word line pitch at 8pt is 1.125em against the engine fallback 1.2727em (issue #563)',
  },
  {
    family: 'Rockwell',
    gap: 'slab serif with no metric-compatible answer; the PANOSE ranking refuses it rather than assigning a sans',
  },
  {
    family: 'Sagona',
    gap: 'commercial face that declares no PANOSE at all, so nothing can be ranked for it',
  },
];

const assetsDir = new URL('../assets/', import.meta.url);

/** The shipped plan for a packaged family; the gate reads it, never restates it. */
function planFor(family: PackagedFamily): NonNullable<ReturnType<typeof FAMILY_PLANS.get>> {
  const plan = FAMILY_PLANS.get(family);
  if (!plan) throw new Error(`${family} has no packaged plan`);
  return plan;
}

const isPackaged = (testCase: WidthCase): testCase is WidthCase & { family: PackagedFamily } =>
  testCase.family === 'Century Gothic';

async function bytesFor(testCase: WidthCase): Promise<Uint8Array> {
  if (isPackaged(testCase)) {
    const suffix =
      testCase.style === 'italic'
        ? testCase.weight === 700
          ? 'BoldItalic'
          : 'Italic'
        : testCase.weight === 700
          ? 'Bold'
          : 'Regular';
    return new Uint8Array(
      readFileSync(new URL(planFaceFile(planFor(testCase.family), suffix), assetsDir))
    );
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
    const plan = isPackaged(testCase) ? planFor(testCase.family) : null;
    const resolvedFamily = plan ? plan.substitute : testCase.family;
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
      // The redirect, and its line box, come from the SHIPPED plan. The expected values
      // below come from Word. Feeding the gate's own literal in here and reading it back
      // out asserted nothing about what the package actually ships.
      ...(plan
        ? {
            substitutions: [
              {
                from: requestedFace,
                to: resolvedRequest,
                ...(plan.lineMetrics ? { lineMetrics: plan.lineMetrics } : {}),
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
for (const { family, gap } of KNOWN_GAPS) console.log(`  known gap: ${family} — ${gap}`);

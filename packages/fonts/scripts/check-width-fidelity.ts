// Word font-metric regression gate over privacy-safe synthetic strings.
//
// PROVENANCE. Every expected number here is a WORD reading, taken from the font subsets
// Word embeds in its own PDF export of two reference documents. Those documents and their
// text stay outside the repository; the strings below were authored for this gate.
//
//   - Widths come from the subset's `/Widths` array, summed and scaled by the run size.
//     A subset's array spans FirstChar..LastChar but carries 0 for every code the source
//     document did not use, so each string here is built only from codes with a nonzero
//     entry — an unused code would read as zero-width and silently under-measure.
//   - Century Gothic's line box comes from its subsets' `hhea` over 2048 upem: regular
//     1989/-451/0, bold 2032/-451/0. The gate takes the value it FEEDS the snapshot from
//     the shipped `FAMILY_PLANS` and compares against those Word numbers. Restating the
//     plan's literal on both sides made the assertion a tautology: a wrong `lineMetrics`
//     still passed.
//   - Montserrat's line box comes from its subsets' `hhea`, 968/-251/0 over 1000 upem.
//     The catalogued face carries the same values, so the engine's own fallback and Word
//     agree here; the case pins that they keep agreeing.
//
// TOLERANCE is relative, with a floor. The engine measures on a 1/20 pt fixed-point grid,
// so a 0.05 pt step is inherent; the floor covers it. The ratio is what the package's
// substitute claims are stated against, so the README's "within 1%" and this gate's bound
// are the same number.

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
import { FAMILY_PLANS, planFaceFile, planLineBox } from '../src/family-plans.ts';

/** The Word families this gate covers that resolve through a PACKAGED plan. */
type PackagedFamily = 'Century Gothic';

interface WidthCase {
  readonly family: PackagedFamily | 'Montserrat' | 'Montserrat Light';
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
  readonly text: string;
  /** Run size; 10 pt unless a case is pinning display-size behaviour. */
  readonly sizePt?: number;
  readonly wordWidthPt: number;
  readonly wordLineHeightPt: number;
  readonly wordBaselinePt: number;
}

/** Fraction of the expected advance a substitute may differ by. */
const WIDTH_TOLERANCE_RATIO = 0.01;
/** Absolute floor, so a short string is not held tighter than the measurement grid. */
const WIDTH_TOLERANCE_FLOOR_PT = 0.1;
const VERTICAL_TOLERANCE_PT = 0.1;

const widthToleranceFor = (expectedPt: number): number =>
  Math.max(WIDTH_TOLERANCE_FLOOR_PT, expectedPt * WIDTH_TOLERANCE_RATIO);
const WIDTH_CASES: readonly WidthCase[] = [
  {
    family: 'Century Gothic',
    weight: 400,
    style: 'normal',
    text: 'Document layout',
    wordWidthPt: 84.89,
    wordLineHeightPt: 11.9140625,
    wordBaselinePt: 9.7119140625,
  },
  {
    family: 'Century Gothic',
    weight: 400,
    style: 'normal',
    text: 'Reliable page breaks',
    wordWidthPt: 103.2,
    wordLineHeightPt: 11.9140625,
    wordBaselinePt: 9.7119140625,
  },
  // Bold carries its own line box: Century Gothic's bold ascent is 2032 against the
  // regular 1989, so one shared value put every bold line 0.84 pt short at 40 pt. Both a
  // text size and a display size, because the width tolerance is relative and a short
  // display string is where an absolute one stopped meaning 1%.
  {
    family: 'Century Gothic',
    weight: 700,
    style: 'normal',
    text: 'Rate of work',
    wordWidthPt: 60,
    wordLineHeightPt: 12.1240234375,
    wordBaselinePt: 9.921875,
  },
  {
    family: 'Century Gothic',
    weight: 700,
    style: 'normal',
    text: 'of work',
    sizePt: 40,
    wordWidthPt: 141.6,
    wordLineHeightPt: 48.49609375,
    wordBaselinePt: 39.6875,
  },
  // Montserrat Regular's subset carries no lowercase, so this case is upper-case only.
  {
    family: 'Montserrat',
    weight: 400,
    style: 'normal',
    text: 'SCALE, RULER',
    wordWidthPt: 72.79,
    wordLineHeightPt: 12.19,
    wordBaselinePt: 9.68,
  },
  {
    family: 'Montserrat Light',
    weight: 400,
    style: 'normal',
    text: 'Design project',
    wordWidthPt: 72.79,
    wordLineHeightPt: 12.19,
    wordBaselinePt: 9.68,
  },
  {
    family: 'Montserrat',
    weight: 700,
    style: 'normal',
    text: 'Contact details',
    wordWidthPt: 79.48,
    wordLineHeightPt: 12.19,
    wordBaselinePt: 9.68,
  },
];

/**
 * Families the package does NOT cover, and why. Listed rather than left unsaid: #507 asks
 * for the families that cannot meet the tolerance to be recorded, and a gate with seven
 * green cases reads like seven is all there is.
 *
 * All three resolve to nothing, which leaves the host's own measurement in place. That is
 * the deliberate answer: no packaged or catalogued face has their advance widths, and a
 * substitute picked on classification alone measured 22-24% wide when it was tried
 * (issue #576).
 */
const KNOWN_GAPS: readonly { readonly family: string; readonly gap: string }[] = [
  {
    family: 'Garamond',
    gap: 'no packaged or catalogued face is metric-compatible; Word line pitch at 8pt is 1.125em against the engine fallback 1.2727em (issue #563)',
  },
  {
    family: 'Rockwell',
    gap: 'slab serif with no metric-compatible answer in the catalog or the bundle',
  },
  {
    family: 'Sagona',
    gap: 'commercial face with no open metric-compatible equivalent; only an app-supplied licensed copy can close it',
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
  return await catalogBytes(face.url, face.byteLength, face.hash, testCase.family);
}

/**
 * The only network this gate touches: three Montserrat faces, a few hundred KB.
 *
 * Retried, because a CDN blip is not a fidelity regression and reporting it as one trains
 * people to re-run a red gate. Only the TRANSPORT is retried — a hash or length mismatch
 * is a real answer and fails on the first attempt, since retrying it would just ask the
 * same tampered or moved asset again.
 */
async function catalogBytes(
  url: string,
  byteLength: number,
  hash: string,
  family: string
): Promise<Uint8Array> {
  const attempts = 3;
  let lastTransportError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== byteLength || sha256FontBytes(bytes) !== hash) {
        throw new CatalogBytesChanged(`Catalog bytes changed for ${family} (${url})`);
      }
      return bytes;
    } catch (error) {
      if (error instanceof CatalogBytesChanged) throw error;
      lastTransportError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(
    `${url}: ${attempts} attempts failed; last error ` +
      `${lastTransportError instanceof Error ? lastTransportError.message : String(lastTransportError)}`
  );
}

/** A content mismatch, which is a result rather than a transport failure. */
class CatalogBytesChanged extends Error {}

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
                ...(planLineBox(plan, testCase.weight)
                  ? { lineMetrics: planLineBox(plan, testCase.weight)! }
                  : {}),
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
      fontSizePt: testCase.sizePt ?? 10,
      bold: testCase.weight === 700,
      italic: testCase.style === 'italic',
    };
    const actual = measurer.measure(testCase.text, runStyle);
    const difference = Math.abs(actual - testCase.wordWidthPt);
    const limit = widthToleranceFor(testCase.wordWidthPt);
    if (difference > limit + Number.EPSILON) {
      throw new Error(
        `${testCase.family} ${testCase.weight}/${testCase.style} ${JSON.stringify(testCase.text)} ` +
          `width ${actual.toFixed(2)}pt differs from Word ${testCase.wordWidthPt.toFixed(2)}pt by ` +
          `${difference.toFixed(2)}pt (${((difference / testCase.wordWidthPt) * 100).toFixed(2)}%); ` +
          `limit ${limit.toFixed(2)}pt`
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
        `${testCase.family} ${testCase.weight}/${testCase.style} @${runStyle.fontSizePt}pt line metrics ` +
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
  `font metric fidelity OK (${WIDTH_CASES.length} cases, width ±${(WIDTH_TOLERANCE_RATIO * 100).toFixed(0)}% ` +
    `(floor ±${WIDTH_TOLERANCE_FLOOR_PT.toFixed(2)}pt), vertical ±${VERTICAL_TOLERANCE_PT.toFixed(2)}pt)`
);
for (const { family, gap } of KNOWN_GAPS) console.log(`  known gap: ${family} — ${gap}`);

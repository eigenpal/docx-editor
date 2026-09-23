import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  harfBuzzFontValidator,
  sha256FontBytes,
} from '../index.ts';
import {
  createShapingEnvironment,
  shapingEnvironmentFingerprint,
  type ShapeInput,
  type ShapedRun,
  type ShapingEnvironmentInput,
  type TextShaper,
} from '../shaped-run.ts';
import { shapeLayoutStyleRun, type LayoutShapingEnvironment } from '../layout-run-shape.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const resolved = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
}).resolve(request);
if (resolved instanceof FontResolutionError) throw resolved;
const font = resolved;

const operation = (): LayoutShapingEnvironment => ({
  script: 'Latn',
  variationAxes: {},
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '16.0.0',
  normalization: 'none',
  language: 'en',
  features: { liga: 1 },
  fixedPointScale: 64,
  roundingMode: 'halfAwayFromZero',
});

/** Records each environment it is asked to shape in, and shapes nothing. */
function recordingShaper(): { shaper: TextShaper; seen: ShapeInput['environment'][] } {
  const seen: ShapeInput['environment'][] = [];
  const empty = {} as ShapedRun;
  return { seen, shaper: { shape: (input) => (seen.push(input.environment), empty) } };
}

const deepFreeze = (environment: LayoutShapingEnvironment): LayoutShapingEnvironment =>
  Object.freeze({
    ...environment,
    variationAxes: Object.freeze({ ...environment.variationAxes }),
    features: Object.freeze({ ...environment.features }),
    shapingLibrary: Object.freeze({ ...environment.shapingLibrary }),
  });

describe('shaping environment reuse', () => {
  test('a created environment passes through validation as itself', () => {
    const environment = createShapingEnvironment({
      ...operation(),
      font,
      direction: 'ltr',
      fallbackOrder: [],
    });
    expect(createShapingEnvironment(environment)).toBe(environment);
    expect(shapingEnvironmentFingerprint(environment)).toBe(
      shapingEnvironmentFingerprint(environment)
    );
  });

  test('a caller-owned input is fingerprinted afresh after it changes', () => {
    const input: { -readonly [K in keyof ShapingEnvironmentInput]: ShapingEnvironmentInput[K] } = {
      ...operation(),
      font,
      direction: 'ltr',
      fallbackOrder: [],
    };
    const before = shapingEnvironmentFingerprint(input);
    input.language = 'de';
    expect(shapingEnvironmentFingerprint(input)).not.toBe(before);
    expect(createShapingEnvironment(input).language).toBe('de');
  });

  test('a frozen operation environment shares one run environment per run style', () => {
    const { shaper, seen } = recordingShaper();
    const environment = deepFreeze(operation());
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    shapeLayoutStyleRun(shaper, environment, font, { ...DEFAULT_RUN_STYLE }, 'b');
    shapeLayoutStyleRun(shaper, environment, font, { ...DEFAULT_RUN_STYLE, smallCaps: true }, 'c');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[2]!.features.smcp).toBe(1);
    expect(seen[0]!.features.smcp).toBeUndefined();
  });

  test('a mutable operation environment is read on every call', () => {
    const { shaper, seen } = recordingShaper();
    const environment = { ...operation() };
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    (environment as { language: string }).language = 'fr';
    shapeLayoutStyleRun(shaper, environment, font, DEFAULT_RUN_STYLE, 'a');
    expect(seen.map((entry) => entry.language)).toEqual(['en', 'fr']);
  });
});

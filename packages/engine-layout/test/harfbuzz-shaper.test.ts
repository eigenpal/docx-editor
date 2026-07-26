import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HarfBuzzShapingError,
  HARFBUZZ_SHAPING_LIBRARY,
  boundedStructuralFontValidator,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  roundFontUnitToFixedPoint,
  sha256FontBytes,
  shapedRunComparatorInputs,
  type FixedPointRoundingMode,
  type FontRequest,
  type HarfBuzzFaceCacheEvent,
  type HarfBuzzOutlineCacheEvent,
  type HarfBuzzShapeCacheEvent,
  type ResolvedFont,
  type ShapeInput,
} from '../src/index.ts';

await initializeHarfBuzz();

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url)));

const REGULAR_REQUEST: FontRequest = {
  family: 'DejaVu Sans',
  weight: 400,
  style: 'normal',
};
const BOLD_REQUEST: FontRequest = {
  family: 'DejaVu Sans',
  weight: 700,
  style: 'normal',
};

const resolvedFixture = (
  request: FontRequest,
  bytes: Uint8Array,
  maxFontBytes = 2_000_000
): ResolvedFont => {
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes,
    resources: [
      {
        request,
        id: `${request.family}-${request.weight}`,
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(request);
  if (result instanceof FontResolutionError) throw result;
  return result;
};

const regularBytes = fixture('DejaVuSans.ttf');
const boldBytes = fixture('DejaVuSans-Bold.ttf');
const regular = resolvedFixture(REGULAR_REQUEST, regularBytes);
const bold = resolvedFixture(BOLD_REQUEST, boldBytes);

const input = (
  text: string,
  font: ResolvedFont = regular,
  overrides: Partial<ShapeInput['environment']> = {}
): ShapeInput => ({
  text,
  fontSizeHalfPoints: 24,
  bidiLevel: overrides.direction === 'rtl' ? 1 : 0,
  environment: createShapingEnvironment({
    font,
    variationAxes: {},
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '16.0.0',
    normalization: 'none',
    script: 'Latn',
    language: 'en',
    direction: 'ltr',
    features: { kern: 1, liga: 1 },
    fallbackOrder: [],
    fixedPointScale: 64,
    roundingMode: 'halfAwayFromZero',
    ...overrides,
  }),
});

describe('HarfBuzz production shaper', () => {
  const shaper = createHarfBuzzTextShaper();

  test('uses the true regular and bold faces without scalar synthesis', () => {
    const regularRun = shaper.shape(input('office', regular));
    const boldRun = shaper.shape(input('office', bold));

    expect(regularRun.glyphs.map(({ id, advanceX }) => [id, advanceX])).toEqual([
      [82, 470],
      [5044, 743],
      [70, 422],
      [72, 473],
    ]);
    expect(boldRun.glyphs.map(({ id, advanceX }) => [id, advanceX])).toEqual([
      [82, 528],
      [5040, 857],
      [70, 455],
      [72, 521],
    ]);
    expect(regularRun.fontSpans[0]?.font.identity).toBe(regular.identity);
    expect(boldRun.fontSpans[0]?.font.identity).toBe(bold.identity);
  });

  test('applies kerning to the complete span', () => {
    const kerned = shaper.shape(input('AV', regular, { features: { kern: 1, liga: 1 } }));
    const unkerned = shaper.shape(input('AV', regular, { features: { kern: 0, liga: 1 } }));

    expect(kerned.glyphs.map((glyph) => glyph.advanceX)).toEqual([476, 525]);
    expect(unkerned.glyphs.map((glyph) => glyph.advanceX)).toEqual([525, 525]);
  });

  test('honors liga on and off with exact cluster ranges', () => {
    const enabled = shaper.shape(input('office'));
    const disabled = shaper.shape(input('office', regular, { features: { kern: 1, liga: 0 } }));

    expect(enabled.glyphs.map((glyph) => [glyph.id, glyph.cluster])).toEqual([
      [82, 0],
      [5044, 1],
      [70, 4],
      [72, 5],
    ]);
    expect(
      enabled.clusters.map(({ textStart, textEnd, glyphStart, glyphEnd }) => [
        textStart,
        textEnd,
        glyphStart,
        glyphEnd,
      ])
    ).toEqual([
      [0, 1, 0, 1],
      [1, 4, 1, 2],
      [4, 5, 2, 3],
      [5, 6, 3, 4],
    ]);
    expect(disabled.glyphs.map((glyph) => glyph.id)).toEqual([82, 73, 73, 76, 70, 72]);
  });

  test('publishes the exact HarfBuzz outline and fixed-point origin for a ligature glyph', () => {
    const run = shaper.shape(input('office'));
    const ligature = run.glyphs[1]!;
    expect(ligature.id).toBe(5044);
    expect(ligature.originX).toBe(470);
    expect(ligature.originY).toBe(0);
    expect(ligature.outline.unitsPerEm).toBe(2048);
    expect(ligature.outline.path).toBe(
      'M760,1556L760,1403L584,1403Q485,1403 446,1363Q408,1323 408,1219L408,1120L913,1120L913,1198Q913,1385 1000,1470Q1028,1498 1067,1517Q1145,1556 1276,1556L1450,1556L1450,1403L1274,1403Q1175,1403 1136.5,1363Q1098,1323 1098,1219L1098,1120L1788,1120L1788,0L1603,0L1603,977L1098,977L1098,0L913,0L913,977L408,977L408,0L223,0L223,977L47,977L47,1120L223,1120L223,1198Q223,1385 310,1470.5Q397,1556 586,1556L760,1556ZM1603,1554L1788,1554L1788,1321L1603,1321L1603,1554Z'
    );
    expect(Object.isFrozen(ligature.outline)).toBe(true);
  });

  test('computes one immutable outline per face and glyph id across distinct shaped runs', () => {
    let pathCalls = 0;
    const outlined = createHarfBuzzTextShaper({
      instrumentation: { onOutlinePathCall: () => (pathCalls += 1) },
    });
    const repeated = outlined.shape(input('AAAA'));
    const separate = outlined.shape(input('A'));

    expect(new Set(repeated.glyphs.map((glyph) => glyph.outline)).size).toBe(1);
    expect(separate.glyphs[0]!.outline).toBe(repeated.glyphs[0]!.outline);
    expect(pathCalls).toBe(1);
    outlined.dispose();
  });

  test('typed-rejects an outline beyond the hard per-outline admission budget', () => {
    const outlined = createHarfBuzzTextShaper({ maxOutlineBytes: 32 });
    expect(() => outlined.shape(input('A'))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({ code: 'outlineOverLimit' })
    );
    outlined.dispose();
  });

  test('bounds aggregate outline memory and releases accounting on LRU eviction', () => {
    const retained: number[] = [];
    const events: HarfBuzzOutlineCacheEvent[] = [];
    const outlined = createHarfBuzzTextShaper({
      maxCachedOutlineBytes: 4096,
      instrumentation: {
        onOutlineCacheEvent: (event) => {
          events.push(event);
          retained.push(event.retainedBytes);
        },
      },
    });
    outlined.shape(input('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));

    expect(events.some(({ kind }) => kind === 'evicted')).toBe(true);
    expect(
      events.some(
        (event, index) =>
          event.kind === 'evicted' &&
          index > 0 &&
          event.retainedBytes < events[index - 1]!.retainedBytes
      )
    ).toBe(true);
    expect(Math.max(...retained)).toBeLessThanOrEqual(4096);
    outlined.dispose();
    expect(retained.at(-1)).toBe(0);
  });

  test('preserves UTF-16 combining-mark cluster provenance', () => {
    const positionedMark = shaper.shape(input('x\u0301'));
    expect(positionedMark.text).toBe('x\u0301');
    expect(
      positionedMark.glyphs.map(({ id, cluster, advanceX, advanceY, offsetX, offsetY }) => [
        id,
        cluster,
        advanceX,
        advanceY,
        offsetX,
        offsetY,
      ])
    ).toEqual([
      [91, 0, 455, 0, 0, 0],
      [690, 1, 0, 0, -34, 0],
    ]);
    expect(positionedMark.clusters).toMatchObject([
      { textStart: 0, textEnd: 1, glyphStart: 0, glyphEnd: 1, caretEdges: [0, 455] },
      { textStart: 1, textEnd: 2, glyphStart: 1, glyphEnd: 2, caretEdges: [0, 0] },
    ]);
    expect(positionedMark.glyphs[1]).toMatchObject({
      id: 690,
      originX: 455,
      originY: 0,
      offsetX: -34,
      offsetY: 0,
      outline: {
        unitsPerEm: 2048,
        path: 'M-375,1638L-176,1638L-502,1262L-655,1262L-375,1638ZM-512,1147L-512,1147Z',
      },
    });
  });

  test('passes explicit RTL direction, Arabic script, and language', () => {
    const run = shaper.shape(
      input('سلام', regular, {
        direction: 'rtl',
        script: 'Arab',
        language: 'ar',
      })
    );

    expect(run.direction).toBe('rtl');
    expect(run.bidiLevel).toBe(1);
    expect(run.glyphs.map((glyph) => [glyph.id, glyph.cluster, glyph.advanceX])).toEqual([
      [1390, 3, 476],
      [5366, 1, 458],
      [5293, 0, 644],
    ]);
    expect(
      run.clusters.map(({ textStart, textEnd, glyphStart }) => [textStart, textEnd, glyphStart])
    ).toEqual([
      [3, 4, 0],
      [1, 3, 1],
      [0, 1, 2],
    ]);
  });

  test('returns exact font vertical metrics at the requested size', () => {
    expect(shaper.shape(input('A')).metrics).toEqual({
      ascent: 713,
      descent: 181,
      lineGap: 0,
    });
  });

  test('rejects variable-axis requests with a typed capability error', () => {
    expect(() => shaper.shape(input('A', regular, { variationAxes: { wght: 550 } }))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({
        name: 'HarfBuzzShapingError',
        code: 'unsupportedVariationAxes',
      })
    );
  });

  test('rejects unevidenced fallback shaping instead of silently dropping fallback order', () => {
    expect(() => shaper.shape(input('A', regular, { fallbackOrder: [bold] }))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({
        name: 'HarfBuzzShapingError',
        code: 'unsupportedFallback',
      })
    );
  });

  test('rejects color-font tables with a typed capability error', () => {
    const colorBytes = regularBytes.slice();
    colorBytes.set([0x43, 0x4f, 0x4c, 0x52], 12);
    const colorFont = resolvedFixture(
      { family: 'Color Fixture', weight: 400, style: 'normal' },
      colorBytes
    );

    expect(() => shaper.shape(input('A', colorFont))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({
        name: 'HarfBuzzShapingError',
        code: 'unsupportedColorFont',
      })
    );
  });

  test('rejects malformed and over-ceiling font bytes before shaping', () => {
    const malformed = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(harfBuzzFontValidator(malformed, 0)).toMatchObject({ valid: false });
    const malformedSnapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 64,
      resources: [
        {
          request: REGULAR_REQUEST,
          id: 'malformed',
          bytes: malformed,
          hash: sha256FontBytes(malformed),
          faceIndex: 0,
        },
      ],
      validateFont: boundedStructuralFontValidator,
    });
    const malformedFont = malformedSnapshot.resolve(REGULAR_REQUEST);
    if (malformedFont instanceof FontResolutionError) throw malformedFont;
    expect(() => shaper.shape(input('A', malformedFont))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({
        name: 'HarfBuzzShapingError',
        code: 'malformedFont',
      })
    );

    const limited = createHarfBuzzTextShaper({ maxFontBytes: regularBytes.byteLength - 1 });
    expect(() => limited.shape(input('A'))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({
        name: 'HarfBuzzShapingError',
        code: 'fontOverLimit',
      })
    );
  });

  test('uses the declared exact fixed-point rounding mode', () => {
    const cases: readonly [FixedPointRoundingMode, number, number][] = [
      ['halfAwayFromZero', 3, -3],
      ['halfToEven', 2, -2],
      ['towardZero', 2, -2],
    ];
    for (const [mode, positive, negative] of cases) {
      expect(roundFontUnitToFixedPoint(5, 2, 1, mode)).toBe(positive);
      expect(roundFontUnitToFixedPoint(-5, 2, 1, mode)).toBe(negative);
    }
  });

  test('repeated shaping and comparator output are byte-for-byte deterministic', () => {
    const shapeInput = input('office AV x\u0301');
    const firstRun = shaper.shape(shapeInput);
    const exactShape = JSON.stringify({
      glyphs: firstRun.glyphs,
      clusters: firstRun.clusters,
      metrics: firstRun.metrics,
    });

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const repeated = shaper.shape(shapeInput);
      expect(
        JSON.stringify({
          glyphs: repeated.glyphs,
          clusters: repeated.clusters,
          metrics: repeated.metrics,
        })
      ).toBe(exactShape);
    }

    const firstComparator = shapedRunComparatorInputs(firstRun, shapeInput.environment);
    const repeatedComparator = shapedRunComparatorInputs(
      shaper.shape(shapeInput),
      shapeInput.environment
    );
    expect(repeatedComparator).toEqual(firstComparator);
    expect(firstComparator).toMatchObject({
      text: 'office AV x\u0301',
      direction: 'ltr',
      script: 'Latn',
      language: 'en',
      bidiLevel: 0,
      fontSpans: [
        {
          glyphStart: 0,
          glyphEnd: firstRun.glyphs.length,
          fallbackIndex: null,
          font: {
            identity: regular.identity,
            id: 'DejaVu Sans-400',
            family: 'DejaVu Sans',
            request: REGULAR_REQUEST,
            hash: regular.hash,
            faceIndex: 0,
            byteLength: regular.byteLength,
            substitution: null,
          },
        },
      ],
      metrics: { ascent: 713, descent: 181, lineGap: 0 },
    });
    expect(firstComparator.glyphs.find((glyph) => glyph.id === 690)).toMatchObject({
      id: 690,
      cluster: 11,
      originX: 4052,
      originY: 0,
      advanceX: 0,
      advanceY: 0,
      offsetX: -34,
      offsetY: 0,
    });
  });

  test('bounds complete-span input and shaped output work', () => {
    expect(() => createHarfBuzzTextShaper({ maxInputUtf16: 4 }).shape(input('office'))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({ code: 'textOverLimit' })
    );
    expect(() =>
      createHarfBuzzTextShaper({ maxInputUtf16: 4 }).shape(
        input('\ufdfa', regular, { normalization: 'NFKD' })
      )
    ).toThrow(expect.objectContaining<HarfBuzzShapingError>({ code: 'unsupportedNormalization' }));
    expect(() =>
      createHarfBuzzTextShaper({ maxInputUtf16: 3, maxCodepoints: 1 }).shape(input('A😀'))
    ).toThrow(expect.objectContaining<HarfBuzzShapingError>({ code: 'codepointsOverLimit' }));
    expect(() =>
      createHarfBuzzTextShaper({ maxInputUtf16: 2, maxCodepoints: 2, maxGlyphs: 1 }).shape(
        input('AV')
      )
    ).toThrow(expect.objectContaining<HarfBuzzShapingError>({ code: 'glyphOverLimit' }));
  });

  test('rejects a million-glyph candidate from conservative run bytes before HarfBuzz allocates', () => {
    let shapeCalls = 0;
    const bounded = createHarfBuzzTextShaper({
      maxShapedRunBytes: 1024,
      instrumentation: { onShapeCall: () => (shapeCalls += 1) },
    });

    expect(() => bounded.shape(input('A'.repeat(1_000_000)))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({ code: 'shapedRunOverLimit' })
    );
    expect(shapeCalls).toBe(0);
    bounded.dispose();
  });

  test('typed-rejects a shaped run whose retained outlines exceed its byte budget', () => {
    const bounded = createHarfBuzzTextShaper({ maxShapedRunBytes: 1024 });
    expect(() => bounded.shape(input('office x\u0301'))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({ code: 'shapedRunOverLimit' })
    );
    bounded.dispose();
  });

  test('bounds total shape-cache bytes and releases accounting on LRU eviction', () => {
    let shapeCalls = 0;
    const retained: number[] = [];
    const events: HarfBuzzShapeCacheEvent[] = [];
    const bounded = createHarfBuzzTextShaper({
      maxCachedShapeBytes: 4096,
      instrumentation: {
        onShapeCall: () => (shapeCalls += 1),
        onShapeCacheEvent: (event) => {
          events.push(event);
          retained.push(event.retainedBytes);
        },
      },
    });
    for (const text of ['A', 'B', 'C', 'D', 'A']) bounded.shape(input(text));

    expect(events.some(({ kind }) => kind === 'evicted')).toBe(true);
    expect(
      events.some(
        (event, index) =>
          event.kind === 'evicted' &&
          index > 0 &&
          event.retainedBytes < events[index - 1]!.retainedBytes
      )
    ).toBe(true);
    expect(retained.some((bytes) => bytes > 0)).toBe(true);
    expect(Math.max(...retained)).toBeLessThanOrEqual(4096);
    expect(shapeCalls).toBe(5);
    bounded.dispose();
    expect(retained.at(-1)).toBe(0);
  });

  test('many tiny shape entries include key and map overhead before cache admission', () => {
    const events: HarfBuzzShapeCacheEvent[] = [];
    let shapeCalls = 0;
    const bounded = createHarfBuzzTextShaper({
      maxCachedShapeBytes: 3500,
      instrumentation: {
        onShapeCall: () => (shapeCalls += 1),
        onShapeCacheEvent: (event) => events.push(event),
      },
    });
    for (let index = 0; index < 32; index += 1) {
      bounded.shape(input('', regular, { language: `en-x${index}` }));
    }

    expect(events.filter(({ kind }) => kind === 'stored')).toHaveLength(32);
    expect(events.some(({ kind }) => kind === 'evicted')).toBe(true);
    expect(Math.max(...events.map(({ retainedBytes }) => retainedBytes))).toBeLessThanOrEqual(3500);
    const callsBeforeSecondLast = shapeCalls;
    bounded.shape(input('', regular, { language: 'en-x30' }));
    expect(shapeCalls).toBe(callsBeforeSecondLast + 1);
    bounded.dispose();
    expect(events.at(-1)).toMatchObject({ kind: 'cleared', retainedBytes: 0 });
  });

  test('rejects normalization before shaping can change authored UTF-16 offsets', () => {
    for (const normalization of ['NFC', 'NFD', 'NFKC', 'NFKD'] as const) {
      expect(() => shaper.shape(input('e\u0301', regular, { normalization }))).toThrow(
        expect.objectContaining<HarfBuzzShapingError>({
          code: 'unsupportedNormalization',
        })
      );
    }
  });

  test('rejects non-finite and non-integer shaping limits', () => {
    for (const options of [
      { maxFontBytes: Number.NaN },
      { maxInputUtf16: Number.POSITIVE_INFINITY },
      { maxCodepoints: Number.NaN },
      { maxGlyphs: Number.NEGATIVE_INFINITY },
      { maxCachedFaces: 1.5 },
      { maxCachedShapes: Number.MAX_SAFE_INTEGER },
      { maxGlyphs: Number.MAX_SAFE_INTEGER },
      { maxOutlineBytes: Number.MAX_SAFE_INTEGER },
      { maxCachedOutlineBytes: Number.MAX_SAFE_INTEGER },
      { maxShapedRunBytes: Number.MAX_SAFE_INTEGER },
      { maxCachedShapeBytes: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(() => createHarfBuzzTextShaper(options)).toThrow(RangeError);
    }
  });

  test('reuses bounded shape results without copying bytes, rescanning tables, or reshaping', () => {
    const faceEvents: HarfBuzzFaceCacheEvent[] = [];
    const shapeEvents: HarfBuzzShapeCacheEvent[] = [];
    const counters = { byteCopies: 0, tableScans: 0, shapeCalls: 0 };
    const cached = createHarfBuzzTextShaper({
      maxCachedShapes: 2,
      instrumentation: {
        onFaceCacheEvent: (event) => faceEvents.push(event),
        onShapeCacheEvent: (event) => shapeEvents.push(event),
        onByteCopy: () => (counters.byteCopies += 1),
        onTableScan: () => (counters.tableScans += 1),
        onShapeCall: () => (counters.shapeCalls += 1),
      },
    });

    const first = cached.shape(input('office'));
    const repeated = cached.shape(input('office'));
    cached.shape(input('AV'));
    cached.shape(input('x\u0301'));
    cached.shape(input('office'));

    expect(repeated).toBe(first);
    expect(counters).toEqual({ byteCopies: 1, tableScans: 0, shapeCalls: 4 });
    expect(faceEvents.filter((event) => event.kind === 'created')).toHaveLength(1);
    expect(
      shapeEvents.filter(({ kind }) => kind !== 'stored').map(({ kind }) => ({ kind }))
    ).toEqual([
      { kind: 'miss' },
      { kind: 'hit' },
      { kind: 'miss' },
      { kind: 'miss' },
      { kind: 'evicted' },
      { kind: 'miss' },
      { kind: 'evicted' },
    ]);
    cached.dispose();
  });

  test('observably evicts the least-recent face and recreates only evicted faces', () => {
    const alternateBytes = new Uint8Array(regularBytes.byteLength + 1);
    alternateBytes.set(regularBytes);
    const alternate = resolvedFixture(REGULAR_REQUEST, alternateBytes);
    const events: HarfBuzzFaceCacheEvent[] = [];
    const bounded = createHarfBuzzTextShaper({
      maxCachedFaces: 2,
      instrumentation: {
        onFaceCacheEvent: (event) => events.push(event),
      },
    });

    bounded.shape(input('A', regular));
    bounded.shape(input('A', bold));
    bounded.shape(input('B', regular));
    bounded.shape(input('A', alternate));
    bounded.shape(input('C', regular));
    bounded.shape(input('B', bold));

    expect(events).toEqual([
      { kind: 'created', identity: regular.identity },
      { kind: 'created', identity: bold.identity },
      { kind: 'hit', identity: regular.identity },
      { kind: 'evicted', identity: bold.identity },
      { kind: 'created', identity: alternate.identity },
      { kind: 'hit', identity: regular.identity },
      { kind: 'evicted', identity: alternate.identity },
      { kind: 'created', identity: bold.identity },
    ]);
    bounded.dispose();
  });

  test('releases owned HarfBuzz references and rejects use after disposal', () => {
    const disposable = createHarfBuzzTextShaper();
    expect(disposable.shape(input('A')).glyphs).toHaveLength(1);
    disposable.dispose();
    expect(() => disposable.shape(input('A'))).toThrow(
      expect.objectContaining<HarfBuzzShapingError>({ code: 'disposed' })
    );
  });
});

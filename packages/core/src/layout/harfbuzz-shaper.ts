import {
  assertValidatedResolvedFont,
  boundedStructuralFontValidator,
  trustedFontBytes,
  trustedFontTableTags,
  type FontByteValidator,
  type ResolvedFont,
} from './font-resource.ts';
import {
  createShapedRun,
  createShapingEnvironment,
  fixedPoint,
  shapingEnvironmentFingerprint,
  type FixedPoint,
  type FixedPointRoundingMode,
  type GlyphOutline,
  type ShapeInput,
  type ShapedCluster,
  type ShapedGlyph,
  type ShapedRun,
  type TextShaper,
  type VersionedShapingLibrary,
} from './shaped-run.ts';

type HarfBuzzModule = typeof import('harfbuzzjs');
type HarfBuzzBlob = InstanceType<HarfBuzzModule['Blob']>;
type HarfBuzzBuffer = InstanceType<HarfBuzzModule['Buffer']>;
type HarfBuzzFace = InstanceType<HarfBuzzModule['Face']>;
type HarfBuzzFont = InstanceType<HarfBuzzModule['Font']>;

/**
 * The exact HarfBuzz build this engine shapes against.
 *
 * Pinned and verified at load: a runtime reporting a different version is REFUSED rather than
 * used, because glyph positioning can change between releases and a cached measurement taken
 * under one build must not be trusted under another.
 */
export const HARFBUZZ_SHAPING_LIBRARY: VersionedShapingLibrary = Object.freeze({
  name: 'HarfBuzz',
  version: '14.2.1',
});

let harfBuzzModule: HarfBuzzModule | null = null;
let harfBuzzInitialization: Promise<void> | null = null;

/** Load and verify the HarfBuzz WASM runtime without adding top-level await to import graphs. */
export function initializeHarfBuzz(): Promise<void> {
  if (harfBuzzModule) return Promise.resolve();
  if (harfBuzzInitialization) return harfBuzzInitialization;
  harfBuzzInitialization = import('harfbuzzjs')
    .then((module) => {
      const version = module.versionString();
      if (version !== HARFBUZZ_SHAPING_LIBRARY.version) {
        throw new HarfBuzzShapingError('shapingLibraryMismatch', {
          diagnostic: `expected ${HARFBUZZ_SHAPING_LIBRARY.version}, loaded ${version}`,
        });
      }
      harfBuzzModule = module;
    })
    .catch((error) => {
      harfBuzzInitialization = null;
      throw error;
    });
  return harfBuzzInitialization;
}

/** Whether the WASM runtime is loaded and shaping can proceed synchronously. */
export function isHarfBuzzInitialized(): boolean {
  return harfBuzzModule !== null;
}

function requireHarfBuzz(): HarfBuzzModule {
  if (!harfBuzzModule) {
    throw new HarfBuzzShapingError('notInitialized', {
      diagnostic: 'Call initializeHarfBuzz() before creating a text shaper',
    });
  }
  return harfBuzzModule;
}

/**
 * Why shaping refused.
 *
 * Mostly RESOURCE limits, because every input here derives from a file: text length, codepoint
 * count, glyph count and outline size are all attacker-influenced, and an unbounded shape call is
 * a denial-of-service vector rather than a rendering bug.
 */
export type HarfBuzzShapingErrorCode =
  | 'notInitialized'
  | 'fontOverLimit'
  | 'malformedFont'
  | 'textOverLimit'
  | 'codepointsOverLimit'
  | 'glyphOverLimit'
  | 'outlineOverLimit'
  | 'shapedRunOverLimit'
  | 'unsupportedVariationAxes'
  | 'unsupportedFallback'
  | 'unsupportedColorFont'
  | 'unsupportedNormalization'
  | 'invalidBidiLevel'
  | 'shapingLibraryMismatch'
  | 'disposed';

/**
 * A shaping call that was refused, carrying the limit it exceeded where there was one.
 *
 * Thrown rather than returned: unlike a missing font, a run that cannot be shaped has no sensible
 * fallback measurement, and continuing would lay text out at made-up widths.
 */
export class HarfBuzzShapingError extends Error {
  readonly name = 'HarfBuzzShapingError';
  readonly code: HarfBuzzShapingErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly diagnostic?: string;

  constructor(
    code: HarfBuzzShapingErrorCode,
    details: {
      readonly limit?: number;
      readonly actual?: number;
      readonly diagnostic?: string;
    } = {}
  ) {
    super(`HarfBuzz shaping failed (${code})`);
    this.code = code;
    this.limit = details.limit;
    this.actual = details.actual;
    this.diagnostic = details.diagnostic;
  }
}

/**
 * Resource budgets and cache sizes for one shaper. Every field optional.
 *
 * The caches exist because shaping is the expensive step: a face is opened once and reused, and
 * identical runs return their previous result. The caps exist because file-derived input decides
 * how much work is asked for.
 */
export interface HarfBuzzTextShaperOptions {
  readonly maxFontBytes?: number;
  readonly maxInputUtf16?: number;
  readonly maxCodepoints?: number;
  readonly maxGlyphs?: number;
  readonly maxCachedFaces?: number;
  readonly maxCachedShapes?: number;
  readonly maxOutlineBytes?: number;
  readonly maxCachedOutlineBytes?: number;
  readonly maxShapedRunBytes?: number;
  readonly maxCachedShapeBytes?: number;
  readonly instrumentation?: HarfBuzzTextShaperInstrumentation;
}

/** One face-cache transition, for instrumentation. */
export interface HarfBuzzFaceCacheEvent {
  readonly kind: 'created' | 'hit' | 'evicted';
  readonly identity: string;
}

/**
 * Optional counters for the work a shaper is expected to do rarely.
 *
 * Exists so tests can assert the ABSENCE of work — re-opening a face or re-copying its bytes per
 * shape call would not change any output, only make typing slow, which no rendering assertion
 * would catch.
 */
export interface HarfBuzzTextShaperInstrumentation {
  readonly onFaceCacheEvent?: (event: HarfBuzzFaceCacheEvent) => void;
  readonly onShapeCacheEvent?: (event: HarfBuzzShapeCacheEvent) => void;
  readonly onByteCopy?: () => void;
  readonly onTableScan?: () => void;
  readonly onShapeCall?: () => void;
  readonly onOutlinePathCall?: () => void;
  readonly onOutlineCacheEvent?: (event: HarfBuzzOutlineCacheEvent) => void;
}

/** One shape-cache transition, for instrumentation. */
export interface HarfBuzzShapeCacheEvent {
  readonly kind: 'hit' | 'miss' | 'stored' | 'evicted' | 'skipped' | 'cleared';
  readonly retainedBytes: number;
}

/** One outline-cache transition, for instrumentation. */
export interface HarfBuzzOutlineCacheEvent {
  readonly kind: 'created' | 'hit' | 'evicted' | 'skipped' | 'cleared';
  readonly retainedBytes: number;
}

/**
 * A {@link TextShaper} backed by HarfBuzz, holding WASM resources.
 *
 * {@link HarfBuzzTextShaper.dispose} is not optional housekeeping: the cached faces are WASM
 * allocations that garbage collection cannot reclaim, so a shaper outliving its editor leaks
 * until the page goes away.
 */
export interface HarfBuzzTextShaper extends TextShaper {
  dispose(): void;
}

const DEFAULT_MAX_FONT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_INPUT_UTF16 = 1_000_000;
const DEFAULT_MAX_CODEPOINTS = 1_000_000;
const DEFAULT_MAX_GLYPHS = 1_000_000;
const DEFAULT_MAX_CACHED_FACES = 4;
const DEFAULT_MAX_CACHED_SHAPES = 512;
const DEFAULT_MAX_OUTLINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_CACHED_OUTLINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_SHAPED_RUN_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CACHED_SHAPE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_FONT_BYTES = 64 * 1024 * 1024;
const HARD_MAX_INPUT_UTF16 = 1_000_000;
const HARD_MAX_CODEPOINTS = 1_000_000;
const HARD_MAX_GLYPHS = 1_000_000;
const HARD_MAX_CACHED_FACES = 64;
const HARD_MAX_CACHED_SHAPES = 4096;
const HARD_MAX_OUTLINE_BYTES = 4 * 1024 * 1024;
const HARD_MAX_CACHED_OUTLINE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_SHAPED_RUN_BYTES = 64 * 1024 * 1024;
const HARD_MAX_CACHED_SHAPE_BYTES = 256 * 1024 * 1024;
const COLOR_TABLES = new Set(['COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG ']);
const REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp'] as const;

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

const sfntOffset = (bytes: Uint8Array, faceIndex: number): number => {
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  return signature === 'ttcf' ? readUint32(bytes, 12 + faceIndex * 4) : 0;
};

const tableTags = (bytes: Uint8Array, faceIndex: number): ReadonlySet<string> => {
  const base = sfntOffset(bytes, faceIndex);
  const count = readUint16(bytes, base + 4);
  const tags = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const record = base + 12 + index * 16;
    tags.add(
      String.fromCharCode(
        bytes[record]!,
        bytes[record + 1]!,
        bytes[record + 2]!,
        bytes[record + 3]!
      )
    );
  }
  return tags;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const validateRequiredTables: FontByteValidator = (bytes, faceIndex) => {
  const structural = boundedStructuralFontValidator(bytes, faceIndex);
  if (!structural.valid) return structural;
  const tags = tableTags(bytes, faceIndex);
  for (const required of REQUIRED_TABLES) {
    if (!tags.has(required)) {
      return { valid: false, diagnostic: `missing required ${required} table` };
    }
  }
  return { valid: true };
};

/** Structural sfnt validation that does not construct native HarfBuzz objects. */
export const harfBuzzFontValidator: FontByteValidator = validateRequiredTables;

const assertPositiveLimit = (value: number, name: string, hardMaximum: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardMaximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${hardMaximum}`);
  }
  return value;
};

const roundRational = (
  numerator: bigint,
  denominator: bigint,
  mode: FixedPointRoundingMode
): number => {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (mode !== 'towardZero') {
    const doubled = remainder * 2n;
    if (
      doubled > denominator ||
      (doubled === denominator &&
        (mode === 'halfAwayFromZero' || (mode === 'halfToEven' && quotient % 2n !== 0n)))
    ) {
      quotient += 1n;
    }
  }
  const signed = negative ? -quotient : quotient;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Shaped fixed-point value exceeds the safe integer range');
  }
  return result;
};

/** Convert signed font units by an exact rational multiplier using the declared tie rule. */
export const roundFontUnitToFixedPoint = (
  fontUnits: number,
  denominator: number,
  numerator: number,
  mode: FixedPointRoundingMode
): FixedPoint => {
  if (!Number.isSafeInteger(fontUnits)) throw new RangeError('font units must be a safe integer');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('fixed-point denominator must be a positive safe integer');
  }
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError('fixed-point numerator must be a non-negative safe integer');
  }
  return fixedPoint(
    roundRational(BigInt(fontUnits) * BigInt(numerator), BigInt(denominator), mode)
  );
};

const fontUnitsConverter = (
  unitsPerEm: number,
  fontSizeHalfPoints: number,
  fixedPointScale: number,
  mode: FixedPointRoundingMode
): ((value: number) => FixedPoint) => {
  if (!Number.isSafeInteger(fontSizeHalfPoints) || fontSizeHalfPoints <= 0) {
    throw new RangeError('font size must be a positive integer number of half points');
  }
  if (fontSizeHalfPoints > Math.floor(Number.MAX_SAFE_INTEGER / fixedPointScale)) {
    throw new RangeError('font size and fixed-point scale product exceeds the safe integer range');
  }
  const numerator = fontSizeHalfPoints * fixedPointScale;
  const denominator = unitsPerEm * 2;
  return (value) => roundFontUnitToFixedPoint(value, denominator, numerator, mode);
};

const clustersFromGlyphs = (
  text: string,
  glyphs: readonly ShapedGlyph[]
): readonly ShapedCluster[] => {
  if (glyphs.length === 0) return [];
  const logicalStarts = [...new Set(glyphs.map((glyph) => glyph.cluster))].sort(
    (left, right) => left - right
  );
  const logicalEnd = new Map<number, number>();
  for (let index = 0; index < logicalStarts.length; index += 1) {
    logicalEnd.set(logicalStarts[index]!, logicalStarts[index + 1] ?? text.length);
  }

  const clusters: ShapedCluster[] = [];
  let glyphStart = 0;
  while (glyphStart < glyphs.length) {
    const textStart = glyphs[glyphStart]!.cluster;
    let glyphEnd = glyphStart + 1;
    while (glyphEnd < glyphs.length && glyphs[glyphEnd]!.cluster === textStart) glyphEnd += 1;
    const advance = glyphs
      .slice(glyphStart, glyphEnd)
      .reduce((sum, glyph) => sum + glyph.advanceX, 0);
    const safeAdvance = fixedPoint(advance);
    clusters.push({
      textStart,
      textEnd: logicalEnd.get(textStart)!,
      glyphStart,
      glyphEnd,
      advance: safeAdvance,
      caretEdges: Object.freeze([fixedPoint(0), safeAdvance]),
      fontSpan: 0,
    });
    glyphStart = glyphEnd;
  }
  return clusters;
};

interface ActiveHarfBuzzFont {
  readonly identity: string;
  readonly blob: HarfBuzzBlob;
  readonly face: HarfBuzzFace;
  readonly font: HarfBuzzFont;
  readonly unitsPerEm: number;
}

const OBJECT_OVERHEAD_BYTES = 64;
const REFERENCE_BYTES = 8;
const NUMBER_STORAGE_BYTES = 8;
const ARRAY_OVERHEAD_BYTES = 32;
const MAP_ENTRY_OVERHEAD_BYTES = OBJECT_OVERHEAD_BYTES + 2 * REFERENCE_BYTES;
const CACHED_OUTLINE_WRAPPER_BYTES = OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + NUMBER_STORAGE_BYTES;
const CACHED_SHAPE_WRAPPER_BYTES = OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + NUMBER_STORAGE_BYTES;
const OUTLINE_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + REFERENCE_BYTES + NUMBER_STORAGE_BYTES;
const SHAPED_RUN_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 8 * REFERENCE_BYTES;
const GLYPH_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 8 * NUMBER_STORAGE_BYTES + REFERENCE_BYTES;
const CLUSTER_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 6 * NUMBER_STORAGE_BYTES + REFERENCE_BYTES;
const FONT_SPAN_OBJECT_BYTES =
  OBJECT_OVERHEAD_BYTES + 3 * NUMBER_STORAGE_BYTES + 2 * REFERENCE_BYTES;
const METRICS_OBJECT_BYTES = OBJECT_OVERHEAD_BYTES + 3 * NUMBER_STORAGE_BYTES;

const stringStorageBytes = (value: string): number =>
  OBJECT_OVERHEAD_BYTES + value.length * Uint16Array.BYTES_PER_ELEMENT;

const outlineStorageBytes = (path: string): number =>
  OUTLINE_OBJECT_BYTES + stringStorageBytes(path);

const arrayStorageBytes = (length: number): number =>
  ARRAY_OVERHEAD_BYTES + length * REFERENCE_BYTES;

const outlineCacheEntryStorageBytes = (key: string, path: string): number =>
  MAP_ENTRY_OVERHEAD_BYTES +
  stringStorageBytes(key) +
  CACHED_OUTLINE_WRAPPER_BYTES +
  outlineStorageBytes(path);

const conservativeCandidateRunBytes = (text: string): number =>
  SHAPED_RUN_OBJECT_BYTES +
  stringStorageBytes(text) +
  arrayStorageBytes(text.length) +
  text.length * GLYPH_OBJECT_BYTES;

const shapedRunStorageBytes = (run: ShapedRun): number => {
  const uniqueOutlines = new Set(run.glyphs.map((glyph) => glyph.outline));
  return (
    SHAPED_RUN_OBJECT_BYTES +
    stringStorageBytes(run.text) +
    arrayStorageBytes(run.glyphs.length) +
    run.glyphs.length * GLYPH_OBJECT_BYTES +
    arrayStorageBytes(run.clusters.length) +
    run.clusters.length * CLUSTER_OBJECT_BYTES +
    run.clusters.reduce((sum, cluster) => sum + arrayStorageBytes(cluster.caretEdges.length), 0) +
    arrayStorageBytes(run.fontSpans.length) +
    run.fontSpans.length * FONT_SPAN_OBJECT_BYTES +
    METRICS_OBJECT_BYTES +
    [...uniqueOutlines].reduce((sum, outline) => sum + outlineStorageBytes(outline.path), 0)
  );
};

const shapeCacheEntryStorageBytes = (key: string, retainedRunBytes: number): number =>
  MAP_ENTRY_OVERHEAD_BYTES +
  stringStorageBytes(key) +
  CACHED_SHAPE_WRAPPER_BYTES +
  retainedRunBytes;

interface CachedOutline {
  readonly outline: GlyphOutline;
  readonly bytes: number;
}

interface CachedShape {
  readonly run: ShapedRun;
  readonly bytes: number;
}

class ProductionHarfBuzzTextShaper implements HarfBuzzTextShaper {
  readonly #harfBuzz: HarfBuzzModule;
  readonly #maxFontBytes: number;
  readonly #maxInputUtf16: number;
  readonly #maxCodepoints: number;
  readonly #maxGlyphs: number;
  readonly #maxCachedFaces: number;
  readonly #maxCachedShapes: number;
  readonly #maxOutlineBytes: number;
  readonly #maxCachedOutlineBytes: number;
  readonly #maxShapedRunBytes: number;
  readonly #maxCachedShapeBytes: number;
  readonly #onFaceCacheEvent: ((event: HarfBuzzFaceCacheEvent) => void) | undefined;
  readonly #instrumentation: HarfBuzzTextShaperInstrumentation | undefined;
  readonly #faces = new Map<string, ActiveHarfBuzzFont>();
  readonly #outlines = new Map<string, CachedOutline>();
  readonly #shapeResults = new Map<string, CachedShape>();
  #outlineBytes = 0;
  #shapeBytes = 0;
  #buffer: HarfBuzzBuffer | undefined;

  constructor(harfBuzz: HarfBuzzModule, options: HarfBuzzTextShaperOptions) {
    this.#harfBuzz = harfBuzz;
    this.#maxFontBytes = assertPositiveLimit(
      options.maxFontBytes ?? DEFAULT_MAX_FONT_BYTES,
      'maximum font bytes',
      HARD_MAX_FONT_BYTES
    );
    this.#maxInputUtf16 = assertPositiveLimit(
      options.maxInputUtf16 ?? DEFAULT_MAX_INPUT_UTF16,
      'maximum input UTF-16 code units',
      HARD_MAX_INPUT_UTF16
    );
    this.#maxCodepoints = assertPositiveLimit(
      options.maxCodepoints ?? DEFAULT_MAX_CODEPOINTS,
      'maximum input code points',
      HARD_MAX_CODEPOINTS
    );
    this.#maxGlyphs = assertPositiveLimit(
      options.maxGlyphs ?? DEFAULT_MAX_GLYPHS,
      'maximum shaped glyphs',
      HARD_MAX_GLYPHS
    );
    this.#maxCachedFaces = assertPositiveLimit(
      options.maxCachedFaces ?? DEFAULT_MAX_CACHED_FACES,
      'maximum cached faces',
      HARD_MAX_CACHED_FACES
    );
    this.#maxCachedShapes = assertPositiveLimit(
      options.maxCachedShapes ?? DEFAULT_MAX_CACHED_SHAPES,
      'maximum cached shape results',
      HARD_MAX_CACHED_SHAPES
    );
    this.#maxOutlineBytes = assertPositiveLimit(
      options.maxOutlineBytes ?? DEFAULT_MAX_OUTLINE_BYTES,
      'maximum outline bytes',
      HARD_MAX_OUTLINE_BYTES
    );
    this.#maxCachedOutlineBytes = assertPositiveLimit(
      options.maxCachedOutlineBytes ?? DEFAULT_MAX_CACHED_OUTLINE_BYTES,
      'maximum cached outline bytes',
      HARD_MAX_CACHED_OUTLINE_BYTES
    );
    this.#maxShapedRunBytes = assertPositiveLimit(
      options.maxShapedRunBytes ?? DEFAULT_MAX_SHAPED_RUN_BYTES,
      'maximum shaped run bytes',
      HARD_MAX_SHAPED_RUN_BYTES
    );
    this.#maxCachedShapeBytes = assertPositiveLimit(
      options.maxCachedShapeBytes ?? DEFAULT_MAX_CACHED_SHAPE_BYTES,
      'maximum cached shape bytes',
      HARD_MAX_CACHED_SHAPE_BYTES
    );
    this.#onFaceCacheEvent = options.instrumentation?.onFaceCacheEvent;
    this.#instrumentation = options.instrumentation;
    this.#buffer = new this.#harfBuzz.Buffer();
  }

  dispose(): void {
    this.#faces.clear();
    this.#outlines.clear();
    this.#shapeResults.clear();
    this.#outlineBytes = 0;
    this.#shapeBytes = 0;
    this.#instrumentation?.onOutlineCacheEvent?.(
      Object.freeze({ kind: 'cleared', retainedBytes: 0 })
    );
    this.#instrumentation?.onShapeCacheEvent?.(
      Object.freeze({ kind: 'cleared', retainedBytes: 0 })
    );
    this.#buffer = undefined;
  }

  #loadFont(fontResource: ResolvedFont, bytes: Uint8Array): ActiveHarfBuzzFont {
    const cached = this.#faces.get(fontResource.identity);
    if (cached) {
      this.#faces.delete(fontResource.identity);
      this.#faces.set(fontResource.identity, cached);
      this.#onFaceCacheEvent?.(Object.freeze({ kind: 'hit', identity: fontResource.identity }));
      return cached;
    }
    const tags = trustedFontTableTags(fontResource);
    for (const required of REQUIRED_TABLES) {
      if (!tags.has(required)) {
        throw new HarfBuzzShapingError('malformedFont', {
          diagnostic: `missing required ${required} table`,
        });
      }
    }
    this.#instrumentation?.onByteCopy?.();
    const blob = new this.#harfBuzz.Blob(toArrayBuffer(bytes));
    const face = new this.#harfBuzz.Face(blob, fontResource.faceIndex);
    const font = new this.#harfBuzz.Font(face);
    const metrics = font.hExtents();
    if (
      !Number.isSafeInteger(face.upem) ||
      face.upem <= 0 ||
      !Number.isSafeInteger(metrics.ascender) ||
      !Number.isSafeInteger(metrics.descender) ||
      !Number.isSafeInteger(metrics.lineGap)
    ) {
      throw new HarfBuzzShapingError('malformedFont', {
        diagnostic: 'invalid font units or horizontal metrics',
      });
    }
    font.setScale(face.upem, face.upem);
    if (this.#faces.size >= this.#maxCachedFaces) {
      const oldest = this.#faces.keys().next().value;
      if (oldest !== undefined) {
        this.#faces.delete(oldest);
        this.#onFaceCacheEvent?.(Object.freeze({ kind: 'evicted', identity: oldest }));
      }
    }
    const active = { identity: fontResource.identity, blob, face, font, unitsPerEm: face.upem };
    this.#faces.set(fontResource.identity, active);
    this.#onFaceCacheEvent?.(Object.freeze({ kind: 'created', identity: fontResource.identity }));
    return active;
  }

  #outline(
    active: ActiveHarfBuzzFont,
    glyphId: number,
    variationFingerprint: string
  ): GlyphOutline {
    const key = JSON.stringify([active.identity, active.unitsPerEm, variationFingerprint, glyphId]);
    const cached = this.#outlines.get(key);
    if (cached) {
      this.#outlines.delete(key);
      this.#outlines.set(key, cached);
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'hit', retainedBytes: this.#outlineBytes })
      );
      return cached.outline;
    }

    this.#instrumentation?.onOutlinePathCall?.();
    const path = active.font.glyphToPath(glyphId);
    const outlineBytes = outlineStorageBytes(path);
    if (outlineBytes > this.#maxOutlineBytes) {
      throw new HarfBuzzShapingError('outlineOverLimit', {
        limit: this.#maxOutlineBytes,
        actual: outlineBytes,
      });
    }
    const outline = Object.freeze({ path, unitsPerEm: active.unitsPerEm });
    const bytes = outlineCacheEntryStorageBytes(key, path);
    if (bytes > this.#maxCachedOutlineBytes) {
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'skipped', retainedBytes: this.#outlineBytes })
      );
      return outline;
    }
    while (this.#outlineBytes + bytes > this.#maxCachedOutlineBytes) {
      const oldest = this.#outlines.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.#outlines.get(oldest)!;
      this.#outlines.delete(oldest);
      this.#outlineBytes -= evicted.bytes;
      this.#instrumentation?.onOutlineCacheEvent?.(
        Object.freeze({ kind: 'evicted', retainedBytes: this.#outlineBytes })
      );
    }
    this.#outlines.set(key, { outline, bytes });
    this.#outlineBytes += bytes;
    this.#instrumentation?.onOutlineCacheEvent?.(
      Object.freeze({ kind: 'created', retainedBytes: this.#outlineBytes })
    );
    return outline;
  }

  #assertTextBudget(text: string): void {
    if (text.length > this.#maxInputUtf16) {
      throw new HarfBuzzShapingError('textOverLimit', {
        limit: this.#maxInputUtf16,
        actual: text.length,
      });
    }
    let codePoints = 0;
    for (let offset = 0; offset < text.length; ) {
      const codePoint = text.codePointAt(offset)!;
      offset += codePoint > 0xffff ? 2 : 1;
      codePoints += 1;
      if (codePoints > this.#maxCodepoints) {
        throw new HarfBuzzShapingError('codepointsOverLimit', {
          limit: this.#maxCodepoints,
          actual: codePoints,
        });
      }
    }
  }

  shape(input: ShapeInput): ShapedRun {
    if (!this.#buffer) throw new HarfBuzzShapingError('disposed');
    assertValidatedResolvedFont(input.environment.font);
    if (input.environment.font.byteLength > this.#maxFontBytes) {
      throw new HarfBuzzShapingError('fontOverLimit', {
        limit: this.#maxFontBytes,
        actual: input.environment.font.byteLength,
      });
    }
    this.#assertTextBudget(input.text);
    const candidateBytes = conservativeCandidateRunBytes(input.text);
    if (candidateBytes > this.#maxShapedRunBytes) {
      throw new HarfBuzzShapingError('shapedRunOverLimit', {
        limit: this.#maxShapedRunBytes,
        actual: candidateBytes,
      });
    }
    const environment = createShapingEnvironment(input.environment);
    const cacheKey = JSON.stringify([
      input.text,
      input.fontSizeHalfPoints,
      input.bidiLevel,
      shapingEnvironmentFingerprint(environment),
    ]);
    const cached = this.#shapeResults.get(cacheKey);
    if (cached) {
      this.#shapeResults.delete(cacheKey);
      this.#shapeResults.set(cacheKey, cached);
      this.#instrumentation?.onShapeCacheEvent?.(
        Object.freeze({ kind: 'hit', retainedBytes: this.#shapeBytes })
      );
      return cached.run;
    }
    this.#instrumentation?.onShapeCacheEvent?.(
      Object.freeze({ kind: 'miss', retainedBytes: this.#shapeBytes })
    );
    if (
      environment.shapingLibrary.name !== HARFBUZZ_SHAPING_LIBRARY.name ||
      environment.shapingLibrary.version !== HARFBUZZ_SHAPING_LIBRARY.version
    ) {
      throw new HarfBuzzShapingError('shapingLibraryMismatch');
    }
    if (environment.normalization !== 'none') {
      throw new HarfBuzzShapingError('unsupportedNormalization');
    }
    if (
      !Number.isSafeInteger(input.bidiLevel) ||
      input.bidiLevel < 0 ||
      ((input.bidiLevel & 1) === 1) !== (environment.direction === 'rtl')
    ) {
      throw new HarfBuzzShapingError('invalidBidiLevel');
    }
    if (Object.keys(environment.variationAxes).length > 0) {
      throw new HarfBuzzShapingError('unsupportedVariationAxes');
    }
    if (environment.fallbackOrder.length > 0) {
      throw new HarfBuzzShapingError('unsupportedFallback');
    }
    const bytes = trustedFontBytes(environment.font);
    const tags = trustedFontTableTags(environment.font);
    if ([...COLOR_TABLES].some((tag) => tags.has(tag))) {
      throw new HarfBuzzShapingError('unsupportedColorFont');
    }

    const text = input.text;
    this.#assertTextBudget(text);

    try {
      const active = this.#loadFont(environment.font, bytes);
      const { face, font } = active;
      const buffer = this.#buffer;
      buffer.reset();
      buffer.addText(text);
      buffer.setDirection(
        environment.direction === 'rtl'
          ? this.#harfBuzz.Direction.RTL
          : this.#harfBuzz.Direction.LTR
      );
      buffer.setScript(environment.script);
      buffer.setLanguage(environment.language);
      buffer.setClusterLevel(this.#harfBuzz.ClusterLevel.MONOTONE_CHARACTERS);
      const features = Object.entries(environment.features).map(
        ([tag, value]) => new this.#harfBuzz.Feature(tag, value)
      );
      this.#instrumentation?.onShapeCall?.();
      this.#harfBuzz.shape(font, buffer, features);
      const shaped = buffer.getGlyphInfosAndPositions();
      if (shaped.length > this.#maxGlyphs) {
        throw new HarfBuzzShapingError('glyphOverLimit', {
          limit: this.#maxGlyphs,
          actual: shaped.length,
        });
      }

      const convert = fontUnitsConverter(
        face.upem,
        input.fontSizeHalfPoints,
        environment.fixedPointScale,
        environment.roundingMode
      );
      let originX = fixedPoint(0);
      let originY = fixedPoint(0);
      const runOutlines = new Map<number, GlyphOutline>();
      const variationFingerprint = JSON.stringify(
        Object.entries(environment.variationAxes).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
      const glyphs: ShapedGlyph[] = shaped.map((glyph) => {
        const advanceX = convert(glyph.xAdvance ?? 0);
        const advanceY = convert(glyph.yAdvance ?? 0);
        const positioned = {
          id: glyph.codepoint,
          cluster: glyph.cluster,
          originX,
          originY,
          advanceX,
          advanceY,
          offsetX: convert(glyph.xOffset ?? 0),
          offsetY: convert(glyph.yOffset ?? 0),
          outline:
            runOutlines.get(glyph.codepoint) ??
            (() => {
              const outline = this.#outline(active, glyph.codepoint, variationFingerprint);
              runOutlines.set(glyph.codepoint, outline);
              return outline;
            })(),
        };
        originX = fixedPoint(originX + advanceX);
        originY = fixedPoint(originY + advanceY);
        return positioned;
      });
      const extents = font.hExtents();
      const result = createShapedRun(
        {
          text,
          direction: environment.direction,
          bidiLevel: input.bidiLevel,
          glyphs,
          clusters: clustersFromGlyphs(text, glyphs),
          fontSpans:
            glyphs.length === 0
              ? []
              : [
                  {
                    glyphStart: 0,
                    glyphEnd: glyphs.length,
                    font: environment.font,
                    fallbackIndex: null,
                  },
                ],
          metrics: {
            ascent: convert(extents.ascender),
            descent: convert(-extents.descender),
            lineGap: convert(extents.lineGap),
          },
        },
        environment
      );
      const resultBytes = shapedRunStorageBytes(result);
      if (resultBytes > this.#maxShapedRunBytes) {
        throw new HarfBuzzShapingError('shapedRunOverLimit', {
          limit: this.#maxShapedRunBytes,
          actual: resultBytes,
        });
      }
      const cachedBytes = shapeCacheEntryStorageBytes(cacheKey, resultBytes);
      if (cachedBytes > this.#maxCachedShapeBytes) {
        this.#instrumentation?.onShapeCacheEvent?.(
          Object.freeze({ kind: 'skipped', retainedBytes: this.#shapeBytes })
        );
        return result;
      }
      while (
        this.#shapeResults.size >= this.#maxCachedShapes ||
        this.#shapeBytes + cachedBytes > this.#maxCachedShapeBytes
      ) {
        const oldest = this.#shapeResults.keys().next().value;
        if (oldest === undefined) break;
        const evicted = this.#shapeResults.get(oldest)!;
        this.#shapeResults.delete(oldest);
        this.#shapeBytes -= evicted.bytes;
        this.#instrumentation?.onShapeCacheEvent?.(
          Object.freeze({ kind: 'evicted', retainedBytes: this.#shapeBytes })
        );
      }
      this.#shapeResults.set(cacheKey, { run: result, bytes: cachedBytes });
      this.#shapeBytes += cachedBytes;
      this.#instrumentation?.onShapeCacheEvent?.(
        Object.freeze({ kind: 'stored', retainedBytes: this.#shapeBytes })
      );
      return result;
    } catch (error) {
      if (error instanceof HarfBuzzShapingError) throw error;
      throw new HarfBuzzShapingError('malformedFont', {
        diagnostic: error instanceof Error ? error.message : 'HarfBuzz shaping failed',
      });
    }
  }
}

/**
 * Build a HarfBuzz-backed shaper.
 *
 * Requires `initializeHarfBuzz()` to have resolved — shaping is synchronous, so the WASM runtime
 * must already be loaded. Dispose the result when the editor goes away, or its cached faces leak.
 */
export const createHarfBuzzTextShaper = (
  options: HarfBuzzTextShaperOptions = {}
): HarfBuzzTextShaper => new ProductionHarfBuzzTextShaper(requireHarfBuzz(), options);

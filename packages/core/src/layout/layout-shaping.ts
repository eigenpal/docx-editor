// Environment-neutral construction of the HarfBuzz shaping substrate.

import {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
  createFontResourceSnapshot,
  type FontRequest,
} from './font-resource.ts';
import {
  HARFBUZZ_SHAPING_LIBRARY,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  initializeHarfBuzz,
} from './harfbuzz-shaper.ts';
import type { LayoutShapingOptions } from './shaped-measurer.ts';

const FEATURES = Object.freeze({ kern: 1, liga: 1 });
const HARD_MAX_FONT_SUBSTITUTIONS = HARD_MAX_FONT_SOURCES;

/** Byte-backed face accepted by neutral shaping. @public */
export interface LayoutFontSource {
  readonly request: FontRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

/** Explicit face substitution accepted by neutral shaping. @public */
export interface LayoutFontSubstitution {
  readonly from: FontRequest;
  readonly to: FontRequest;
  readonly lineMetrics?: { readonly heightEm: number; readonly baselineEm: number };
}

/** Structural font configuration shared by browser and server hosts. @public */
export interface LayoutFontConfiguration {
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly sources: readonly LayoutFontSource[];
  readonly substitutions?: readonly LayoutFontSubstitution[];
  readonly defaultFont: { readonly family: string; readonly sizeHalfPoints: number };
  readonly language?: string;
}

/** Optional measurements for resource-budget tests and host diagnostics. @public */
export interface LayoutShapingInstrumentation {
  readonly onFontByteCopy?: () => void;
  readonly onFontHash?: () => void;
  readonly onFontAdmission?: () => void;
}

/** Invalid host configuration caught before any bytes reach HarfBuzz. @public */
export class LayoutShapingConfigurationError extends Error {
  readonly code = 'overLimit' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LayoutShapingConfigurationError';
  }
}

/**
 * Take a bounded, immutable sample of host-owned shaping configuration.
 *
 * Kept outside the async initializer so shared exporter hosts can reserve the exact byte set that
 * HarfBuzz will receive. Count ceilings are checked before visiting any caller-owned entry.
 * @internal
 */
export function snapshotLayoutFontConfiguration(
  configuration: LayoutFontConfiguration
): LayoutFontConfiguration {
  const epoch = configuration.epoch;
  const maxFontBytes = configuration.maxFontBytes;
  const sourceInput = configuration.sources;
  const substitutionInput = configuration.substitutions;
  if (
    !Number.isSafeInteger(maxFontBytes) ||
    maxFontBytes <= 0 ||
    maxFontBytes > HARD_MAX_FONT_BYTES
  ) {
    throw new LayoutShapingConfigurationError(
      `Font byte ceiling must not exceed the engine hard maximum of ${HARD_MAX_FONT_BYTES}`
    );
  }
  if (sourceInput.length === 0 || sourceInput.length > HARD_MAX_FONT_SOURCES) {
    throw new LayoutShapingConfigurationError(
      `Font source count must be between 1 and ${HARD_MAX_FONT_SOURCES}`
    );
  }
  if ((substitutionInput?.length ?? 0) > HARD_MAX_FONT_SUBSTITUTIONS) {
    throw new LayoutShapingConfigurationError(
      `Font substitution count must not exceed ${HARD_MAX_FONT_SUBSTITUTIONS}`
    );
  }

  let aggregateBytes = 0;
  const sources = sourceInput.map((source) => {
    const bytes = source.bytes;
    if (bytes.byteLength > maxFontBytes) {
      throw new LayoutShapingConfigurationError(
        `Font source ${source.id} exceeds the per-font byte ceiling`
      );
    }
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > HARD_MAX_AGGREGATE_FONT_BYTES) {
      throw new LayoutShapingConfigurationError(
        `Font sources exceed the aggregate byte ceiling of ${HARD_MAX_AGGREGATE_FONT_BYTES}`
      );
    }
    return Object.freeze({
      request: Object.freeze({ ...source.request }),
      id: source.id,
      bytes,
      hash: source.hash,
      faceIndex: source.faceIndex,
      ...(source.availability ? { availability: source.availability } : {}),
    });
  });
  const substitutions = substitutionInput?.map((substitution) =>
    Object.freeze({
      from: Object.freeze({ ...substitution.from }),
      to: Object.freeze({ ...substitution.to }),
      ...(substitution.lineMetrics
        ? { lineMetrics: Object.freeze({ ...substitution.lineMetrics }) }
        : {}),
    })
  );

  return Object.freeze({
    epoch,
    maxFontBytes,
    sources: Object.freeze(sources),
    ...(substitutions ? { substitutions: Object.freeze(substitutions) } : {}),
    defaultFont: Object.freeze({ ...configuration.defaultFont }),
    ...(configuration.language === undefined ? {} : { language: configuration.language }),
  });
}

/** Build one shaped-layout environment without importing an editor or DOM lane. @public */
export async function createLayoutShaping(
  configuration: LayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation
): Promise<LayoutShapingOptions> {
  // Sample every caller-owned value before the asynchronous initialization boundary. A host
  // mutating its configuration while HarfBuzz loads must not create a half-old, half-new
  // operation identity.
  const snapshot = snapshotLayoutFontConfiguration(configuration);
  const { epoch, maxFontBytes, sources, substitutions, defaultFont } = snapshot;
  const language = snapshot.language ?? 'en';

  const fonts = createFontResourceSnapshot({
    epoch,
    maxFontBytes,
    resources: sources,
    substitutions,
    validateFont: harfBuzzFontValidator,
    instrumentation: {
      onOwnedByteCopy: instrumentation?.onFontByteCopy,
      onHash: instrumentation?.onFontHash,
      onAdmission: instrumentation?.onFontAdmission,
    },
  });
  await initializeHarfBuzz();
  return Object.freeze({
    fonts,
    shaper: createHarfBuzzTextShaper(),
    defaultFont,
    environment: Object.freeze({
      variationAxes: Object.freeze({}),
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      normalization: 'none' as const,
      language,
      features: FEATURES,
      fixedPointScale: 20,
      roundingMode: 'halfAwayFromZero' as const,
    }),
    ligatureCaretPolicy: 'cluster-edges-only' as const,
    operation: Object.freeze({
      resourceEpoch: fonts.epoch,
      configEpoch: epoch,
      extensionFingerprint: `fonts:${JSON.stringify(
        sources.map((source) => [
          source.request.family,
          source.request.weight,
          source.request.style,
          source.hash,
          source.faceIndex,
        ])
      )};substitutions:${JSON.stringify(substitutions ?? [])}`,
      shapingHash: `hb:${HARFBUZZ_SHAPING_LIBRARY.version}:kern+liga`,
      producerVersion: 1,
    }),
  });
}

/** Release native resources held by a shaping environment. @public */
export function disposeLayoutShaping(shaping: LayoutShapingOptions): void {
  const shaper = shaping.shaper as LayoutShapingOptions['shaper'] & { dispose?: () => void };
  shaper.dispose?.();
}

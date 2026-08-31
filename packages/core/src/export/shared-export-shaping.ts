// Process-wide shaped measurement shared by Node exporters.

import {
  FontResolutionError,
  createFixedMeasurer,
  createHarfBuzzTextShaper,
  createLayoutShapedMeasurer,
  fontRequestKey,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  initializeHarfBuzz,
  type PreparedLayoutFontConfiguration,
  type LayoutShapingInstrumentation,
  type LayoutShapingOptions,
  type TextMeasurer,
  type TextShaper,
} from '../layout/index.ts';
import { FIXED_MEASURER_FINGERPRINT } from '../layout/fixed-measurer.ts';
import { LAYOUT_HARFBUZZ_SHAPER_POLICY } from '../layout/layout-shaper-policy.ts';
import {
  configurationOfPreparedLayoutFonts,
  createLayoutShapingWithTextShaper,
  isPreparedLayoutFontConfiguration,
  sharedShapingFingerprintOfPreparedLayoutFonts,
} from '../layout/layout-shaping.ts';

/** Immutable handle over process-wide measurement state reusable by every exporter. @public */
export interface SharedExportShaping {
  /** Create one document-scoped measurement cache over the process-wide immutable substrate. */
  createMeasurer(): TextMeasurer;
  /** Stable cache/diagnostic producer identity for export layout sessions. */
  readonly producer: string;
  /** Font and substitution identity shared with browser layout caches. */
  readonly extensionFingerprint: string;
}

interface SharedExportShapingSubstrate {
  createMeasurer(): TextMeasurer;
  readonly shapingHash: string;
  readonly producerVersion: number;
}

const sharedShaping = new Map<string, Promise<SharedExportShapingSubstrate>>();
const sharedShapingViews = new WeakMap<
  PreparedLayoutFontConfiguration,
  Promise<SharedExportShaping>
>();
let retainedOrReservedFontBytes = 0;
let processWideExportShaper: Promise<TextShaper> | undefined;

/** Process-wide ceiling preventing host-derived cache keys from retaining unbounded font sets. @public */
export const MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS = 32;

/** Aggregate process-wide font-byte budget across every successful shared configuration. */
export const MAX_SHARED_EXPORT_SHAPING_FONT_BYTES = HARD_MAX_AGGREGATE_FONT_BYTES;

/**
 * One process-wide HarfBuzz shaper makes its face/outline/shape LRUs aggregate exporter bounds.
 * A rejected initialization is retryable, matching failed substrate initialization below.
 * @internal
 */
export function acquireProcessWideExportShaper(): Promise<TextShaper> {
  if (processWideExportShaper) return processWideExportShaper;
  const pending = (async (): Promise<TextShaper> => {
    await initializeHarfBuzz();
    return createHarfBuzzTextShaper(LAYOUT_HARFBUZZ_SHAPER_POLICY);
  })();
  processWideExportShaper = pending;
  void pending.catch(() => {
    if (processWideExportShaper === pending) processWideExportShaper = undefined;
  });
  return pending;
}

function shapedMeasurer(shaping: LayoutShapingOptions): TextMeasurer {
  const resolved = new Map<string, ReturnType<typeof shaping.fonts.resolve>>();
  return createLayoutShapedMeasurer(shaping, {
    resolveFont(style) {
      const family = style.fontFamily ?? shaping.defaultFont.family;
      if (family.trim().length === 0) return null;
      const request = {
        family,
        weight: style.bold ? 700 : 400,
        style: style.italic ? ('italic' as const) : ('normal' as const),
      };
      const key = fontRequestKey(request);
      let result = resolved.get(key);
      if (!result) {
        try {
          result = shaping.fonts.resolve(request);
        } catch {
          return null;
        }
        resolved.set(key, result);
      }
      return result instanceof FontResolutionError ? null : result;
    },
    fallback: createFixedMeasurer(),
  });
}

/**
 * Acquire one process-wide shaped measurement substrate for a host configuration.
 *
 * Failed initialization is evicted so a corrected transient resource can retry. Successful
 * native shaping and admitted font bytes intentionally live for the process lifetime; export
 * sessions retain only their own layout caches and remain independently disposable.
 * @public
 */
export function acquireSharedExportShaping(
  prepared: PreparedLayoutFontConfiguration,
  instrumentation?: LayoutShapingInstrumentation
): Promise<SharedExportShaping> {
  if (!isPreparedLayoutFontConfiguration(prepared)) {
    return Promise.reject(new TypeError('Shared exporter shaping requires a prepared font handle'));
  }
  const existingView = sharedShapingViews.get(prepared);
  if (existingView) return existingView;
  // A host epoch invalidates that host's operation caches, but cannot change an already owned
  // immutable byte/configuration snapshot. Key the process-wide native substrate by the latter:
  // otherwise byte-identical reloads consume one permanent slot and byte budget per epoch.
  const cacheKey = sharedShapingFingerprintOfPreparedLayoutFonts(prepared);
  let substrate = sharedShaping.get(cacheKey);
  if (!substrate) {
    if (sharedShaping.size >= MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS) {
      return Promise.reject(
        new RangeError(
          `Shared exporter shaping is limited to ${MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS} process-wide configurations`
        )
      );
    }
    substrate = (async (): Promise<SharedExportShapingSubstrate> => {
      const configuration = configurationOfPreparedLayoutFonts(prepared);
      const byteSize = configuration.sources.reduce(
        (total, source) =>
          total + (source.availability === 'forbidden' ? 0 : source.bytes.byteLength),
        0
      );
      if (retainedOrReservedFontBytes + byteSize > MAX_SHARED_EXPORT_SHAPING_FONT_BYTES) {
        throw new RangeError(
          `Shared exporter shaping font bytes are limited to ${MAX_SHARED_EXPORT_SHAPING_FONT_BYTES} process-wide`
        );
      }
      // Reserve synchronously before native initialization yields, so concurrent distinct keys
      // cannot each observe the same remaining budget. Successful substrates retain the bytes.
      retainedOrReservedFontBytes += byteSize;
      let shaping: LayoutShapingOptions;
      try {
        const shaper = await acquireProcessWideExportShaper();
        shaping = await createLayoutShapingWithTextShaper(
          prepared,
          shaper,
          LAYOUT_HARFBUZZ_SHAPER_POLICY,
          instrumentation
        );
      } catch (error) {
        retainedOrReservedFontBytes -= byteSize;
        throw error;
      }
      return Object.freeze({
        createMeasurer: () => shapedMeasurer(shaping),
        shapingHash: shaping.operation.shapingHash,
        producerVersion: shaping.operation.producerVersion,
      });
    })();
    sharedShaping.set(cacheKey, substrate);
    void substrate.catch(() => {
      if (sharedShaping.get(cacheKey) === substrate) sharedShaping.delete(cacheKey);
    });
  }

  // Keep the host operation fingerprint (including epoch) on the cache-facing view. Only the
  // hidden immutable native substrate is deduplicated by content.
  const extensionFingerprint = prepared.fingerprint;
  const pending = substrate.then(
    (shared): SharedExportShaping =>
      Object.freeze({
        createMeasurer: shared.createMeasurer,
        producer: [
          'node-export',
          extensionFingerprint,
          shared.shapingHash,
          `producer:${shared.producerVersion}`,
          `fallback:${FIXED_MEASURER_FINGERPRINT}`,
        ].join('|'),
        extensionFingerprint,
      })
  );
  sharedShapingViews.set(prepared, pending);
  void pending.catch(() => {
    if (sharedShapingViews.get(prepared) === pending) sharedShapingViews.delete(prepared);
  });
  return pending;
}

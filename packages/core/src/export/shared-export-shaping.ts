// Process-wide shaped measurement shared by Node exporters.

import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createLayoutShaping,
  createShapedMeasurer,
  fontRequestKey,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  type LayoutFontConfiguration,
  type LayoutShapingInstrumentation,
  type LayoutShapingOptions,
  type TextMeasurer,
} from '../layout/index.ts';
import { snapshotLayoutFontConfiguration } from '../layout/layout-shaping.ts';

/** Host-owned configuration loader for a process-wide exporter shaping substrate. @public */
export interface SharedExportShapingProvider {
  /** Stable identity for the exact immutable font/configuration set. */
  readonly cacheKey: string;
  /** Called once per successful cache key, including across concurrent exporter opens. */
  loadConfiguration(): Promise<LayoutFontConfiguration>;
}

/** Immutable process-wide measurement substrate reusable by every exporter. @public */
export interface SharedExportShaping {
  /** Create one document-scoped measurement cache over the process-wide immutable substrate. */
  createMeasurer(): TextMeasurer;
  /** Stable cache/diagnostic producer identity for export layout sessions. */
  readonly producer: string;
  /** Font and substitution identity shared with browser layout caches. */
  readonly extensionFingerprint: string;
}

const sharedShaping = new Map<string, Promise<SharedExportShaping>>();
let retainedOrReservedFontBytes = 0;

/** Process-wide ceiling preventing host-derived cache keys from retaining unbounded font sets. @public */
export const MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS = 32;

/** Aggregate process-wide font-byte budget across every successful shared configuration. */
export const MAX_SHARED_EXPORT_SHAPING_FONT_BYTES = HARD_MAX_AGGREGATE_FONT_BYTES;

function shapedMeasurer(shaping: LayoutShapingOptions): TextMeasurer {
  const resolved = new Map<string, ReturnType<typeof shaping.fonts.resolve>>();
  return createShapedMeasurer({
    shaper: shaping.shaper,
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
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: shaping.environment.unicodeDataVersion,
    language: shaping.environment.language,
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
  provider: SharedExportShapingProvider,
  instrumentation?: LayoutShapingInstrumentation
): Promise<SharedExportShaping> {
  const cacheKey = provider.cacheKey.trim();
  if (cacheKey.length === 0) {
    return Promise.reject(new TypeError('Shared exporter shaping cacheKey must not be empty'));
  }
  const existing = sharedShaping.get(cacheKey);
  if (existing) return existing;
  if (sharedShaping.size >= MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS) {
    return Promise.reject(
      new RangeError(
        `Shared exporter shaping is limited to ${MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS} process-wide configurations`
      )
    );
  }

  const pending = (async (): Promise<SharedExportShaping> => {
    const configuration = snapshotLayoutFontConfiguration(await provider.loadConfiguration());
    const byteSize = configuration.sources.reduce(
      (total, source) => total + source.bytes.byteLength,
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
    let shaping: Awaited<ReturnType<typeof createLayoutShaping>>;
    try {
      shaping = await createLayoutShaping(configuration, instrumentation);
    } catch (error) {
      retainedOrReservedFontBytes -= byteSize;
      throw error;
    }
    const extensionFingerprint = shaping.operation.extensionFingerprint;
    return Object.freeze({
      createMeasurer: () => shapedMeasurer(shaping),
      producer: `node-export-${extensionFingerprint}`,
      extensionFingerprint,
    });
  })();
  sharedShaping.set(cacheKey, pending);
  void pending.catch(() => {
    if (sharedShaping.get(cacheKey) === pending) sharedShaping.delete(cacheKey);
  });
  return pending;
}

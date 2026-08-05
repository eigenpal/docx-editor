import {
  EditorFontError,
  type EditorFontErrorCode,
  type FontConfiguration,
  type FontFaceRequest,
} from '@docx-editor.dev/core/contracts/editor';
import {
  HARFBUZZ_SHAPING_LIBRARY,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
  FontResolutionError,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  type LayoutShapingOptions,
} from '@docx-editor.dev/core/layout';

const FEATURES = Object.freeze({ kern: 1, liga: 1 });

export interface LayoutShapingInstrumentation {
  readonly onFontByteCopy?: () => void;
  readonly onFontHash?: () => void;
  readonly onFontAdmission?: () => void;
}

function publicRequest(request: FontFaceRequest): FontFaceRequest {
  return Object.freeze({
    family: request.family,
    weight: request.weight,
    style: request.style,
  });
}

/**
 * Normalize anything thrown during font work into an {@link EditorFontError}.
 *
 * One error type reaches consumers whether the failure came from resolution, admission or
 * shaping, so a host branches on `code` rather than on which layer happened to throw.
 */
export function toEditorFontError(error: unknown): EditorFontError {
  if (error instanceof EditorFontError) return error;
  if (error instanceof FontResolutionError) {
    return new EditorFontError(error.code as EditorFontErrorCode, error.message, {
      request: publicRequest(error.request),
      diagnostic: error.diagnostic,
    });
  }
  return new EditorFontError(
    'initializationFailed',
    error instanceof Error ? error.message : 'Font initialization failed',
    { diagnostic: error instanceof Error ? error.message : String(error) }
  );
}

/** Adapt the published byte-source contract to the private deterministic layout snapshot. */
export async function createLayoutShaping(
  configuration: FontConfiguration,
  instrumentation?: LayoutShapingInstrumentation
): Promise<LayoutShapingOptions> {
  try {
    if (
      !Number.isSafeInteger(configuration.maxFontBytes) ||
      configuration.maxFontBytes <= 0 ||
      configuration.maxFontBytes > HARD_MAX_FONT_BYTES
    ) {
      throw new EditorFontError(
        'overLimit',
        `Font byte ceiling must not exceed the engine hard maximum of ${HARD_MAX_FONT_BYTES}`
      );
    }
    if (
      !Number.isSafeInteger(configuration.sources.length) ||
      configuration.sources.length === 0 ||
      configuration.sources.length > HARD_MAX_FONT_SOURCES
    ) {
      throw new EditorFontError(
        'overLimit',
        `Font source count must be between 1 and ${HARD_MAX_FONT_SOURCES}`
      );
    }
    let aggregateBytes = 0;
    for (const source of configuration.sources) {
      if (
        !Number.isSafeInteger(source.bytes.byteLength) ||
        source.bytes.byteLength > configuration.maxFontBytes ||
        source.bytes.byteLength > HARD_MAX_FONT_BYTES
      ) {
        throw new EditorFontError(
          'overLimit',
          `Font source ${source.id} exceeds the per-font byte ceiling`
        );
      }
      if (source.bytes.byteLength > HARD_MAX_AGGREGATE_FONT_BYTES - aggregateBytes) {
        throw new EditorFontError(
          'overLimit',
          `Font sources exceed the aggregate byte ceiling of ${HARD_MAX_AGGREGATE_FONT_BYTES}`
        );
      }
      aggregateBytes += source.bytes.byteLength;
    }
    const sampled = {
      epoch: configuration.epoch,
      maxFontBytes: configuration.maxFontBytes,
      sources: configuration.sources.map((source) => ({
        request: publicRequest(source.request),
        id: source.id,
        bytes: source.bytes,
        hash: source.hash,
        faceIndex: source.faceIndex,
        availability: source.availability,
      })),
      substitutions: configuration.substitutions?.map((substitution) => ({
        from: publicRequest(substitution.from),
        to: publicRequest(substitution.to),
      })),
      defaultFont: Object.freeze({
        family: configuration.defaultFont.family,
        sizeHalfPoints: configuration.defaultFont.sizeHalfPoints,
      }),
      language: configuration.language,
    };
    const fonts = createFontResourceSnapshot({
      epoch: sampled.epoch,
      maxFontBytes: sampled.maxFontBytes,
      resources: sampled.sources,
      substitutions: sampled.substitutions,
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
      defaultFont: Object.freeze({
        family: sampled.defaultFont.family,
        sizeHalfPoints: sampled.defaultFont.sizeHalfPoints,
      }),
      environment: Object.freeze({
        variationAxes: Object.freeze({}),
        shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
        unicodeDataVersion: '16.0.0',
        normalization: 'none',
        language: sampled.language ?? 'en',
        features: FEATURES,
        fixedPointScale: 20,
        roundingMode: 'halfAwayFromZero',
      }),
      ligatureCaretPolicy: 'cluster-edges-only',
      operation: Object.freeze({
        resourceEpoch: fonts.epoch,
        configEpoch: sampled.epoch,
        extensionFingerprint: `fonts:${sampled.sources
          .map((source) => `${source.hash}#${source.faceIndex}`)
          .join(',')}`,
        shapingHash: `hb:${HARFBUZZ_SHAPING_LIBRARY.version}:kern+liga`,
        producerVersion: 1,
      }),
    });
  } catch (error) {
    throw toEditorFontError(error);
  }
}

/**
 * Release a shaping environment's native resources.
 *
 * The shaper holds WASM memory that garbage collection cannot reclaim on its own, so a host that
 * builds shaping options must dispose them when the editor goes away. Safe on a shaper that has
 * no `dispose`.
 */
export function disposeLayoutShaping(shaping: LayoutShapingOptions): void {
  const shaper = shaping.shaper as LayoutShapingOptions['shaper'] & {
    dispose?: () => void;
  };
  shaper.dispose?.();
}

// Canonical HarfBuzz policy for every production layout host.

import type { HarfBuzzTextShaperOptions } from './harfbuzz-shaper.ts';
import { sha256FontBytes } from './font-resource.ts';

type HarfBuzzOptionRole = 'execution-refusal' | 'cache-retention' | 'instrumentation';

/**
 * Evolution gate for low-level shaper options.
 *
 * Refusal limits can change whether layout uses shaped or fallback measurement and therefore enter
 * producer identity. Cache-retention limits change only how long an already computed result stays
 * resident. Instrumentation observes work without changing it.
 * @internal
 */
const HARFBUZZ_OPTION_ROLES = {
  maxFontBytes: 'execution-refusal',
  maxInputUtf16: 'execution-refusal',
  maxCodepoints: 'execution-refusal',
  maxGlyphs: 'execution-refusal',
  maxCachedFaces: 'cache-retention',
  maxCachedShapes: 'cache-retention',
  maxOutlineBytes: 'execution-refusal',
  maxCachedOutlineBytes: 'cache-retention',
  maxShapedRunBytes: 'execution-refusal',
  maxCachedShapeBytes: 'cache-retention',
  instrumentation: 'instrumentation',
} as const satisfies Record<keyof HarfBuzzTextShaperOptions, HarfBuzzOptionRole>;

void HARFBUZZ_OPTION_ROLES;

type HarfBuzzOptionKeyWithRole<Role extends HarfBuzzOptionRole> = {
  [Key in keyof typeof HARFBUZZ_OPTION_ROLES]: (typeof HARFBUZZ_OPTION_ROLES)[Key] extends Role
    ? Key
    : never;
}[keyof typeof HARFBUZZ_OPTION_ROLES];

type LayoutHarfBuzzPolicyKey = Exclude<
  keyof HarfBuzzTextShaperOptions,
  HarfBuzzOptionKeyWithRole<'instrumentation'>
>;

/** Complete production policy, intentionally excluding observation-only instrumentation. @internal */
export type LayoutHarfBuzzShaperPolicy = Readonly<{
  [Key in LayoutHarfBuzzPolicyKey]-?: NonNullable<HarfBuzzTextShaperOptions[Key]>;
}>;

/**
 * One neutral policy used by browser pagination, headless exporters, and future layout hosts.
 * Cache limits are process-wide for the shared exporter shaper and per-owner for public shapers.
 * @internal
 */
export const LAYOUT_HARFBUZZ_SHAPER_POLICY = Object.freeze({
  maxFontBytes: 16 * 1024 * 1024,
  maxInputUtf16: 1_000_000,
  maxCodepoints: 1_000_000,
  maxGlyphs: 1_000_000,
  maxCachedFaces: 4,
  maxCachedShapes: 512,
  maxOutlineBytes: 1024 * 1024,
  maxCachedOutlineBytes: 16 * 1024 * 1024,
  maxShapedRunBytes: 32 * 1024 * 1024,
  maxCachedShapeBytes: 64 * 1024 * 1024,
} satisfies LayoutHarfBuzzShaperPolicy);

/** Stable framed identity for every refusal-affecting production shaper option. @internal */
export function layoutShaperExecutionPolicyFingerprint(policy: LayoutHarfBuzzShaperPolicy): string {
  const executionFields = {
    maxFontBytes: policy.maxFontBytes,
    maxInputUtf16: policy.maxInputUtf16,
    maxCodepoints: policy.maxCodepoints,
    maxGlyphs: policy.maxGlyphs,
    maxOutlineBytes: policy.maxOutlineBytes,
    maxShapedRunBytes: policy.maxShapedRunBytes,
  } satisfies Readonly<Record<HarfBuzzOptionKeyWithRole<'execution-refusal'>, number>>;
  const frame = [
    'docx-editor-layout-harfbuzz-execution-policy',
    1,
    Object.entries(executionFields)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => Object.freeze([key, value])),
  ] as const;
  return `layout-shaper-policy:sha256:${sha256FontBytes(
    new TextEncoder().encode(JSON.stringify(frame))
  )}`;
}

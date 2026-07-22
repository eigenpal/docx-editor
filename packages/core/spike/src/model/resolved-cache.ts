/** @spike-features minimal-canonical-layout, synthetic-128-paragraph-fixture */
import {
  createImmutableLookup,
  readClosedDataObject,
  snapshotDenseArray,
} from './immutability';
import type { ImmutableLookup, ModelRevision } from './types';

export interface ResolvedParagraphStyle {
  readonly lineHeightTwips: number;
  readonly spaceAfterTwips: number;
}

export interface ResolvedModelCache {
  readonly entries: ImmutableLookup<string, ResolvedCacheEntry>;
}

export interface ResolvedCacheEntry {
  readonly paragraphId: string;
  readonly sourceRevision: ModelRevision;
  readonly dependencyFingerprint: string;
  readonly inputFingerprint: string;
  readonly immutableInputFingerprint: string;
  readonly shapingEnvironmentVersion: string;
  readonly value: ResolvedParagraphStyle;
}

export interface ResolvedCacheProvenance {
  readonly revision: ModelRevision;
  readonly dependencyFingerprint: string;
  readonly inputFingerprint: string;
  readonly immutableInputFingerprint: string;
  readonly shapingEnvironmentVersion: string;
}

export const RESOLVED_STYLE_LIMITS = Object.freeze({
  lineHeightTwips: Object.freeze({ min: 1, max: 31_680 }),
  spaceAfterTwips: Object.freeze({ min: 0, max: 31_680 }),
});

export function createResolvedModelCache(input: {
  readonly entries: readonly (readonly [string, ResolvedCacheEntry])[];
}): ResolvedModelCache {
  const cacheInput = readClosedDataObject(input, ['entries'], 'resolved cache');
  const rawEntries = snapshotDenseArray(cacheInput.entries, 'resolved cache entries');
  const entries: Array<readonly [string, ResolvedCacheEntry]> = [];
  const paragraphIds = new Set<string>();
  for (const rawTuple of rawEntries) {
    const tuple = snapshotDenseArray(rawTuple, 'resolved cache entry tuple');
    if (tuple.length !== 2 || typeof tuple[0] !== 'string') {
      throw new TypeError('invalid resolved cache entry tuple');
    }
    const lookupKey = tuple[0];
    const entry = readClosedDataObject(
      tuple[1],
      [
        'paragraphId',
        'sourceRevision',
        'dependencyFingerprint',
        'inputFingerprint',
        'immutableInputFingerprint',
        'shapingEnvironmentVersion',
        'value',
      ],
      'resolved cache entry'
    );
    if (
      !Number.isInteger(entry.sourceRevision) ||
      (entry.sourceRevision as number) < 0 ||
      !isValidIdentifier(entry.paragraphId) ||
      lookupKey !== entry.paragraphId ||
      paragraphIds.has(entry.paragraphId as string)
    ) {
      throw new TypeError('invalid resolved cache entry identity or revision');
    }
    for (const [name, value] of [
      ['dependencyFingerprint', entry.dependencyFingerprint],
      ['inputFingerprint', entry.inputFingerprint],
      ['immutableInputFingerprint', entry.immutableInputFingerprint],
      ['shapingEnvironmentVersion', entry.shapingEnvironmentVersion],
    ] as const) {
      if (!isValidFingerprint(value)) {
        throw new TypeError(`${name} must be a valid non-empty string`);
      }
    }
    const style = readClosedDataObject(
      entry.value,
      ['lineHeightTwips', 'spaceAfterTwips'],
      'resolved cache value'
    );
    if (
      !isIntegerInRange(
        style.lineHeightTwips,
        RESOLVED_STYLE_LIMITS.lineHeightTwips.min,
        RESOLVED_STYLE_LIMITS.lineHeightTwips.max
      ) ||
      !isIntegerInRange(
        style.spaceAfterTwips,
        RESOLVED_STYLE_LIMITS.spaceAfterTwips.min,
        RESOLVED_STYLE_LIMITS.spaceAfterTwips.max
      )
    ) {
      throw new TypeError('resolved cache value is outside frozen twip ranges');
    }
    paragraphIds.add(entry.paragraphId as string);
    entries.push([
      lookupKey,
      Object.freeze({
        paragraphId: entry.paragraphId as string,
        sourceRevision: entry.sourceRevision as number,
        dependencyFingerprint: entry.dependencyFingerprint as string,
        inputFingerprint: entry.inputFingerprint as string,
        immutableInputFingerprint: entry.immutableInputFingerprint as string,
        shapingEnvironmentVersion: entry.shapingEnvironmentVersion as string,
        value: Object.freeze({
          lineHeightTwips: style.lineHeightTwips as number,
          spaceAfterTwips: style.spaceAfterTwips as number,
        }),
      }),
    ]);
  }
  return Object.freeze({
    entries: createImmutableLookup(entries),
  });
}

export function canReuseResolvedCache(
  cache: ResolvedModelCache,
  paragraphId: string,
  provenance: ResolvedCacheProvenance
): boolean {
  if (!isValidIdentifier(paragraphId)) return false;
  let candidate: Record<string, unknown>;
  try {
    candidate = readClosedDataObject(
      provenance,
      [
        'revision',
        'dependencyFingerprint',
        'inputFingerprint',
        'immutableInputFingerprint',
        'shapingEnvironmentVersion',
      ],
      'resolved cache provenance'
    );
  } catch {
    return false;
  }
  if (
    !Number.isInteger(candidate.revision) ||
    (candidate.revision as number) < 0 ||
    !isValidFingerprint(candidate.dependencyFingerprint) ||
    !isValidFingerprint(candidate.inputFingerprint) ||
    !isValidFingerprint(candidate.immutableInputFingerprint) ||
    !isValidFingerprint(candidate.shapingEnvironmentVersion)
  ) {
    return false;
  }
  const entry = cache.entries.get(paragraphId);
  return (
    entry !== undefined &&
    entry.dependencyFingerprint === candidate.dependencyFingerprint &&
    entry.inputFingerprint === candidate.inputFingerprint &&
    entry.immutableInputFingerprint === candidate.immutableInputFingerprint &&
    entry.shapingEnvironmentVersion === candidate.shapingEnvironmentVersion
  );
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(value);
}

function isValidFingerprint(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  );
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isFinite(value) && Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

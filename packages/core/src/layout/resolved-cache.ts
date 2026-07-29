// Revision-provenance resolved/measurement cache (document-engine 8.3). A resolved layout entry may
// be reused ACROSS revisions — model revision is recorded as PROVENANCE, not an equality condition.
// Reuse is proven only when the transitive dependency fingerprint, the unit's own input fingerprint,
// AND every non-model environment input plus the producer version are unchanged against the immutable
// operation snapshot. Resource epochs trigger dependency-scoped hash comparison, so a font update does
// not evict entries that consumed another unchanged font.

/** Immutable per-operation environment. Configuration, extension, shaping, and producer changes are
 * coarse gates; resource changes are compared through CacheProvenance.resourceDependencies. */
export interface OperationSnapshot {
  readonly resourceEpoch: number;
  readonly configEpoch: number;
  readonly extensionFingerprint: string;
  readonly shapingHash: string;
  readonly producerVersion: number;
}

export interface ResourceDependencyProvenance {
  readonly key: string;
  readonly fingerprint: string;
}

/** Everything recorded with a cache entry: the model revision (provenance only) + the fingerprints
 *  and snapshot that DO gate reuse. */
export interface CacheProvenance extends OperationSnapshot {
  /** Model revision the entry was computed at — provenance, NOT compared for reuse. */
  readonly revision: number;
  /** Fingerprint of the transitive dependency closure (see DependencyGraph.fingerprint). */
  readonly dependencyFingerprint: string;
  /** Fingerprint of the unit's own direct inputs (its content). */
  readonly inputFingerprint: string;
  /** Exact operation resources this entry consumed, sorted by key. */
  readonly resourceDependencies: readonly ResourceDependencyProvenance[];
}

/** Why a lookup missed — for cache-instrumentation assertions. */
export type CacheMiss =
  | { readonly hit: false; readonly reason: 'absent' }
  | { readonly hit: false; readonly reason: 'dependency-changed' }
  | { readonly hit: false; readonly reason: 'input-changed' }
  | {
      readonly hit: false;
      readonly reason: 'resource-changed';
      readonly resourceKey: string;
    }
  | {
      readonly hit: false;
      readonly reason: 'epoch-changed';
      readonly epoch: keyof OperationSnapshot;
    };
export type CacheLookup<V> =
  | { readonly hit: true; readonly value: V; readonly provenance: CacheProvenance }
  | CacheMiss;

export type OperationSnapshotField = keyof OperationSnapshot;
export type OperationSnapshotGuard =
  | { readonly status: 'current' }
  | { readonly status: 'restart'; readonly changed: readonly OperationSnapshotField[] };

const assertNonNegativeEpoch = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
};

const assertFingerprint = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new TypeError(`${name} must not be blank`);
};

/** Capture, validate, and freeze the environment used throughout one derived operation. */
export const captureOperationSnapshot = (source: OperationSnapshot): OperationSnapshot => {
  assertNonNegativeEpoch(source.resourceEpoch, 'resourceEpoch');
  assertNonNegativeEpoch(source.configEpoch, 'configEpoch');
  assertNonNegativeEpoch(source.producerVersion, 'producerVersion');
  assertFingerprint(source.extensionFingerprint, 'extensionFingerprint');
  assertFingerprint(source.shapingHash, 'shapingHash');
  return Object.freeze({
    resourceEpoch: source.resourceEpoch,
    configEpoch: source.configEpoch,
    extensionFingerprint: source.extensionFingerprint,
    shapingHash: source.shapingHash,
    producerVersion: source.producerVersion,
  });
};

export const guardOperationSnapshot = (
  captured: OperationSnapshot,
  current: OperationSnapshot
): OperationSnapshotGuard => {
  const expected = captureOperationSnapshot(captured);
  const actual = captureOperationSnapshot(current);
  const fields: readonly OperationSnapshotField[] = [
    'resourceEpoch',
    'configEpoch',
    'extensionFingerprint',
    'shapingHash',
    'producerVersion',
  ];
  const changed = fields.filter((field) => expected[field] !== actual[field]);
  return changed.length === 0
    ? Object.freeze({ status: 'current' })
    : Object.freeze({ status: 'restart', changed: Object.freeze(changed) });
};

const copyResourceDependencies = (
  dependencies: readonly ResourceDependencyProvenance[]
): readonly ResourceDependencyProvenance[] => {
  const copied = dependencies
    .map(({ key, fingerprint }) => {
      assertFingerprint(key, 'resource dependency key');
      assertFingerprint(fingerprint, 'resource dependency fingerprint');
      return Object.freeze({ key, fingerprint });
    })
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  for (let index = 1; index < copied.length; index += 1) {
    if (copied[index - 1]!.key === copied[index]!.key) {
      throw new TypeError(`Duplicate resource dependency: ${copied[index]!.key}`);
    }
  }
  return Object.freeze(copied);
};

const copyProvenance = (provenance: CacheProvenance): CacheProvenance => {
  assertNonNegativeEpoch(provenance.revision, 'revision');
  assertFingerprint(provenance.dependencyFingerprint, 'dependencyFingerprint');
  assertFingerprint(provenance.inputFingerprint, 'inputFingerprint');
  return Object.freeze({
    revision: provenance.revision,
    dependencyFingerprint: provenance.dependencyFingerprint,
    inputFingerprint: provenance.inputFingerprint,
    resourceDependencies: copyResourceDependencies(provenance.resourceDependencies),
    ...captureOperationSnapshot(provenance),
  });
};

const resourceMismatch = (
  left: readonly ResourceDependencyProvenance[],
  right: readonly ResourceDependencyProvenance[]
): CacheMiss | null => {
  const stored = copyResourceDependencies(left);
  const wanted = copyResourceDependencies(right);
  const count = Math.max(stored.length, wanted.length);
  for (let index = 0; index < count; index += 1) {
    const a = stored[index];
    const b = wanted[index];
    if (a?.key !== b?.key || a?.fingerprint !== b?.fingerprint) {
      return {
        hit: false,
        reason: 'resource-changed',
        resourceKey: a?.key ?? b!.key,
      };
    }
  }
  return null;
};

/** The reuse gate: everything EXCEPT model revision must match. Returns the first mismatch (so a
 *  consumer can assert exactly why an entry was NOT reused), or null when the entry is reusable. */
function firstMismatch(a: CacheProvenance, b: Omit<CacheProvenance, 'revision'>): CacheMiss | null {
  if (a.dependencyFingerprint !== b.dependencyFingerprint)
    return { hit: false, reason: 'dependency-changed' };
  if (a.inputFingerprint !== b.inputFingerprint) return { hit: false, reason: 'input-changed' };
  const resources = resourceMismatch(a.resourceDependencies, b.resourceDependencies);
  if (resources) return resources;
  const epochs: (keyof OperationSnapshot)[] = [
    'configEpoch',
    'extensionFingerprint',
    'shapingHash',
    'producerVersion',
  ];
  for (const e of epochs)
    if (a[e] !== b[e]) return { hit: false, reason: 'epoch-changed', epoch: e };
  return null;
}

export class ResolvedCache<V> {
  private readonly entries = new Map<string, { value: V; provenance: CacheProvenance }>();

  /** Look up `key` against the CURRENT fingerprints + snapshot (revision excluded from the match).
   *  A hit proves the entry is unaffected; a miss names the reason (absent/dependency/input/epoch). */
  get(key: string, want: Omit<CacheProvenance, 'revision'>): CacheLookup<V> {
    const entry = this.entries.get(key);
    if (!entry) return { hit: false, reason: 'absent' };
    const mismatch = firstMismatch(entry.provenance, want);
    if (mismatch) return mismatch;
    return { hit: true, value: entry.value, provenance: entry.provenance };
  }

  /** Store a freshly computed entry with full provenance. */
  set(key: string, value: V, provenance: CacheProvenance): void {
    this.entries.set(key, { value, provenance: copyProvenance(provenance) });
  }

  /** Drop entries produced against a stale operation epoch — restart affected work on an epoch
   *  change (8.3). Returns the number evicted. */
  evictEpoch(current: OperationSnapshot): number {
    const operation = captureOperationSnapshot(current);
    let evicted = 0;
    for (const [key, entry] of this.entries) {
      const p = entry.provenance;
      if (
        p.configEpoch !== operation.configEpoch ||
        p.extensionFingerprint !== operation.extensionFingerprint ||
        p.shapingHash !== operation.shapingHash ||
        p.producerVersion !== operation.producerVersion
      ) {
        this.entries.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  /** Evict only entries whose consumed resource fingerprint changed at the new resource epoch. */
  evictResources(
    current: OperationSnapshot,
    resourceFingerprints: ReadonlyMap<string, string>
  ): number {
    const operation = captureOperationSnapshot(current);
    let evicted = this.evictEpoch(operation);
    for (const [key, entry] of this.entries) {
      const stale = entry.provenance.resourceDependencies.some(
        (dependency) => resourceFingerprints.get(dependency.key) !== dependency.fingerprint
      );
      if (stale) {
        this.entries.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  get size(): number {
    return this.entries.size;
  }
}

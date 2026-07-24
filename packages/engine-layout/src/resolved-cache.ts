// Revision-provenance resolved/measurement cache (document-engine 8.3). A resolved layout entry may
// be reused ACROSS revisions — model revision is recorded as PROVENANCE, not an equality condition.
// Reuse is proven only when the transitive dependency fingerprint, the unit's own input fingerprint,
// AND every non-model epoch (resource / configuration / extension-set / shaping-environment) plus the
// producer version are unchanged against the immutable operation snapshot. Any relevant epoch change
// invalidates without a model edit (e.g. a font resource epoch bump). This is the mechanism a cache
// consumer instruments so it NEVER reuses an entry whose dependency changed (8.2 verification).

/** The immutable, per-operation environment an entry was produced against — the non-model epochs.
 *  These are COARSE, environment-WIDE gates: they change only when the whole resource port /
 *  configuration / extension set / shaping environment / producer changes, invalidating every entry
 *  (correct, if occasionally conservative). PER-RESOURCE precision — font A updated while a font-B
 *  entry stays valid — is NOT this epoch's job; it is carried by the dependency fingerprint, which
 *  includes the specific font/image/style KEYS an entry read (see DependencyGraph). So model fonts
 *  and images as dependency keys, and reserve `resourceEpoch` for a genuine environment-wide swap. */
export interface OperationSnapshot {
  readonly resourceEpoch: number;
  readonly configEpoch: number;
  readonly extensionFingerprint: string;
  readonly shapingHash: string;
  readonly producerVersion: number;
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
}

/** Why a lookup missed — for cache-instrumentation assertions. */
export type CacheMiss =
  | { readonly hit: false; readonly reason: 'absent' }
  | { readonly hit: false; readonly reason: 'dependency-changed' }
  | { readonly hit: false; readonly reason: 'input-changed' }
  | { readonly hit: false; readonly reason: 'epoch-changed'; readonly epoch: keyof OperationSnapshot };
export type CacheLookup<V> = { readonly hit: true; readonly value: V; readonly provenance: CacheProvenance } | CacheMiss;

/** The reuse gate: everything EXCEPT model revision must match. Returns the first mismatch (so a
 *  consumer can assert exactly why an entry was NOT reused), or null when the entry is reusable. */
function firstMismatch(a: CacheProvenance, b: Omit<CacheProvenance, 'revision'>): CacheMiss | null {
  if (a.dependencyFingerprint !== b.dependencyFingerprint) return { hit: false, reason: 'dependency-changed' };
  if (a.inputFingerprint !== b.inputFingerprint) return { hit: false, reason: 'input-changed' };
  const epochs: (keyof OperationSnapshot)[] = ['resourceEpoch', 'configEpoch', 'extensionFingerprint', 'shapingHash', 'producerVersion'];
  for (const e of epochs) if (a[e] !== b[e]) return { hit: false, reason: 'epoch-changed', epoch: e };
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
    this.entries.set(key, { value, provenance });
  }

  /** Drop entries produced against a stale operation epoch — restart affected work on an epoch
   *  change (8.3). Returns the number evicted. */
  evictEpoch(current: OperationSnapshot): number {
    let evicted = 0;
    for (const [key, entry] of this.entries) {
      const p = entry.provenance;
      if (
        p.resourceEpoch !== current.resourceEpoch ||
        p.configEpoch !== current.configEpoch ||
        p.extensionFingerprint !== current.extensionFingerprint ||
        p.shapingHash !== current.shapingHash ||
        p.producerVersion !== current.producerVersion
      ) {
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

// Layout resolution-dependency graph (document-engine 8.2). Before any cache consumer reuses a
// resolved/measurement entry, it must know EVERY authored key that entry depends on — so a change to
// any of them invalidates it. This models that closure: a resolution unit (a block, a line, a page)
// declares the keys it reads (style/numbering/section/story/font/image/table/field/note/annotation),
// edges chain (a style inherits another style; a paragraph reads its style), and `closure()` expands
// transitively. `fingerprint()` over the closure's current values is what a cache compares — reuse is
// proven by an UNCHANGED fingerprint, never by revision equality (see ResolvedCache).

/** The kinds of authored input a layout unit can depend on. */
export type DependencyKind =
  | 'style'
  | 'numbering'
  | 'section'
  | 'story'
  | 'font'
  | 'image'
  | 'table'
  | 'field'
  | 'note'
  | 'annotation';

/** A single dependency: a kind + the authored id within that kind. */
export interface DependencyKey {
  readonly kind: DependencyKind;
  readonly id: string;
}

/** Stable string form of a key (the map/edge identity). */
export const keyId = (k: DependencyKey): string => `${k.kind}:${k.id}`;

export class DependencyGraph {
  // unit/key id -> the keys it directly depends on.
  private readonly edges = new Map<string, Set<string>>();
  // id -> the key it denotes (for closure results); units have no DependencyKey of their own.
  private readonly keys = new Map<string, DependencyKey>();

  /** Declare that `unit` (a unit id or a key id) directly depends on `dep`. Idempotent. */
  addDependency(unit: string, dep: DependencyKey): void {
    const id = keyId(dep);
    this.keys.set(id, dep);
    let set = this.edges.get(unit);
    if (!set) {
      set = new Set();
      this.edges.set(unit, set);
    }
    set.add(id);
  }

  /** The transitive dependency closure of `unit` as DependencyKeys (deterministic order). A cycle in
   *  the declared edges terminates safely (each id is visited once). */
  closure(unit: string): DependencyKey[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const stack = [unit];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const dep of this.edges.get(cur) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        out.push(dep);
        stack.push(dep); // a key may itself depend on others (style inheritance)
      }
    }
    out.sort(); // deterministic, order-independent of insertion/traversal
    return out.map((id) => this.keys.get(id)!);
  }

  /** A fingerprint of `unit`'s dependency closure against `values` (each key's current value hash).
   *  A missing value (null) is distinct from any present value, so appearing/disappearing
   *  dependencies change the fingerprint. JSON-encoded so no key id or value can forge a boundary
   *  (a raw delimiter-joined string could let a crafted value collide with a different closure);
   *  fingerprints are equal IFF the sorted (id, value) pairs are equal. */
  fingerprint(unit: string, values: ReadonlyMap<string, string>): string {
    const pairs = this.closure(unit).map((k): [string, string | null] => {
      const id = keyId(k);
      return [id, values.get(id) ?? null];
    });
    return JSON.stringify(pairs);
  }
}

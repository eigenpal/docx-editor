// A WeakMap memo for values derived per part ROOT, bounded to the most recent roots.
//
// Why not a plain WeakMap: the undo history retains up to 200 package snapshots by
// reference, and every root it keeps alive would keep its O(document) derived map alive
// with it — an accept/reject-heavy session on a long document would hold hundreds of full
// site indexes that were transient before memoization. The ring holds WeakRefs, so it
// never extends a root's lifetime; it only decides how many still-living roots keep their
// derived value. An evicted root that comes back (an undo past the window) simply
// recomputes.

interface RecentRootCache<V> {
  get(root: object): V | undefined;
  set(root: object, value: V): void;
}

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here rather than raising every package's lib: every supported runtime (Node
 * 14.6+, all evergreen browsers) ships it.
 */
interface RootWeakRef {
  deref(): object | undefined;
}
declare const WeakRef: new (target: object) => RootWeakRef;

export function createRecentRootCache<V>(limit: number): RecentRootCache<V> {
  const values = new WeakMap<object, V>();
  const recent: RootWeakRef[] = [];
  return {
    get: (root) => values.get(root),
    set(root, value) {
      if (!values.has(root)) {
        recent.push(new WeakRef(root));
        while (recent.length > limit) {
          const evicted = recent.shift()!.deref();
          // Evict only when no fresher ring slot names the same root — a root re-cached
          // after eviction sits in the ring twice, and deleting on the stale slot would
          // drop a live entry.
          if (evicted && !recent.some((ref) => ref.deref() === evicted)) {
            values.delete(evicted);
          }
        }
      }
      values.set(root, value);
    },
  };
}

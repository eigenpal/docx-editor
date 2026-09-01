// Runtime immutability boundary for semantic records handed to exporter consumers.

import type { SemanticLayout } from '../layout/semantic-records.ts';

/**
 * Fields that deliberately retain an engine-external capability/reference.
 *
 * `part` is the canonical store tree used as provenance by header/footer records. A validated
 * image handle is identity-checked by its owning resource bundle before bytes can be minted.
 * Neither object belongs to the published semantic record graph, so publication must preserve
 * its identity and must never freeze it on a caller's behalf.
 */
const OPAQUE_PUBLICATION_FIELDS = new Set<PropertyKey>(['part', 'validatedHandle']);

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezePublishedValue(
  value: unknown,
  visited: WeakSet<object>,
  activePath: WeakSet<object>,
  ownerKey?: PropertyKey,
  trustedRoots?: ReadonlySet<object>
): void {
  if (ownerKey !== undefined && OPAQUE_PUBLICATION_FIELDS.has(ownerKey)) return;
  if (typeof value === 'function') {
    throw new TypeError('Semantic layout publication encountered a function value');
  }
  if (value === null || typeof value !== 'object') return;
  if (trustedRoots?.has(value)) return;
  if (activePath.has(value)) {
    throw new TypeError('Semantic layout publication encountered a cyclic record graph');
  }
  if (visited.has(value)) return;
  visited.add(value);
  activePath.add(value);

  try {
    if (Array.isArray(value)) {
      for (const item of value)
        freezePublishedValue(item, visited, activePath, undefined, trustedRoots);
      Object.freeze(value);
      return;
    }

    // Semantic records are plain data. Fail closed if that contract evolves: silently exposing a
    // mutable Map, typed array, class, or accessor would reopen cross-exporter cache poisoning.
    if (!isPlainRecord(value)) {
      throw new TypeError('Semantic layout publication encountered a non-record value');
    }

    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (!('value' in descriptor)) {
        throw new TypeError('Semantic layout publication encountered an accessor property');
      }
      freezePublishedValue(descriptor.value, visited, activePath, key, trustedRoots);
    }
    Object.freeze(value);
  } finally {
    activePath.delete(value);
  }
}

/**
 * Publish an exporter-facing, recursively immutable semantic record graph.
 *
 * Layout records are engine-owned immutable values once a pass settles, so sealing that graph in
 * place retains incremental side-table identities without doubling peak memory for large exports.
 * Consumers can therefore share it without one Markdown, PDF, or future exporter poisoning the
 * next. Canonical parts and validated-byte capabilities remain explicitly external and retain
 * their identity without being frozen on the store or resource registry's behalf.
 * @internal
 */
export function publishImmutableSemanticLayout<T extends SemanticLayout>(layout: T): T {
  if (!isPlainRecord(layout)) {
    throw new TypeError('Semantic layout publication encountered a non-record value');
  }
  // Only roots are retained here, never the furniture descendants. Layout already owns the
  // roots, and this small set avoids a graph-sized ephemeron table under constrained heaps.
  const trustedFurnitureRoots = new Set<object>();
  for (const page of layout.pages) {
    if (page === null || typeof page !== 'object') continue;
    for (const key of ['header', 'footer'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(page, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const root = descriptor.value;
      if (root === null || typeof root !== 'object') continue;
      if (trustedFurnitureRoots.has(root)) continue;
      const activePath = new WeakSet<object>();
      activePath.add(layout);
      freezePublishedValue(root, new WeakSet(), activePath, key);
      trustedFurnitureRoots.add(root);
    }
  }
  const freezeArrayInBatches = (
    values: readonly unknown[],
    batchSize: number,
    trustedRoots?: ReadonlySet<object>
  ): void => {
    for (let offset = 0; offset < values.length; offset += batchSize) {
      const visited = new WeakSet<object>();
      for (let index = offset; index < Math.min(values.length, offset + batchSize); index += 1) {
        const activePath = new WeakSet<object>();
        activePath.add(layout);
        freezePublishedValue(values[index], visited, activePath, undefined, trustedRoots);
      }
    }
    Object.freeze(values);
  };
  // Pages dominate large layouts. Per-batch membership bounds weak-table metadata, while the
  // furniture-only memo prevents shared headers and footers from being re-walked each batch.
  // Review metadata is bounded independently for adversarial files with many comments/changes.
  // Already-frozen records are still traversed: shallow freezing does not prove descendants are.
  for (const key of Reflect.ownKeys(layout)) {
    const descriptor = Object.getOwnPropertyDescriptor(layout, key);
    if (!descriptor) continue;
    if (!('value' in descriptor)) {
      throw new TypeError('Semantic layout publication encountered an accessor property');
    }
    if (key === 'pages' && Array.isArray(descriptor.value)) {
      freezeArrayInBatches(descriptor.value, 1, trustedFurnitureRoots);
      continue;
    }
    if (key === 'reviewArtifacts' && Array.isArray(descriptor.value)) {
      freezeArrayInBatches(descriptor.value, 8);
      continue;
    }
    const activePath = new WeakSet<object>();
    activePath.add(layout);
    freezePublishedValue(descriptor.value, new WeakSet(), activePath, key);
  }
  Object.freeze(layout);
  return layout;
}

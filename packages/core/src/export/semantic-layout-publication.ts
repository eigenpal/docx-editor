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
  ownerKey?: PropertyKey
): void {
  if (value === null || typeof value !== 'object') return;
  if (ownerKey !== undefined && OPAQUE_PUBLICATION_FIELDS.has(ownerKey)) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) freezePublishedValue(item, visited);
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
    freezePublishedValue(descriptor.value, visited, key);
  }
  Object.freeze(value);
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
export function publishImmutableSemanticLayout(layout: SemanticLayout): SemanticLayout {
  freezePublishedValue(layout, new WeakSet());
  return layout;
}

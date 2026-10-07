import type { OoxmlAttribute, OoxmlNamespaceBinding, OoxmlNode } from './ooxml-tree.ts';

const EMPTY_ATTRIBUTES: readonly OoxmlAttribute[] = Object.freeze([]);
export const EMPTY_NAMESPACE_BINDINGS: readonly OoxmlNamespaceBinding[] = Object.freeze([]);
export const EMPTY_NODE_CHILDREN: readonly OoxmlNode[] = Object.freeze([]);

const MAX_ENTRIES = 2_048;
const MAX_KEY_BYTES = 1024 * 1024;

/** Shares immutable metadata within one part read, without retaining document nodes. */
export class OoxmlReadMetadata {
  private readonly attributes = new Map<string, readonly OoxmlAttribute[]>();
  private keyBytes = 0;

  shareAttributes(attributes: readonly OoxmlAttribute[]): readonly OoxmlAttribute[] {
    if (attributes.length === 0) return EMPTY_ATTRIBUTES;
    // JSON framing preserves value, prefix, kind, and attribute order without delimiter aliases.
    const key = JSON.stringify(attributes);
    const cached = this.attributes.get(key);
    if (cached) {
      this.attributes.delete(key);
      this.attributes.set(key, cached);
      return cached;
    }
    const bytes = key.length * 2;
    if (bytes > MAX_KEY_BYTES) return attributes;
    for (const attribute of attributes) Object.freeze(attribute);
    Object.freeze(attributes);
    this.attributes.set(key, attributes);
    this.keyBytes += bytes;
    for (const [oldest] of this.attributes) {
      if (this.attributes.size <= MAX_ENTRIES && this.keyBytes <= MAX_KEY_BYTES) break;
      this.attributes.delete(oldest);
      this.keyBytes -= oldest.length * 2;
    }
    return attributes;
  }
}

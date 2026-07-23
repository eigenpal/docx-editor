// XML serialization name-safety (document-engine task 3.5 / lossless-package-model
// "XML serialization separates names from values"). Serializer-generated element
// and attribute NAMES must be validated QNames with controlled namespace prefixes;
// they are never escaped as values. Attribute/text VALUES are XML-escaped
// (escapeXml, sinks.ts) and URIs validated. This is the injection boundary on save.

// NCName: a name with no ':' — starts with a letter/_ then name chars.
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

export function isValidNCName(name: string): boolean {
  return NCNAME.test(name);
}

/** A QName is an optional `prefix:` (both NCNames) — never attacker-derived. */
export function isValidQName(name: string): boolean {
  const parts = name.split(':');
  if (parts.length === 1) return isValidNCName(parts[0]);
  if (parts.length === 2) return isValidNCName(parts[0]) && isValidNCName(parts[1]);
  return false;
}

export function assertValidQName(name: string): void {
  if (!isValidQName(name)) throw new Error(`invalid QName for serialization: ${JSON.stringify(name)}`);
}

/**
 * Controlled namespace-prefix allocation: deterministic, collision-free prefixes
 * for namespace URIs. A known URI always yields the same registered prefix; new
 * URIs get a generated `ns{n}` prefix, never one derived from file content.
 */
export class PrefixAllocator {
  private readonly byUri = new Map<string, string>();
  private readonly usedPrefixes = new Set<string>();
  private counter = 0;

  constructor(known: Readonly<Record<string, string>> = {}) {
    for (const [uri, prefix] of Object.entries(known)) {
      this.byUri.set(uri, prefix);
      this.usedPrefixes.add(prefix);
    }
  }

  prefixFor(namespaceUri: string): string {
    const existing = this.byUri.get(namespaceUri);
    if (existing) return existing;
    let prefix: string;
    do {
      this.counter += 1;
      prefix = `ns${this.counter}`;
    } while (this.usedPrefixes.has(prefix));
    this.byUri.set(namespaceUri, prefix);
    this.usedPrefixes.add(prefix);
    return prefix;
  }

  /** The declared bindings, for emitting xmlns declarations. */
  bindings(): { prefix: string; uri: string }[] {
    return [...this.byUri.entries()].map(([uri, prefix]) => ({ prefix, uri }));
  }
}

// A URI that is safe to write into a validated href/target (allowlist-ish; the
// runtime-sink allowlist is stricter, in sinks.ts). Rejects control chars.
const SAFE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$|^[^\s:]+(\/[^\s]*)?$/;

export function isValidUri(uri: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(uri)) return false;
  return uri.length > 0 && SAFE_URI.test(uri);
}

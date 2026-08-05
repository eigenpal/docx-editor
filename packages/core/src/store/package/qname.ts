// XML serialization name-safety (document-engine task 3.5 / lossless-package-model
// "XML serialization separates names from values"). Serializer-generated element
// and attribute NAMES must be validated QNames with controlled namespace prefixes;
// they are never escaped as values. Attribute/text VALUES are XML-escaped
// (escapeXml, sinks.ts) and URIs validated. This is the injection boundary on save.

// NCName: a name with no ':' — starts with a letter/_ then name chars.
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

/** Whether a string is a valid XML NCName — a name with no colon. */
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

/**
 * Validate a qualified name, throwing when it is malformed.
 *
 * Guards the serializer: an invalid QName written into XML produces a file Word cannot open, so
 * it fails here rather than at save.
 */
export function assertValidQName(name: string): void {
  if (!isValidQName(name))
    throw new Error(`invalid QName for serialization: ${JSON.stringify(name)}`);
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

// NOTE: there is deliberately no generic URI "validator" here. Raw external
// targets are preserved verbatim in the authored record (lossless-package-model);
// safety is applied at the RUNTIME sink via the allowlist in sinks.ts
// (sanitizeHref), not by a pass/fail URI check that would give false confidence.

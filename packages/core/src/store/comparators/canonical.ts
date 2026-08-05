// Canonical serialization + stable fingerprinting for artifact comparators
// (document-engine task 0.4). Canonicalization sorts object keys, preserves
// array order (significant), and drops declared ephemera so equivalent artifacts
// hash identically across runtimes. The fingerprint is a pure-JS 64-bit FNV-1a
// (no crypto/DOM dependency) — a convenience over the canonical bytes, never a
// substitute for the byte comparison itself.

/** Any JSON value. The domain canonicalization and stable hashing operate over. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Produce a canonical string for `value`, dropping any object key whose name is
 * in `ephemera` at any depth. Numbers are emitted losslessly; -0 normalizes to 0;
 * non-finite numbers are rejected (they must never enter a comparator input).
 */
export function canonicalize(value: unknown, ephemera: ReadonlySet<string> = new Set()): string {
  const seen = new WeakSet<object>();
  const enc = (v: unknown): string => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') {
      const n = v as number;
      if (!Number.isFinite(n)) throw new Error(`non-finite number is not comparable: ${n}`);
      return Object.is(n, -0) ? '0' : String(n);
    }
    if (t === 'string') return JSON.stringify(v);
    if (t === 'bigint') return `${(v as bigint).toString()}n`;
    if (Array.isArray(v)) return `[${v.map(enc).join(',')}]`;
    if (t === 'object') {
      const obj = v as Record<string, unknown>;
      if (seen.has(obj)) throw new Error('cannot canonicalize a cyclic structure');
      seen.add(obj);
      const keys = Object.keys(obj)
        .filter((k) => !ephemera.has(k))
        .sort();
      const body = keys.map((k) => `${JSON.stringify(k)}:${enc(obj[k])}`).join(',');
      seen.delete(obj);
      return `{${body}}`;
    }
    throw new Error(`unsupported value type in comparator input: ${t}`);
  };
  return enc(value);
}

/** 64-bit FNV-1a over the canonical form, returned as a 16-char hex string. */
export function stableHash(value: unknown, ephemera?: ReadonlySet<string>): string {
  const s = canonicalize(value, ephemera);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

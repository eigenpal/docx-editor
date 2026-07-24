// Package-level fidelity comparators (document-engine task 3.6). Two comparators verify the
// selective-patch invariant that the writer commits to (see docx/write.ts + wml-preserve.ts):
//
//   1. exact uncompressed XML-part range comparator — proves a byte-range patch of ONE XML part
//      touched ONLY its declared owned ranges and preserved every unowned byte verbatim.
//   2. semantic ZIP-container comparator — proves two archives carry the same parts with equal
//      UNCOMPRESSED bytes, permitting recompression ephemera (compression method / CRC / entry
//      size / local-header offset / central-directory order), and flags any UNOWNED part whose
//      bytes changed.
//
// Both operate on canonical uncompressed bytes, never on the raw ZIP structure, so recompression
// ephemera are excluded by construction (they live in the archive framing, not the entries map).

import { readZip, DEFAULT_ZIP_LIMITS, type ZipLimits } from './zip.ts';
import { partNameKey } from './opc-names.ts';

/** An owned (patched) byte range within the BEFORE part, with the bytes it was replaced by. */
export interface OwnedRange {
  /** Inclusive start offset into the before-part's uncompressed bytes. */
  readonly start: number;
  /** Exclusive end offset into the before-part's uncompressed bytes. */
  readonly end: number;
  /** The replacement bytes emitted for this range (may differ in length from end-start). */
  readonly replacement: Uint8Array;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Reconstruct the EXPECTED patched part from the before-part and its owned ranges: the exact
 * concatenation of each verbatim gap (unowned bytes, preserved untouched) and each owned range's
 * replacement. Ranges MUST be ordered, non-overlapping, and in-bounds — anything else throws
 * (fail-closed: an ill-formed owned set is a patch bug, not a silent pass). This is the canonical
 * definition of "selective patch": unowned bytes come verbatim from before, owned ranges are the
 * only edits.
 */
export function reassembleXmlPartRanges(before: Uint8Array, owned: readonly OwnedRange[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const r of owned) {
    // Non-integer offsets would be silently truncated by subarray() and mis-patch a neighbouring
    // byte, so a fractional/NaN/unsafe range fails closed rather than replacing the wrong region.
    if (!Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end)) {
      throw new Error(`owned range [${r.start},${r.end}) has a non-integer offset`);
    }
    if (!(r.start >= cursor && r.end >= r.start && r.end <= before.length)) {
      throw new Error(`owned range [${r.start},${r.end}) is out of order, overlapping, or out of bounds (cursor ${cursor}, len ${before.length})`);
    }
    chunks.push(before.subarray(cursor, r.start)); // verbatim unowned gap
    chunks.push(r.replacement); // the only edited bytes
    cursor = r.end;
  }
  chunks.push(before.subarray(cursor)); // verbatim tail
  return concatBytes(chunks);
}

export interface XmlPartRangeResult {
  /** True when `after` is exactly the selective patch of `before` over the owned ranges. */
  readonly equal: boolean;
  /** When unequal: the reassembled expectation (diagnostic). */
  readonly expected?: Uint8Array;
}

/**
 * Exact uncompressed XML-part range comparator. Verifies `after` is byte-for-byte the selective
 * patch of `before` over exactly `owned` — i.e. every UNOWNED byte survived verbatim and only the
 * declared ranges changed. No tolerance: XML-part bytes compare exactly.
 */
export function compareXmlPartRanges(before: Uint8Array, after: Uint8Array, owned: readonly OwnedRange[]): XmlPartRangeResult {
  const expected = reassembleXmlPartRanges(before, owned);
  return bytesEqual(expected, after) ? { equal: true } : { equal: false, expected };
}

export interface ZipContainerResult {
  readonly equal: boolean;
  /** Parts present in both whose uncompressed bytes differ. */
  readonly changed: string[];
  /** Parts only in `after`. */
  readonly added: string[];
  /** Parts only in `before`. */
  readonly removed: string[];
  /**
   * Parts that changed/added/removed but were NOT declared owned — a violation of "preserve every
   * unowned XML byte". Empty on a well-formed selective export.
   */
  readonly unownedChanged: string[];
  /** Set when either archive could not be read (bounded-read rejection). */
  readonly readError?: string;
}

/**
 * Semantic ZIP-container comparator. Reads both archives through the bounded reader (so a zip bomb
 * or a traversal name is rejected, not compared) and compares the canonical part-name -> UNCOMPRESSED
 * bytes maps. Recompression ephemera (compression method, CRC, stored sizes, local-header offsets,
 * central-directory ordering) are excluded by construction — they are archive framing, absent from
 * the entries map. `opts.owned` lists the parts a legitimate export may change/add/remove; any other
 * divergence lands in `unownedChanged`. `equal` means the SAME parts carry the SAME uncompressed
 * bytes (modulo owned parts).
 */
export function compareZipContainers(
  before: Uint8Array,
  after: Uint8Array,
  opts: { owned?: Iterable<string>; limits?: ZipLimits } = {},
): ZipContainerResult {
  const empty: string[] = [];
  // Read under the SAFE default bounds (entry-count, total-inflated-size, AND the pre-inflation
  // ratio guard) so an untrusted archive cannot be a memory-amplification/zip-bomb vector. The
  // ratio cap does mean two archives whose parts legitimately deflate past DEFAULT ratio (rare for
  // real DOCX XML) could return `readError` instead of comparing equal — a trusted caller who
  // KNOWS its inputs are safe (e.g. its own save() output) opts into a relaxed `maxRatio` via
  // `opts.limits`. Compression method still never affects equality for any archive both readers
  // admit, since the entries map holds only uncompressed bytes.
  const limits: ZipLimits = opts.limits ?? DEFAULT_ZIP_LIMITS;
  const a = readZip(before, limits);
  const b = readZip(after, limits);
  if (!a.ok) return { equal: false, changed: empty, added: empty, removed: empty, unownedChanged: empty, readError: `before: ${a.reason}` };
  if (!b.ok) return { equal: false, changed: empty, added: empty, removed: empty, unownedChanged: empty, readError: `after: ${b.reason}` };

  // OPC part names are ASCII-case-insensitive: `/Word/Document.xml` and `/word/document.xml` are the
  // SAME part. Compare on the case-folded key so a mere case difference is not a false add/remove,
  // and fold `owned` the same way. (readZip already rejects OPC-equivalent duplicates within one
  // archive, so each folded key maps to one part per side.)
  const byKey = (entries: ReadonlyMap<string, Uint8Array>) => {
    const m = new Map<string, { name: string; bytes: Uint8Array }>();
    for (const [name, bytes] of entries) m.set(partNameKey(name), { name, bytes });
    return m;
  };
  const aByKey = byKey(a.entries);
  const bByKey = byKey(b.entries);
  const owned = new Set([...(opts.owned ?? [])].map(partNameKey));

  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [key, av] of aByKey) {
    const bv = bByKey.get(key);
    if (bv === undefined) removed.push(av.name);
    else if (!bytesEqual(av.bytes, bv.bytes)) changed.push(av.name);
  }
  for (const [key, bv] of bByKey) if (!aByKey.has(key)) added.push(bv.name);

  const unownedChanged = [...changed, ...added, ...removed].filter((n) => !owned.has(partNameKey(n))).sort();
  return { equal: unownedChanged.length === 0, changed, added, removed, unownedChanged };
}

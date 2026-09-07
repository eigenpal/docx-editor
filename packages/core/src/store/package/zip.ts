// Bounded ZIP read/write over fflate (document-engine task 2.3 / design D14).
// Reading enforces entry-count and total-decompressed-size ceilings (zip-bomb
// guard) and normalizes every entry name through the OPC profile (path-traversal
// guard) BEFORE the bytes are handed on. Writing produces a deterministic archive.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { normalizePartName, partNameKey } from './opc-names.ts';

/**
 * Why a zip was refused at the trust boundary.
 *
 * `too-large` and `too-many-entries` are the zip-bomb guards; `bad-name` catches path traversal —
 * an entry with `..` or a leading `/` is rejected rather than normalized.
 */
export type ZipRejection = 'too-many-entries' | 'too-large' | 'bad-name' | 'inflate-error';

/** Archive caps: entry count, total decompressed bytes, and the decompression ratio. */
export interface ZipLimits {
  readonly maxEntries: number;
  /** Max total UNCOMPRESSED bytes across the archive. */
  readonly maxTotalBytes: number;
  /** Max per-entry uncompressed:compressed ratio (zip-bomb guard). */
  readonly maxRatio?: number;
}

/** The archive caps in force when a host configures none. Conservative and finite. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRatio: 200,
};

/** The read entries, or the typed refusal. Never throws — the bytes are untrusted. */
export type ZipReadResult =
  | { readonly ok: true; readonly entries: ReadonlyMap<string, Uint8Array> }
  | {
      readonly ok: false;
      readonly reason: ZipRejection;
      readonly detail?: string;
      readonly limit?: 'zip.maxTotalBytes' | 'zip.maxRatio';
    };

class ZipViolation extends Error {
  constructor(
    readonly reason: ZipRejection,
    readonly limit?: 'zip.maxTotalBytes' | 'zip.maxRatio'
  ) {
    super(reason);
  }
}

/**
 * Inflate a ZIP archive with bounds + OPC name normalization. Entry name, count,
 * compression-ratio, and total-uncompressed-size limits are enforced BEFORE each
 * entry is decompressed (via fflate's pre-inflation filter), so a zip bomb or a
 * traversal name is rejected without ever being inflated. Keys are canonical part
 * names.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReadResult {
  const maxRatio = limits.maxRatio ?? 200;
  let entryCount = 0;
  let totalUncompressed = 0;
  let badDetail: string | undefined;
  const seenNorms = new Set<string>();

  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      // `size` = compressed, `originalSize` = uncompressed. This runs BEFORE inflation.
      filter: (file) => {
        if (file.name.endsWith('/')) return false; // directory entry — never inflated
        entryCount += 1;
        if (entryCount > limits.maxEntries) throw new ZipViolation('too-many-entries');
        const norm = normalizePartName(file.name);
        if (!norm.ok) {
          badDetail = `${file.name}: ${norm.reason}`;
          throw new ZipViolation('bad-name');
        }
        // Reject two entries whose names are OPC-equivalent (normalized AND case-folded,
        // e.g. `word/document.xml` vs `word/%64ocument.xml` vs `Word/Document.xml`) —
        // last-wins would smuggle/omit a part. Checked BEFORE inflation.
        const key = partNameKey(norm.partName);
        if (seenNorms.has(key)) {
          badDetail = `${file.name}: OPC-equivalent duplicate of ${norm.partName}`;
          throw new ZipViolation('bad-name');
        }
        seenNorms.add(key);
        // Compression-ratio zip-bomb guard, checked before decompressing.
        if (file.originalSize / Math.max(1, file.size) > maxRatio)
          throw new ZipViolation('too-large', 'zip.maxRatio');
        totalUncompressed += file.originalSize;
        if (totalUncompressed > limits.maxTotalBytes)
          throw new ZipViolation('too-large', 'zip.maxTotalBytes');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ZipViolation)
      return {
        ok: false,
        reason: e.reason,
        detail: badDetail,
        ...(e.limit === undefined ? {} : { limit: e.limit }),
      };
    return { ok: false, reason: 'inflate-error' };
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const norm = normalizePartName(name);
    if (norm.ok) entries.set(norm.partName, data);
  }
  return { ok: true, entries };
}

/** The modification time stamped on every entry written.
 *
 *  Without one, fflate stamps `Date.now()`, which makes the same document save to
 *  different bytes depending on when it was saved: a ZIP entry carries its time in the DOS
 *  format, whose resolution is two seconds, so two saves that land either side of a tick
 *  differ in that field and nowhere else. Save/reopen/save then stops being a fixed point,
 *  and any digest a caller takes over saved bytes stops being stable.
 *
 *  Mid-day on 1980-01-02 rather than the DOS epoch itself: fflate derives the year through
 *  the local-time `getFullYear`, so midnight on 1980-01-01 UTC lands in 1979 west of
 *  Greenwich and the year field underflows. */
const FIXED_ENTRY_MTIME = new Date(Date.UTC(1980, 0, 2, 12));

/** Deflate a set of canonical-part-name -> bytes into a ZIP archive. Every part name
 *  is re-validated through the OPC normalization profile before writing, so a
 *  traversal/encoded/normalized-alias name from an untrusted serialized model can
 *  never be smuggled into a ZIP entry (write-side path-traversal guard). */
export function writeZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  // Null-prototype: a part legitimately named `__proto__` (or `constructor`) must become a
  // normal own entry, not invoke a prototype setter that would silently drop it.
  const record: Record<string, Uint8Array> = Object.create(null);
  const seen = new Set<string>();
  for (const [partName, data] of entries) {
    const norm = normalizePartName(partName);
    if (!norm.ok) throw new Error(`unsafe part name on write: ${partName} (${norm.reason})`);
    const fold = partNameKey(norm.partName); // OPC case-folded equivalence
    if (seen.has(fold))
      throw new Error(`OPC-equivalent duplicate part name on write: ${norm.partName}`);
    seen.add(fold);
    // Canonical part names carry a leading slash; ZIP entry names do not.
    record[norm.partName.replace(/^\//, '')] = data;
  }
  return zipSync(record, { mtime: FIXED_ENTRY_MTIME });
}

export { strToU8, strFromU8 };

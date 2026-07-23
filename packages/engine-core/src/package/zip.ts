// Bounded ZIP read/write over fflate (document-engine task 2.3 / design D14).
// Reading enforces entry-count and total-decompressed-size ceilings (zip-bomb
// guard) and normalizes every entry name through the OPC profile (path-traversal
// guard) BEFORE the bytes are handed on. Writing produces a deterministic archive.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { normalizePartName } from './opc-names.ts';

export type ZipRejection = 'too-many-entries' | 'too-large' | 'bad-name' | 'inflate-error';

export interface ZipLimits {
  readonly maxEntries: number;
  /** Max total UNCOMPRESSED bytes across the archive. */
  readonly maxTotalBytes: number;
  /** Max per-entry uncompressed:compressed ratio (zip-bomb guard). */
  readonly maxRatio?: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 10_000, maxTotalBytes: 512 * 1024 * 1024, maxRatio: 200 };

export type ZipReadResult =
  | { readonly ok: true; readonly entries: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly reason: ZipRejection; readonly detail?: string };

class ZipViolation extends Error {
  constructor(readonly reason: ZipRejection) {
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
        // Reject two entries whose names normalize to the same canonical part (e.g.
        // `word/document.xml` vs `word/%64ocument.xml`) — last-wins would smuggle/omit
        // a part. Checked BEFORE inflation.
        if (seenNorms.has(norm.partName)) {
          badDetail = `${file.name}: normalized duplicate of ${norm.partName}`;
          throw new ZipViolation('bad-name');
        }
        seenNorms.add(norm.partName);
        // Compression-ratio zip-bomb guard, checked before decompressing.
        if (file.originalSize / Math.max(1, file.size) > maxRatio) throw new ZipViolation('too-large');
        totalUncompressed += file.originalSize;
        if (totalUncompressed > limits.maxTotalBytes) throw new ZipViolation('too-large');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ZipViolation) return { ok: false, reason: e.reason, detail: badDetail };
    return { ok: false, reason: 'inflate-error' };
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const norm = normalizePartName(name);
    if (norm.ok) entries.set(norm.partName, data);
  }
  return { ok: true, entries };
}

/** Deflate a set of canonical-part-name -> bytes into a ZIP archive. Every part name
 *  is re-validated through the OPC normalization profile before writing, so a
 *  traversal/encoded/normalized-alias name from an untrusted serialized model can
 *  never be smuggled into a ZIP entry (write-side path-traversal guard). */
export function writeZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const record: Record<string, Uint8Array> = {};
  for (const [partName, data] of entries) {
    const norm = normalizePartName(partName);
    if (!norm.ok) throw new Error(`unsafe part name on write: ${partName} (${norm.reason})`);
    // Canonical part names carry a leading slash; ZIP entry names do not.
    const key = norm.partName.replace(/^\//, '');
    if (key in record) throw new Error(`duplicate normalized part name on write: ${key}`);
    record[key] = data;
  }
  return zipSync(record);
}

export { strToU8, strFromU8 };

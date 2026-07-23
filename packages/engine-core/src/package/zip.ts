// Bounded ZIP read/write over fflate (document-engine task 2.3 / design D14).
// Reading enforces entry-count and total-decompressed-size ceilings (zip-bomb
// guard) and normalizes every entry name through the OPC profile (path-traversal
// guard) BEFORE the bytes are handed on. Writing produces a deterministic archive.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { normalizePartName } from './opc-names.ts';

export type ZipRejection = 'too-many-entries' | 'too-large' | 'bad-name' | 'inflate-error';

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 10_000, maxTotalBytes: 512 * 1024 * 1024 };

export type ZipReadResult =
  | { readonly ok: true; readonly entries: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly reason: ZipRejection; readonly detail?: string };

/** Inflate a ZIP archive with bounds + OPC name normalization. Keys are canonical part names. */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReadResult {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch {
    return { ok: false, reason: 'inflate-error' };
  }
  const names = Object.keys(raw);
  if (names.length > limits.maxEntries) return { ok: false, reason: 'too-many-entries' };

  const entries = new Map<string, Uint8Array>();
  let total = 0;
  for (const name of names) {
    if (name.endsWith('/')) continue; // directory entry
    const norm = normalizePartName(name);
    if (!norm.ok) return { ok: false, reason: 'bad-name', detail: `${name}: ${norm.reason}` };
    const data = raw[name];
    total += data.length;
    if (total > limits.maxTotalBytes) return { ok: false, reason: 'too-large' };
    entries.set(norm.partName, data);
  }
  return { ok: true, entries };
}

/** Deflate a set of canonical-part-name -> bytes into a ZIP archive. */
export function writeZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const record: Record<string, Uint8Array> = {};
  for (const [partName, data] of entries) {
    // ZIP entry names have no leading slash.
    record[partName.replace(/^\//, '')] = data;
  }
  return zipSync(record);
}

export { strToU8, strFromU8 };

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The font files that exports read from disk, kept for later exports in the same process.
//
// One export reads every face it uses, hashes each face, and opens collections to find a face
// by name. A batch of exports reads the same files again for each document. This cache keeps
// each file's bytes, and what callers derive from them, for as long as the file on disk keeps
// its size and modification time. The bytes are never changed or transferred, so exports
// share them. The total is bounded: the least recently used files leave first.

import { readFile, stat } from 'node:fs/promises';
import type { URL as NodeURL } from 'node:url';

/** The largest font file an export reads. */
export const MAX_FONT_FILE_BYTES = 32 * 1024 * 1024;
/** The font bytes the cache keeps across exports. */
const DEFAULT_CACHE_BYTES = 128 * 1024 * 1024;

/** One file's bytes, and values derived from them, keyed by what the caller derived. */
export interface CachedFontFile {
  readonly bytes: Uint8Array;
  /** Derived values; they live and leave with the file. */
  readonly derived: Map<string, unknown>;
}

interface Entry {
  readonly stamp: string;
  readonly file: CachedFontFile;
}

/** A bounded cache of font files by path. */
export interface FontFileCache {
  read(path: string | NodeURL, signal?: AbortSignal): Promise<CachedFontFile>;
  /** Bytes the cache holds now. */
  readonly size: number;
  clear(): void;
}

async function readBytes(path: string | NodeURL, signal?: AbortSignal): Promise<Uint8Array> {
  // Let the read itself observe the signal, so a cancelled export does not finish mapping a
  // 16 MB face first. Node's fs accepts only its own realm's `AbortSignal`, and `instanceof`
  // cannot tell: a DOM shim can install an `AbortSignal` global that passes the check and is
  // still refused with `ERR_INVALID_ARG_TYPE`. So the read is asked, and a refused signal
  // falls back to the bounded read with the signal checked around it.
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path, signal ? { signal } : undefined);
  } catch (error) {
    if (!signal || (error as { code?: string }).code !== 'ERR_INVALID_ARG_TYPE') throw error;
    bytes = await readFile(path);
  }
  if (signal?.aborted) throw signal.reason;
  // A buffer of its own: a pooled read can share its memory with other reads.
  return new Uint8Array(bytes);
}

export function createFontFileCache(maxBytes = DEFAULT_CACHE_BYTES): FontFileCache {
  const entries = new Map<string, Entry>();
  let size = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    size -= entry.file.bytes.byteLength;
  };
  return {
    async read(path, signal) {
      if (signal?.aborted) throw signal.reason;
      // Check the local size before allocation; the size and time also tell a changed file.
      const info = await stat(path);
      if (info.size > MAX_FONT_FILE_BYTES) throw new RangeError('Local font exceeds 32 MiB');
      const key = String(path);
      const stamp = `${info.size}:${info.mtimeMs}`;
      const cached = entries.get(key);
      if (cached?.stamp === stamp) {
        // Most recently used goes last.
        entries.delete(key);
        entries.set(key, cached);
        return cached.file;
      }
      drop(key);
      const file: CachedFontFile = { bytes: await readBytes(path, signal), derived: new Map() };
      if (file.bytes.byteLength <= maxBytes) {
        for (const oldest of entries.keys()) {
          if (size + file.bytes.byteLength <= maxBytes) break;
          drop(oldest);
        }
        entries.set(key, { stamp, file });
        size += file.bytes.byteLength;
      }
      return file;
    },
    get size() {
      return size;
    },
    clear() {
      entries.clear();
      size = 0;
    },
  };
}

/** The cache every export in this process shares. */
export const fontFiles = createFontFileCache();

/** A value derived from a cached file, computed once per file and `key`. */
export function derivedOnce<T>(file: CachedFontFile, key: string, derive: () => T): T {
  if (file.derived.has(key)) return file.derived.get(key) as T;
  const value = derive();
  file.derived.set(key, value);
  return value;
}

/**
 * Minimal read-only USTAR tar reader, sufficient for extracting a single
 * named file (e.g. `package/index.d.ts`) out of a gzip+tar npm package
 * tarball. Not a general-purpose tar library — no symlink/hardlink/sparse
 * support. Deliberately small and auditable: this module performs no
 * integrity check itself — `fetch-office-reference.mjs` (invoked either
 * manually via `compat:fetch-reference` or by the scheduled drift-check
 * workflow) is the only caller that matters for security, and it always
 * verifies the tarball's bytes against the npm registry's published
 * `dist.integrity` (`lib/integrity.mjs`) *before* calling
 * `extractFileFromTarGzip` on them. This file's own tests call these
 * functions directly against small synthetic fixtures with no integrity
 * check involved, since only the parsing logic is under test there.
 */

import { gunzipSync } from 'node:zlib';

function readOctalField(buf) {
  const text = buf.toString('ascii').replace(/\0.*$/, '').trim();
  return text.length > 0 ? parseInt(text, 8) : 0;
}

const REGULAR_FILE_TYPEFLAGS = new Set(['0', '\0']);

/** Parses all regular-file entries out of a raw (already-decompressed) tar buffer. */
export function parseTarEntries(tarBuffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker

    const name = header.subarray(0, 100).toString('ascii').replace(/\0.*$/, '');
    const size = readOctalField(header.subarray(124, 136));
    const typeFlag = String.fromCharCode(header[156]);
    const contentStart = offset + 512;

    if (REGULAR_FILE_TYPEFLAGS.has(typeFlag) && name.length > 0) {
      entries.push({
        name,
        content: Buffer.from(tarBuffer.subarray(contentStart, contentStart + size)),
      });
    }

    const blockCount = Math.ceil(size / 512);
    offset = contentStart + blockCount * 512;
  }
  return entries;
}

/**
 * Decompresses a gzip buffer, parses it as tar, and returns the content of
 * the entry matching `targetPath` exactly or by trailing path segment
 * (so callers can pass either the full in-archive path or just the
 * filename). Returns `null` when not found.
 */
export function extractFileFromTarGzip(gzipBuffer, targetPath) {
  const tarBuffer = gunzipSync(gzipBuffer);
  const entries = parseTarEntries(tarBuffer);
  const match = entries.find(
    (entry) => entry.name === targetPath || entry.name.endsWith(`/${targetPath}`)
  );
  return match ? match.content : null;
}

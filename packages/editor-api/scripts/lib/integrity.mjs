/**
 * Subresource-Integrity-style hash verification for fetched upstream bytes
 * (npm's `dist.integrity` format: `sha512-<base64 digest>`, RFC-compatible
 * with the W3C SRI spec). Used by the scheduled/manual reference-fetch job
 * to confirm downloaded bytes match what the npm registry published before
 * anything is parsed.
 */

import { createHash } from 'node:crypto';

const SUPPORTED_ALGORITHMS = new Set(['sha256', 'sha384', 'sha512']);

/**
 * @param {Buffer} buffer
 * @param {string} integrity e.g. `"sha512-BASE64=="`
 * @returns {boolean} whether `buffer`'s digest matches.
 * @throws if `integrity` is malformed or names an unsupported algorithm.
 */
export function verifySubresourceIntegrity(buffer, integrity) {
  const match = /^([a-z0-9]+)-(.+)$/i.exec(integrity);
  if (!match) {
    throw new Error(`malformed integrity string: ${JSON.stringify(integrity)}`);
  }
  const [, algorithm, expectedDigestBase64] = match;
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error(`unsupported integrity algorithm: ${algorithm}`);
  }
  const actualDigestBase64 = createHash(algorithm).update(buffer).digest('base64');
  return actualDigestBase64 === expectedDigestBase64;
}

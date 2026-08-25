import { createHash } from 'node:crypto';

/** Same `sha256:` prefix shape as production `sha256Bytes`. */
export function contentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

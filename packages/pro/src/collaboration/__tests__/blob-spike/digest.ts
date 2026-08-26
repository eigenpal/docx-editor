/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { createHash } from 'node:crypto';

/** Same `sha256:` prefix shape as production `sha256Bytes`. */
export function contentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

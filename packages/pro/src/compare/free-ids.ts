/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Returns a source of the smallest unused decimal ids from `start` up. Ids a document holds are
 * file data and may be huge or padded ("01"), so each counts as taken both as written and as the
 * number a reader parses from it. No arithmetic on file-supplied values, so precision is never lost.
 */
export function freeIds(used: Iterable<string>, start = 1): () => string {
  const taken = new Set<string>();
  for (const id of used) {
    taken.add(id);
    const trimmed = id.trim();
    if (/^[+-]?\d+$/.test(trimmed)) taken.add(String(BigInt(trimmed)));
  }
  let next = start;
  return () => {
    while (taken.has(String(next))) next++;
    taken.add(String(next));
    return String(next);
  };
}

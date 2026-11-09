/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Appends every item of each list to `out`. Sizes come from file data, and `out.push(...list)`
 * passes each item as a call argument, which overflows the stack on a long list.
 */
export function pushAll<T>(out: T[], ...lists: readonly (readonly T[])[]): T[] {
  for (const list of lists) for (const item of list) out.push(item);
  return out;
}

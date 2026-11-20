import { frozenLine, type PendingLine } from './pending-line.ts';
import { carryNumericWidthProof } from './numeric-width-proof-cache.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';

/**
 * Preserve snapshot ownership and scalar break proofs at both cache write boundaries.
 *
 * Returns the lines the cache holds for `key`: the frozen snapshot a later pass reads back, or
 * `lines` itself when nothing is retained. A caller that only reads the lines can place the
 * snapshot at once, so this pass and each later one place the same line objects.
 */
export function storePendingLines(
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  key: string | null,
  lines: readonly PendingLine[]
): readonly PendingLine[] {
  if (!cache || key === null) return lines;
  const retained = cache.retainAcrossPasses === false ? lines : lines.map(frozenLine);
  carryNumericWidthProof(lines, retained);
  cache.set(key, retained);
  return retained;
}

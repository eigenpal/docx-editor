import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  exclusionLayoutToken,
  exclusionMapsEqual,
  exclusionMapsToken,
  type ExclusionZone,
} from './drawing-exclusion.ts';

type Zones = ReadonlyMap<number, readonly ExclusionZone[]>;

/** Establish anchor pages before later page bands can displace their predecessors. */
export function createDrawingExclusionPasses(
  blocks: readonly OoxmlElement[],
  drawings: InlineDrawingLayoutContext | undefined,
  maxPasses: number,
  compatibilityMode?: number
) {
  // Consecutive anchor-only paragraphs depend on earlier objects for their page.
  // Modern layout seeds those dependencies before later fixed bands wrap earlier text.
  let previousAnchorsOnly = false;
  let seedForwardOnly = false;
  if (drawings && hasCompatibilityRule(compatibilityMode, 'anchorOnlyParagraphSeeding'))
    for (const block of blocks) {
      const atoms =
        block.kind === 'paragraph' ? anchoredDrawingAtomsInParagraph(block, drawings) : [];
      const anchorsOnly =
        block.kind === 'paragraph' &&
        atoms.length > 0 &&
        paragraphOffsetIndex(block).length === atoms.length;
      if (previousAnchorsOnly && anchorsOnly) {
        seedForwardOnly = true;
        break;
      }
      previousAnchorsOnly = anchorsOnly;
    }
  const seen = new Set<string>();
  return {
    maxPasses: seedForwardOnly ? maxPasses * 2 : maxPasses,
    passIndex: (pass: number): number => {
      if (seedForwardOnly && pass >= maxPasses) {
        seedForwardOnly = false;
        seen.clear();
      }
      return seedForwardOnly ? -pass - 1 : pass;
    },
    remember: (zones: Zones): void => {
      seen.add(exclusionMapsToken(zones));
    },
    advance(previous: Zones, next: Zones, stabilization = false): 'continue' | 'stable' | 'cycle' {
      if (
        seedForwardOnly &&
        (stabilization ||
          !Array.from(next.values()).some((zones) => zones.some((zone) => zone.pageFramedBand)))
      ) {
        seedForwardOnly = false;
        seen.clear();
      }
      const stable = exclusionMapsEqual(previous, next);
      const token = exclusionMapsToken(next);
      const cycle = seen.has(token);
      if (seedForwardOnly && (stable || cycle)) {
        seedForwardOnly = false;
        seen.clear();
        return 'continue';
      }
      // A stable result already uses its published zones; do not lay it out again.
      if (stable) return 'stable';
      if (cycle) return 'cycle';
      seen.add(token);
      return 'continue';
    },
  };
}

/** How many zones one map has that the other lacks, counting both directions. */
export function exclusionZoneChangeCount(previous: Zones, next: Zones): number {
  const tokens = (zonesByPage: Zones): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const [page, zones] of zonesByPage)
      for (const zone of zones) {
        const token = `${page}:${exclusionLayoutToken([zone])}`;
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    return counts;
  };
  const before = tokens(previous);
  let changed = 0;
  for (const [token, count] of tokens(next)) {
    const kept = Math.min(count, before.get(token) ?? 0);
    changed += count - kept;
    if (kept > 0) before.set(token, (before.get(token) ?? 0) - kept);
  }
  for (const count of before.values()) changed += count;
  return changed;
}

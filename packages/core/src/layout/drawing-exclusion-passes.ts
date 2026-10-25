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
  // The maps in the order the passes reached them, for the zones a cycle publishes under.
  const reached: Zones[] = [];
  const forget = (): void => {
    seen.clear();
    reached.length = 0;
  };
  return {
    maxPasses: seedForwardOnly ? maxPasses * 2 : maxPasses,
    passIndex: (pass: number): number => {
      if (seedForwardOnly && pass >= maxPasses) {
        seedForwardOnly = false;
        forget();
      }
      return seedForwardOnly ? -pass - 1 : pass;
    },
    remember: (zones: Zones): void => {
      seen.add(exclusionMapsToken(zones));
      reached.push(zones);
    },
    /** The maps of the cycle `next` closes, from its first visit on, `next` last. */
    cycleOf: (next: Zones): readonly Zones[] => {
      const token = exclusionMapsToken(next);
      const start = reached.findIndex((zones) => exclusionMapsToken(zones) === token);
      return [...(start < 0 ? [] : reached.slice(start + 1)), next];
    },
    advance(previous: Zones, next: Zones, stabilization = false): 'continue' | 'stable' | 'cycle' {
      if (
        seedForwardOnly &&
        (stabilization ||
          !Array.from(next.values()).some((zones) => zones.some((zone) => zone.pageFramedBand)))
      ) {
        seedForwardOnly = false;
        forget();
      }
      const stable = exclusionMapsEqual(previous, next);
      const token = exclusionMapsToken(next);
      const cycle = seen.has(token);
      if (seedForwardOnly && (stable || cycle)) {
        seedForwardOnly = false;
        forget();
        return 'continue';
      }
      // A stable result already uses its published zones; do not lay it out again.
      if (stable) return 'stable';
      if (cycle) return 'cycle';
      seen.add(token);
      reached.push(next);
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

/**
 * The zones a reflow cycle publishes under: its last map plus every page-framed table zone the
 * other maps of the cycle hold. Which map a reflow reaches last depends on where it entered
 * the cycle (an edited layout enters it from the previous pages), so publishing under one map
 * alone lets an edit lay out differently from a fresh layout. A page- or margin-positioned
 * table cycles when it covers its own anchor: the anchor moves on and takes the table along,
 * which frees the anchor again. Under every place the cycle puts the table, text clears it
 * wherever it paints; the place it does not paint stays a gap, as at the bottom of the page
 * the anchor left. Drawings and text-anchored tables keep the last map: a drawing that avoids
 * other drawings would also avoid its own place from another phase.
 */
export function cycleZones(cycle: readonly Zones[]): Zones {
  const last = cycle[cycle.length - 1]!;
  const merged = new Map(last);
  for (const zonesByPage of cycle.slice(0, -1))
    for (const [page, zones] of zonesByPage) {
      const own = merged.get(page) ?? [];
      const tokens = new Set(own.map((zone) => exclusionLayoutToken([zone])));
      const added = zones.filter(
        (zone) =>
          zone.sourceKind === 'table' &&
          zone.pageFramedBand === true &&
          !tokens.has(exclusionLayoutToken([zone]))
      );
      if (added.length) merged.set(page, [...own, ...added]);
    }
  return merged;
}

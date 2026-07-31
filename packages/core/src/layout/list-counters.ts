// Per-story OOXML list counter state (ECMA-376 numbering).
//
// Counters are keyed by abstractNumId: multiple `w:num` that share one abstractNum share
// sequence state. A `w:startOverride` on a num applies only the first time that numId is
// encountered in the story walk.

import {
  resolveNumberingLevel,
  type NumberingIndex,
  type NumberingLevel,
} from './numbering-index.ts';
import { expandLvlText } from './numbering-format.ts';

export interface ListCounterAdvance {
  /** Effective abstract numbering id owning the shared counters. */
  readonly abstractNumId: string;
  readonly numId: string;
  readonly ilvl: number;
  readonly level: NumberingLevel;
  /** Counter vector after this item was counted (indices 0..8). */
  readonly counters: readonly number[];
  /** Expanded marker text (empty when vanished / empty lvlText). */
  readonly markerText: string;
}

export interface ListCounterState {
  /**
   * Advance counters for one list paragraph.
   *
   * Returns null when the numbering definition cannot be resolved — callers treat the
   * paragraph as non-list (inert fallback).
   */
  advance(numId: string, ilvl: number): ListCounterAdvance | null;
}

function levelFormats(
  index: NumberingIndex,
  numId: string
): { formats: string[]; starts: number[] } {
  const formats: string[] = [];
  const starts: number[] = [];
  for (let ilvl = 0; ilvl <= 8; ilvl += 1) {
    const resolved = resolveNumberingLevel(index, numId, ilvl);
    formats.push(resolved?.level.numFmt ?? 'decimal');
    starts.push(resolved?.level.start ?? 1);
  }
  return { formats, starts };
}

/**
 * Create a fresh counter bag for one story (body, or one header/footer part).
 */
export function createListCounterState(index: NumberingIndex): ListCounterState {
  /** abstractNumId → counters[0..8], 0 meaning "not yet used at this level". */
  const byAbstract = new Map<string, number[]>();
  /** numIds that have already consumed their startOverride. */
  const seenNumIds = new Set<string>();

  const ensure = (abstractNumId: string): number[] => {
    let counters = byAbstract.get(abstractNumId);
    if (!counters) {
      counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      byAbstract.set(abstractNumId, counters);
    }
    return counters;
  };

  return {
    advance(numId, ilvl) {
      if (ilvl < 0 || ilvl > 8) return null;
      if (numId.length === 0 || numId.length > 64) return null;
      const resolved = resolveNumberingLevel(index, numId, ilvl);
      if (!resolved) return null;

      const { abstractNumId, level, startOverride } = resolved;
      const counters = ensure(abstractNumId);
      const { formats, starts } = levelFormats(index, numId);

      // First encounter of this numId applies startOverride (typically on ilvl 0).
      if (!seenNumIds.has(numId)) {
        seenNumIds.add(numId);
        if (startOverride !== undefined) {
          // Override seeds the overridden level; deeper levels reset on next use.
          counters[ilvl] = 0;
          // Store override as the value to use on first increment via starts path:
          // we set the counter to startOverride - 1 so the increment lands on startOverride.
          // But startOverride is on a specific override ilvl (often 0), not necessarily
          // this paragraph's ilvl — apply to the override's level index from the num def.
          const num = index.nums.get(numId);
          if (num) {
            for (const [overrideIlvl, override] of num.overrides) {
              if (override.startOverride !== undefined) {
                counters[overrideIlvl] = Math.max(0, override.startOverride - 1);
              }
            }
          }
        }
      }

      // Increment this level.
      if (counters[ilvl] === 0) {
        counters[ilvl] = starts[ilvl] ?? level.start;
      } else {
        counters[ilvl] += 1;
      }

      // Reset deeper levels to unused so the next visit restarts at their start.
      for (let deeper = ilvl + 1; deeper <= 8; deeper += 1) {
        counters[deeper] = 0;
      }

      const snapshot = counters.slice() as number[];
      // For expansion, unused deeper levels should still substitute as their start (Word
      // shows them when lvlText references them); unused shallower levels use 0→treat as start.
      const expandCounters = snapshot.map((value, index) =>
        value === 0 ? (starts[index] ?? 1) : value
      );

      const markerText = level.vanish
        ? ''
        : level.numFmt === 'bullet' && !/%[1-9]/.test(level.lvlText)
          ? level.lvlText
          : expandLvlText(level.lvlText, expandCounters, formats);

      return {
        abstractNumId,
        numId,
        ilvl,
        level,
        counters: snapshot,
        markerText,
      };
    },
  };
}

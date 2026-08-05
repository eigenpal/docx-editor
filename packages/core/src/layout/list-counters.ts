// Per-story OOXML list counter state (ECMA-376 numbering).
//
// Counters are keyed by numId: each `w:num` instance maintains an independent sequence even
// when multiple nums share one abstractNum. A `w:startOverride` on a num applies only the
// first time that numId is encountered in the story walk.

import {
  resolveNumberingLevel,
  type NumberingIndex,
  type NumberingLevel,
} from './numbering-index.ts';
import { expandLvlText } from './numbering-format.ts';

/**
 * The result of counting ONE list paragraph: the level that applied, the counter vector after it,
 * and the marker text a reader sees.
 *
 * Counters are a vector across all nine levels, not a single number, because a deeper level
 * restarting resets the ones below it while leaving those above intact.
 */
export interface ListCounterAdvance {
  /** Effective abstract numbering template for this num instance. */
  readonly abstractNumId: string;
  readonly numId: string;
  readonly ilvl: number;
  readonly level: NumberingLevel;
  /** Counter vector after this item was counted (indices 0..8). */
  readonly counters: readonly number[];
  /** Expanded marker text (empty when vanished / empty lvlText). */
  readonly markerText: string;
}

/**
 * The running counters for one layout pass over one story.
 *
 * Stateful and order-dependent by nature: a list number is a function of every numbered paragraph
 * before it, which is why markers are computed during layout and cannot be read off a paragraph
 * in isolation.
 */
export interface ListCounterState {
  /**
   * Advance counters for one list paragraph.
   *
   * Returns null when the numbering definition cannot be resolved — callers treat the
   * paragraph as non-list (inert fallback).
   */
  advance(numId: string, ilvl: number): ListCounterAdvance | null;
}

/** Effective first-emitted value per ilvl, honoring `w:startOverride` and level overrides. */
function effectiveStartsForNum(index: NumberingIndex, numId: string): number[] {
  const num = index.nums.get(numId);
  const starts: number[] = [];
  for (let ilvl = 0; ilvl <= 8; ilvl += 1) {
    const resolved = resolveNumberingLevel(index, numId, ilvl);
    if (!resolved) {
      starts.push(1);
      continue;
    }
    const startOverride = num?.overrides.get(ilvl)?.startOverride;
    starts.push(startOverride ?? resolved.level.start);
  }
  return starts;
}

function levelFormats(
  index: NumberingIndex,
  numId: string,
  starts: readonly number[]
): { formats: string[]; starts: number[] } {
  const formats: string[] = [];
  for (let ilvl = 0; ilvl <= 8; ilvl += 1) {
    const resolved = resolveNumberingLevel(index, numId, ilvl);
    formats.push(resolved?.level.numFmt ?? 'decimal');
  }
  return { formats, starts: [...starts] };
}

/**
 * Highest ilvl whose use restarts level `targetIlvl`, per `w:lvlRestart` on that level.
 *
 * Returns null when the level never restarts (`lvlRestart` = 0 or trigger above target).
 */
function lvlRestartTriggerIlvl(targetIlvl: number, lvlRestart: number | undefined): number | null {
  if (lvlRestart === 0) return null;
  if (lvlRestart === undefined) return targetIlvl - 1;
  const triggerIlvl = lvlRestart - 1;
  if (triggerIlvl >= targetIlvl) return null;
  return triggerIlvl;
}

/**
 * Create a fresh counter bag for one story (body, or one header/footer part).
 */
export function createListCounterState(index: NumberingIndex): ListCounterState {
  /** numId → current counter values[0..8]. */
  const byNumId = new Map<string, number[]>();
  /** numId → whether each level has emitted at least once. */
  const initializedByNumId = new Map<string, boolean[]>();
  /** numId → authored effective starts[0..8]. */
  const startsByNumId = new Map<string, number[]>();

  const ensure = (id: string): { counters: number[]; initialized: boolean[]; starts: number[] } => {
    let counters = byNumId.get(id);
    if (!counters) {
      counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      byNumId.set(id, counters);
    }
    let initialized = initializedByNumId.get(id);
    if (!initialized) {
      initialized = [false, false, false, false, false, false, false, false, false];
      initializedByNumId.set(id, initialized);
    }
    let starts = startsByNumId.get(id);
    if (!starts) {
      starts = effectiveStartsForNum(index, id);
      startsByNumId.set(id, starts);
    }
    return { counters, initialized, starts };
  };

  return {
    advance(numId, ilvl) {
      if (ilvl < 0 || ilvl > 8) return null;
      if (numId.length === 0 || numId.length > 64) return null;
      const resolved = resolveNumberingLevel(index, numId, ilvl);
      if (!resolved) return null;

      const { abstractNumId, level } = resolved;
      const { counters, initialized, starts } = ensure(numId);
      const { formats } = levelFormats(index, numId, starts);

      // Deeper levels restart per `w:lvlRestart` when this ilvl is used.
      for (let deeper = ilvl + 1; deeper <= 8; deeper += 1) {
        const deeperLevel = resolveNumberingLevel(index, numId, deeper);
        if (!deeperLevel) continue;
        const trigger = lvlRestartTriggerIlvl(deeper, deeperLevel.level.lvlRestart);
        if (trigger !== null && ilvl <= trigger) {
          initialized[deeper] = false;
        }
      }

      // Increment this level from its authored baseline.
      const effectiveStart = starts[ilvl] ?? level.start;
      if (!initialized[ilvl]) {
        counters[ilvl] = effectiveStart;
        initialized[ilvl] = true;
      } else {
        counters[ilvl] += 1;
      }

      const snapshot = counters.slice() as number[];
      const initializedSnapshot = initialized.slice();
      // For expansion, unused deeper levels should still substitute as their start (Word
      // shows them when lvlText references them).
      const expandCounters = snapshot.map((value, idx) => {
        if (!initializedSnapshot[idx]) {
          return starts[idx] ?? 1;
        }
        return value;
      });

      // `w:isLgl` (§17.9.9): a legal-numbering level renders EVERY level its `w:lvlText`
      // references in decimal, whatever format those levels declare — `Artikel I.01` is
      // authored, `Artikel 1.1` is what Word paints. `bullet` and `none` are left alone:
      // neither prints a counter, so "display it as decimal" would invent one.
      const effectiveFormats = level.isLgl
        ? formats.map((format) => (format === 'bullet' || format === 'none' ? format : 'decimal'))
        : formats;

      const markerText = level.vanish
        ? ''
        : level.numFmt === 'bullet' && !/%[1-9]/.test(level.lvlText)
          ? level.lvlText
          : expandLvlText(level.lvlText, expandCounters, effectiveFormats);

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

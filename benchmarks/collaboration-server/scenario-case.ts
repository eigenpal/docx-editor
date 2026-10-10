// Saved cases: a scenario's actions on file. `shrink` writes them; `replay`, `shrink --start`,
// the replay test, and `inspect-paragraph.ts` read them.

import { readFileSync, writeFileSync } from 'node:fs';
import type { Action, Delivery, ReplayOptions } from './scenario-harness.ts';
import type { ScenarioConfig } from './scenarios.ts';

export interface SavedCase {
  /**
   * The shape the case was saved from. A case runs on that shape's document: on another
   * document its node IDs address other nodes, and it tests nothing.
   */
  readonly config: ScenarioConfig;
  readonly seed: number;
  readonly replicas: number;
  readonly delivery: Delivery;
  readonly actions: readonly Action[];
}

export function readCase(file: string): SavedCase {
  return JSON.parse(readFileSync(file, 'utf8')) as SavedCase;
}

export function writeCase(file: string, saved: SavedCase): void {
  // The fields in one order, so saved cases compare line by line.
  const { config, seed, replicas, delivery, actions } = saved;
  writeFileSync(
    file,
    `${JSON.stringify({ config, seed, replicas, delivery, actions }, null, 2)}\n`
  );
}

/** What the command line can change about a replay. */
export interface CaseOverrides {
  readonly replicas?: number;
  readonly delivery?: Delivery;
  readonly seed?: number;
}

/**
 * The replay of a saved case: its own replica count, delivery, and seed, unless `overrides`
 * names others. The shape's fixed delivery does not apply: a case keeps the delivery it was
 * saved with.
 */
export function replayOf(saved: SavedCase, overrides: CaseOverrides = {}): ReplayOptions {
  return {
    replicas: overrides.replicas ?? saved.replicas,
    delivery: overrides.delivery ?? saved.delivery,
    actions: saved.actions,
    seed: overrides.seed ?? saved.seed,
  };
}

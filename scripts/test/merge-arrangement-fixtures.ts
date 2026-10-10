/**
 * Shared merge-arrangement contract cases for React and Vue adapters.
 * Each bullet from openspec phase 8 is one row in this table.
 */

export interface MergeFixtureEntry {
  readonly id: string;
  readonly label: string;
}

export const MERGE_FIXTURE_ENTRIES: readonly MergeFixtureEntry[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

/** Expected flat keys when preset=true and no overrides. */
export const MERGE_DEFAULT_ORDER = ['a', 'b', 'c'] as const;

/** Override B hidden → B slot absent from output keys. */
export const MERGE_HIDDEN_B_ORDER = ['a', 'c'] as const;

/** preset=false → only host children, verbatim. */
export const MERGE_PRESET_FALSE_ORDER = ['host-only'] as const;

/** Append unknown child after defaults. */
export const MERGE_APPEND_ORDER = ['a', 'b', 'c', 'extra'] as const;

/** Last override wins when two children name the same slot. */
export const MERGE_LAST_WINS_LABEL = 'B-override-2';

/** Fragment with single keyed child unwraps to that key. */
export const MERGE_FRAGMENT_KEY = 'b';

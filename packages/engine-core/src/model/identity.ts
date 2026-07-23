// Stable identity allocation (document-engine tasks 2.9, 3.3). The allocator is
// seeded from the model's serializable IdentityState so IDs stay stable and
// monotonic across edits, save, and reopen. Split/join/move/replace/undo rules
// (task 3.4) build on `allocate`.

import type { IdentityState } from './authored-model.ts';

export type IdKindName =
  | 'story'
  | 'paragraph'
  | 'run'
  | 'part'
  | 'relationship'
  | 'table'
  | 'row'
  | 'cell'
  | 'bookmark'
  | 'comment'
  | 'revision'
  | 'annotation'
  | 'control';

const PREFIX: Record<IdKindName, string> = {
  story: 'st',
  paragraph: 'p',
  run: 'r',
  part: 'pt',
  relationship: 'rel',
  table: 'tbl',
  row: 'row',
  cell: 'cell',
  bookmark: 'bm',
  comment: 'cm',
  revision: 'rev',
  annotation: 'an',
  control: 'ctl',
};

export class IdentityAllocator {
  private readonly cursors: Record<string, number>;

  constructor(state?: IdentityState) {
    this.cursors = { ...(state?.cursors ?? {}) };
  }

  /** Allocate the next stable id for a kind (e.g. `p-3`). Monotonic per kind. */
  allocate(kind: IdKindName): string {
    const next = (this.cursors[kind] ?? 0) + 1;
    this.cursors[kind] = next;
    return `${PREFIX[kind]}-${next}`;
  }

  /** Snapshot the cursors for storage in the model. */
  state(): IdentityState {
    return { cursors: { ...this.cursors } };
  }
}

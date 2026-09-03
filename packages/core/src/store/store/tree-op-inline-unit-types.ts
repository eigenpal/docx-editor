// Operations that insert one addressable run element.

import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';

interface InlineUnitInsertFields {
  readonly paragraphId: string;
  readonly offset: number;
  /** Inline run wrapper whose content receives the unit at an ambiguous boundary. */
  readonly inside?: string;
  /** Write this as a tracked insertion, on the same terms as `insertText`. */
  readonly revision?: RevisionAttributionInput;
}

/** Tab and break mutations share one placement and revision contract. */
export type InlineUnitInsertOp =
  | ({ readonly op: 'insertTab' } & InlineUnitInsertFields)
  | ({ readonly op: 'insertHardBreak' } & InlineUnitInsertFields)
  | ({ readonly op: 'insertPageBreak' } & InlineUnitInsertFields);

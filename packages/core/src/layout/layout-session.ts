// Incremental layout session state (single- and multi-section).
//
// Separate from the paragraph break cache: the cache stores how a paragraph BREAKS; this
// stores where the flow WAS. One survives reflow, the other is invalidated by it.

import type { PageRecord, SemanticLayout } from './semantic-records.ts';

/** The flow state as it stood immediately before one block was placed. */
export interface FlowCheckpoint {
  /** Completed pages at this point. The prefix of the previous layout that still stands. */
  readonly pageCount: number;
  /** Fragments already on the page being built. */
  readonly pageFragments: readonly import('./semantic-records.ts').BlockFragmentRecord[];
  readonly cursorY: number;
  readonly lineCounter: number;
  /** Trailing paragraph spacing participating in adjacent-spacing collapse. */
  readonly previousSpaceAfter: number;
}

export interface LayoutSessionStats {
  /** Paragraphs placed by the last pass, against the number in the document. */
  readonly placed: number;
  readonly total: number;
  /** Pages carried over from the previous layout without being rebuilt. */
  readonly reusedPages: number;
  /** Passes that could not resume and laid the document out from the top. */
  readonly fullPasses: number;
}

/** One section's place on the previous document sheet stack. */
export interface SectionStackSpan {
  readonly startIndex: number;
  readonly pageCount: number;
  readonly sheetY: number;
  /** Remapped pages (projectors intact) from the last pass for this section. */
  readonly remappedPages: readonly PageRecord[];
}

/** Orchestrator state for multi-section incremental layout. */
export interface MultiSectionLayoutState {
  structureKey: string;
  sections: LayoutSession[];
  spans: SectionStackSpan[];
  previousRemapped: readonly PageRecord[];
  previousFinalized: SemanticLayout | null;
  previousPageCount: number;
}

export interface LayoutSession {
  /** @internal Mutable across passes; a caller only creates one and passes it back. */
  previous: SemanticLayout | null;
  checkpoints: FlowCheckpoint[];
  keys: string[];
  /** Geometry and producer of the previous pass; a change to either forces a full pass. */
  context: string;
  /**
   * Line counter after the last block of the previous pass.
   *
   * Multi-section orchestration threads a global line counter across sections; early-exit
   * paths (unchanged / converged) must report this rather than the resume cursor.
   */
  endLineCounter: number;
  /**
   * Flow state after the last block of the previous pass, for a section that CONTINUES
   * onto this one's last sheet (`w:type="continuous"`).
   *
   * `endCursorY` is the used height of that sheet's content column; `endSpaceAfter` is the
   * trailing paragraph spacing still eligible for adjacent-spacing collapse. Reported by
   * the early-exit paths (unchanged / converged) for the same reason as
   * {@link endLineCounter}: the resume cursor is not the end of the flow.
   */
  endCursorY: number;
  endSpaceAfter: number;
  /** Whether the last page of that pass was still open (no trailing page break). */
  endsOpenPage: boolean;
  stats: LayoutSessionStats;
  /** Present when the last pass was multi-section; child sessions live here. */
  multi: MultiSectionLayoutState | null;
}

/**
 * A layout session, retained across revisions by the caller.
 */
export function createLayoutSession(): LayoutSession {
  return {
    previous: null,
    checkpoints: [],
    keys: [],
    context: '',
    endLineCounter: 0,
    endCursorY: 0,
    endSpaceAfter: 0,
    endsOpenPage: true,
    stats: { placed: 0, total: 0, reusedPages: 0, fullPasses: 0 },
    multi: null,
  };
}

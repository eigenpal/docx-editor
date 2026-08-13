// Incremental layout session state (single- and multi-section).
//
// Separate from the paragraph break cache: the cache stores how a paragraph BREAKS; this
// stores where the flow WAS. One survives reflow, the other is invalidated by it.

import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';

/** The flow state as it stood immediately before one block was placed. */
export interface FlowCheckpoint {
  /** Completed pages at this point. The prefix of the previous layout that still stands. */
  readonly pageCount: number;
  /** Fragments already on the page being built. */
  readonly pageFragments: readonly import('./semantic-records.ts').BlockFragmentRecord[];
  /** Anchored drawings already collected for the open page. */
  readonly pendingAnchoredDrawings: readonly AnchoredDrawingRecord[];
  readonly cursorY: number;
  readonly lineCounter: number;
  /** Trailing paragraph spacing participating in adjacent-spacing collapse. */
  readonly previousSpaceAfter: number;
  /** Active column index when the section uses multiple columns. */
  readonly flowColumnIndex: number;
}

/**
 * What the last layout pass actually did — the observable evidence that incremental layout is
 * working.
 *
 * `reusedPages` and `fullPasses` are the ones that matter: a typing keystroke that rebuilds every
 * page produces identical output and unusable performance, so the tests assert on these rather
 * than on the rendered result.
 */
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

/**
 * Carried-over state that makes layout incremental.
 *
 * A caller creates one and hands the SAME object back each pass. It holds the previous pages, the
 * per-block cache keys and the flow checkpoints a pass resumes from, so an edit low in a document
 * re-lays only what follows it. A no-change pass returns the previous pages by identity.
 */
export interface LayoutSession {
  /** @internal Mutable across passes; a caller only creates one and passes it back. */
  previous: SemanticLayout | null;
  checkpoints: FlowCheckpoint[];
  keys: string[];
  /** Geometry and producer of the previous pass; a change to either forces a full pass. */
  context: string;
  /** Line counter at the start of the previous pass, for translating reused section counts. */
  startLineCounter: number;
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
  /**
   * Column-height limit chosen by the last balanced multi-column pass, or null when the
   * last pass did not balance.
   *
   * Lets the next pass try the remembered limit FIRST: an unchanged balanced section
   * early-exits on that single attempt instead of re-running the natural pass and the
   * whole balance search every time.
   */
  balanceLimit: number | null;
  /** Present when the last pass was multi-section; child sessions live here. */
  multi: MultiSectionLayoutState | null;
  /**
   * Page-bottom footnote reserves from the last published notes layout.
   *
   * Seeded into the next {@link layoutSemanticDocumentWithNotes} call so the first body
   * pass already matches the reserved context key — without this, every notes document
   * starts empty, mismatches, and throws away the session on reflow.
   */
  notePageBottomReserves: ReadonlyMap<number, number> | null;
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
    startLineCounter: 0,
    endLineCounter: 0,
    endCursorY: 0,
    endSpaceAfter: 0,
    endsOpenPage: true,
    stats: { placed: 0, total: 0, reusedPages: 0, fullPasses: 0 },
    balanceLimit: null,
    multi: null,
    notePageBottomReserves: null,
  };
}

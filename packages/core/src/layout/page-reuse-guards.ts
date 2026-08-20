// What keeps each field of a REUSED page current.
//
// A page is reused whole. Convergence appends `previous.pages.slice(...)` and the unchanged
// exit returns the previous pages by identity, so nothing compares a page field by field the
// way `fragmentSignature` compares a fragment. Every field is guarded somewhere else instead,
// and each of those guards is hand-written and lives in a different file.
//
// This is that set, written down and type-checked. A new field on `PageRecord` is a type
// error here until somebody says which mechanism keeps it current, because the failure it
// would otherwise ship is silent: a reused page showing a value the document no longer has.

import type { PageRecord } from './semantic-records.ts';

/** How a page field stays current across a pass that reuses the page it sits on. */
export type PageReuseGuard =
  /** The page's own name in the previous layout; reuse is the point, not a hazard. */
  | 'identity'
  /**
   * Folded into the session `context` string (`semantic-layout.ts`, `const context =`). A
   * change there makes the session incomparable, so the pass cannot resume at all.
   */
  | 'context'
  /**
   * Carried by the flow and compared where a pass may stop early: fragments through
   * `fragmentSignature`, anchored drawings through `sameAnchoredDrawings`, and the blocks
   * that produce both through their per-block keys.
   */
  | 'flow'
  /** Re-derived over the assembled page list every pass, so a reused page is re-annotated. */
  | 'rebuilt'
  /**
   * A pure function of another field that is ALREADY guarded, computed at page build from it,
   * so it cannot be stale unless that field is — and that field's guard already prevents it.
   * The same role `semantic-fragment-signature.ts` calls `covered`. Only a field with that
   * proof gets this; it is not a place to park a field whose mechanism is merely unclear.
   */
  | 'covered';

export const PAGE_REUSE_GUARDS = {
  id: 'identity',
  index: 'identity',
  // Page geometry opens the context string, so a margin or sheet change is a full pass by
  // construction.
  box: 'context',
  contentBox: 'context',
  fragments: 'flow',
  // Computed in `flushPage` from the page's own fragments — true when any span carries the
  // body page-field marker. A pure function of `fragments` (`flow`), so a reused page whose
  // fragments are unchanged cannot carry a stale flag. It only gates whether the
  // `pageFieldSource`-driven body substitution runs; the value it substitutes is `rebuilt`
  // every pass, so a numbering-only change still re-runs it on a page whose flag stays true.
  hasBodyPageFields: 'covered',
  // `columnsContext` carries `w:cols`. Note that a multi-column section DOES reach reuse: the
  // resume and convergence paths require `resumable`, which is single-column, but the
  // unchanged-document exit gates on `comparable` and returns the previous pages by identity.
  columnSeparators: 'context',
  // Produced by the blocks on the page: the per-block key carries the drawing token, and the
  // open page's pending and deferred lists are compared where a pass may stop early. Their
  // POSITION also depends on the furniture, because a page-frame anchor resolves against the
  // content-box inset a tall header or footer moves (#274) — `furnitureContext` carries each
  // variant's flow height, so that half is `context`.
  anchoredDrawings: 'flow',
  // `furnitureContext` folds each variant's flow height, content key and drawing-resource
  // token, which is what a header or footer edit moves.
  header: 'context',
  footer: 'context',
  // `attachNotesToLayout` rebuilds the note areas over the assembled pages every pass, and
  // the reserves and every derived mark are in the context besides.
  footnotes: 'rebuilt',
  endnotes: 'rebuilt',
  noteStream: 'rebuilt',
  // `withPageFieldSources` re-annotates every page every pass, which is what keeps PAGE and
  // SECTIONPAGES right when only the numbering moved.
  pageFieldSource: 'rebuilt',
  // `attachContentControlBoundaries`, from `finish()`, rebuilds the per-page boundaries every
  // pass and early-returns only on a matching control-context token.
  contentControls: 'rebuilt',
} as const satisfies Record<keyof PageRecord, PageReuseGuard>;

/**
 * Fields a page actually carries that the table above does not classify.
 *
 * The `satisfies` clause catches a field added to the INTERFACE. This catches the other
 * direction — a record built with a key the interface never declared.
 */
export function unguardedPageFields(page: PageRecord): readonly string[] {
  return Object.keys(page).filter((key) => !(key in PAGE_REUSE_GUARDS));
}

/** What decides whether a convergence tail may move whole sheets and still be reused. */
export interface TailShiftInputs {
  /** Completed pages now minus completed pages at the previous pass's matching checkpoint. */
  readonly delta: number;
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  /** The session read page parity on an earlier pass (inside/outside anchors). */
  readonly parityDependent: boolean;
  /** This pass read page parity while placing the prefix. */
  readonly usedPageParity: boolean;
  /** Completed pages at the previous pass's matching checkpoint. */
  readonly markPageCount: number;
  /** Per-page-index footnote reserves are in play. */
  readonly hasNoteReserves: boolean;
  /** Per-page-index wrap exclusion zones are in play. */
  readonly hasExclusionZones: boolean;
}

/**
 * Whether a convergence tail whose in-page flow matches may be reused `delta` sheets away.
 *
 * `remapPage` renumbers a shell and moves its boxes but re-picks nothing, so the shift is
 * refused when anything on the tail reads a page's absolute index: a title-page variant on
 * a moving first page, page parity over an odd delta (even/odd headers, inside/outside
 * anchors), per-page-index note reserves, or per-page-index wrap exclusion zones.
 */
export function convergenceTailShiftAllowed(inputs: TailShiftInputs): boolean {
  if (inputs.delta === 0) return true;
  const parityHolds =
    inputs.delta % 2 === 0 ||
    (!inputs.evenAndOddHeaders && !inputs.parityDependent && !inputs.usedPageParity);
  return (
    parityHolds &&
    (!inputs.titlePage || inputs.markPageCount > 0) &&
    !inputs.hasNoteReserves &&
    !inputs.hasExclusionZones
  );
}

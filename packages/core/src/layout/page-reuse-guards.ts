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
  | 'rebuilt';

export const PAGE_REUSE_GUARDS = {
  id: 'identity',
  index: 'identity',
  // Page geometry opens the context string, so a margin or sheet change is a full pass by
  // construction.
  box: 'context',
  contentBox: 'context',
  fragments: 'flow',
  // `columnsContext` carries `w:cols`, and `resumable` additionally requires a single column,
  // so a multi-column section never reaches the reuse paths at all.
  columnSeparators: 'context',
  // Produced by the blocks on the page: the per-block key carries the drawing token, and the
  // open page's pending and deferred lists are compared where a pass may stop early.
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
  // `withContentControlMetadata` re-attaches boundaries, and returns the same array only
  // when the control-context token matches.
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

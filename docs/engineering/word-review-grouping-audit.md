# Word review grouping audit

Native Microsoft Word Reviewing Pane observations from 2026-09-18. All examples are synthetic. The fixture generator is `packages/core/src/store/__tests__/fixtures/review-table-grouping-cases.ts`.

## Verified boundaries

- Consecutive inserted/deleted rows with the same author form one table-fragment entry, even with different revision IDs or timestamps.
- A different row author, an unchanged row, or a separate table starts a new entry.
- Same-direction text and paragraph marks inside those rows join the row decision, including text attributed to a different author or timestamp.
- Opposite-direction text and formatting remain independent.
- Cell insertion/deletion markers remain independent, including when a row marker is present.
- Untracked rows do not group independent insertions across their cells.

The matrix contains 90 synthetic fixtures inspected in Word, including seven move controls and two unchanged-gap controls. The tests record matching Reviewing Pane entry counts for all 90 cases. They additionally verify canonical site membership, individual and batch resolution, preservation of independent decisions, undo/redo, live cell edits, activation, automation handles, and reused identities outside a group.

## Nested tables

Two additional fixtures were created by editing a nested table in Word with Track Changes enabled, rather than hand-authoring their revision markup. Word-created inserted and deleted rows carry a same-direction revision on every direct cell paragraph mark. Word exposes each as one decision. The engine previously exposed the inserted row as three decisions; it now groups the row marker, cell paragraph marks and same-direction text together. Both native single-entry accept and reject results were saved and inspected: acceptance/rejection affects only the intended nested row, preserves the other nested rows and outer table, and leaves no revision markers. Store regressions and browser cases cover both directions, undo/redo and saved output.

The complete-cell-paragraph condition is intentionally distinct from the manually constructed nested row-end fixtures below. Incomplete or mixed-direction paragraph histories retain the existing conservative decision boundaries.

For both insertion and deletion, a tracked outer row containing a same-author tracked nested row has three entries: two nested text changes and one table entry. Changing the nested row's author produces four entries. A tracked nested row inside an untracked outer row also has three entries. An untracked nested table inside a tracked outer row leaves one entry.

The observed pane order suggests that nested markers must not all be absorbed into an outer group. The current implementation assigns the first nested row marker to the following row's first text change, while keeping the other text changes independent. This is an inferred decision model, not verified native action membership. An unchanged nested row breaks this flow. The implementation follows the nested row-end order and stops at enclosing cell boundaries. An unchanged paragraph following a nested table in an untracked outer row breaks grouping before a later text edit; insertion and deletion controls each show four entries. The tracked-outer-row case remains distinct because otherwise plain content participates in the outer row revision. The tested matrix includes three table levels, opposite directions, unchanged inner rows, two nested rows, and two nested tables in one cell. An engine membership test asserts that the two-row example keeps `First A`, `First B`, and `Second B` independent, with `Second A` joining the first nested row marker.

Nested-row anchors now use the row-end boundary rather than the preceding row text. The two-row queue orders `First A`, `First B`, the first row decision, `Second B`, and the outer row decision, matching the observed Word pane. Browser tests verify this order, displayed card counts, markup clearing, accept/reject output, undo/redo, and save/reopen for nested rows and mixed table formatting.

Exact native single-entry table acceptance/rejection remains unverified for the nested case. A navigation attempt accepted a nested text revision instead; saved XML exposed this, and it was not treated as evidence of table-group resolution. Selecting outer text can resolve that text without clearing the row markers. Display grouping and selection-based native acceptance must not be conflated.

## Adjacent run formatting

Adjacent run-formatting changes by one author form one entry when their formatting delta agrees, including different timestamps and different starting styles. Adding bold to plain text and adding bold to already-italic text both describe the same change. Adding bold while removing italic is different and stays separate. Authors, unchanged intervening text, paragraphs, and cells split entries. The implementation compares full property deltas rather than the subset exposed by localized UI summaries, and keeps every original snapshot for rejection.

## Table formatting

- Two adjacent changed cells produce one entry, including different authors or dates. The mixed-author example is attributed to the last cell's author.
- Adjacent row-property changes by one author produce one entry. Different authors or an unchanged intervening row produce two entries.
- Nested cell formatting and outer cell formatting remain two entries.
- The mixed row/cell fixture and the grid/cell fixture each produce one entry.
- A row-exception history produces one entry.

The mixed row/cell fixture was accepted and rejected through Word's single-entry control, saved, and its XML inspected. Acceptance cleared all three histories and retained both yellow cells and the new row height. Rejection cleared all three histories and restored the earlier properties. Engine tests reproduce those outcomes; editor and automation tests verify individual resolution, undo/redo, and saved output.

The formatting fixtures additionally pass engine accept/reject checks, including property restoration and serialization/reopening. These are separate from native grouping assertions.

Individual structural decisions now use dependency preflight even when they contain only one canonical marker. Editor and automation regressions verify that removing a nested row cannot silently remove independent text decisions; refused actions leave the document unchanged. This is an engine safety assertion, separate from the unresolved native nested-action comparison.

A later fixture created by changing a nested cell's width in Word shows one “Formatted Table” entry. Word also writes an unchanged `tblPrChange` alongside the cell/grid snapshots. The engine now includes that same-author, unchanged table snapshot when there is exactly one unambiguous row-formatting group. Meaningful table changes and ambiguous multi-group histories stay independent. The normalized fixture was reopened in Word and still shows one entry; native accept/reject outputs retain/restore the changed cell width (1600/2000 twips), clear all histories and preserve the other seven cell widths. Store and browser tests cover this case, including undo/redo and save/reopen.

A Word-created row-height edit additionally establishes an implicit absent-property case: Word omits `trPrChange` when there were no prior row properties, yet Reject All removes the new height. A control with a pre-existing 400-twip height produces an explicit snapshot and restores 400 after an edit to 800. The engine now removes an implicitly added height only when the selected unchanged table/grid snapshots and every direct cell snapshot form the complete same-author/date bundle; the row must have no other properties or revision markers. Missing or changed snapshots, other row properties, different authors, and partial canonical-site operations retain their existing behavior. The inferred row is included in structural protection checks. Store tests cover both prior states and protected controls; browser tests cover the absent-property case.

Word's AppleScript revision collection returned zero for these nested fixtures while the visible Reviewing Pane showed one entry; UI counts and saved XML are the evidence used here.

## Move controls

Move ranges and move wrappers are not interchangeable. Seven additional controls show:

| Representation                                  | Word entries                       |
| ----------------------------------------------- | ---------------------------------- |
| Destination `moveTo` wrapper without range      | 1 insertion                        |
| Orphan destination range with `moveTo` wrapper  | 1 insertion + 1 move               |
| Orphan destination range with `ins` wrapper     | 1 insertion + 1 move               |
| Source range with `del` wrapper                 | 1 deletion + 1 move                |
| Paired ranges with `del`/`ins` wrappers         | 1 deletion + 1 insertion + 2 moves |
| Destination range with two adjacent insertions  | 1 insertion + 1 move               |
| Paired ranges with `moveFrom`/`moveTo` wrappers | 2 moves                            |

The paired move-wrapper control was accepted in Word and saved: neither move wrapper nor range marker remained. A first version incorrectly used `delText` inside `moveFrom`; Word rejected that fixture. The corrected control uses `t` and opens normally. Only the corrected result counts as evidence.

Paragraph-local ranges over ordinary insertion/deletion wrappers now expose independent move decisions. Sixteen Word-saved individual accept/reject results verify paired, source-only and destination-only controls. Accepting a paired move consumes the source while preserving the destination insertion; rejecting it carries the destination's still-tracked content back to the source. Reject All subsequently rejects that insertion, matching Word's empty result. Resolving text that empties a range also clears the associated move metadata. Batch results include decisions consumed by these dependencies.

Safety regressions cover locked source/destination controls, shared revision identities outside the range, malformed pairs, run-format preservation, card order and anchors. Unsupported range shapes remain visible read-only decisions. Paired wrapper moves retain their existing behavior. A paragraph-local orphan destination wrapping plain tracked text now exposes Word's separate move and insertion decisions. Native individual actions verify that resolving the move keeps the text and consumes both decisions; accepting the insertion retains the move, and rejecting it removes the text and both decisions. Bulk resolution gives the move decision precedence, preserving the text in either direction.

## Native bulk-content references

Microsoft Word for Mac 16.113 (build 16.113.26091433) was used to save accept-all and reject-all results for the original 85 synthetic fixtures: 170 bulk-action outputs. `word-bulk-content-reference.json` records the resulting text, bold/italic text, nested table placement, row/cell topology, row heights and cell shading. These are independent native outputs, not expectations derived from the engine's resolution code.

The comparison deliberately ignores run splitting: Word can combine adjacent equally formatted runs without changing the result. It does **not** assert table widths, grid widths, all formatting properties, individual group ownership, or universal UI parity. The separate numeric geometry comparison described below covers widths and grids after native normalization.

The reference tests confirm all 170 outputs for the listed properties, including the four outcomes that retain a structural revision. The paired ordinary move rejection now matches Word. The two orphan destination-range insertion controls require a second native Accept All pass before Word clears their remaining move metadata; the engine reaches that completed result in one batch. The four destructive `nested-plain-*` and `nested-opposite-row-*` controls retain their outer row marker and existing nested table after repeated native bulk actions. Reopened pane inspection confirms the pending revision. The engine now preserves that structure while resolving the selected text, reports `retained-structure`, and keeps one pending decision. A repeat action makes no changes; resolving in the other direction clears the marker without deleting the table.

Two native automation paths were tested. AppleScript's `accept all revisions` / `reject all revisions` collection commands are not a sufficient UI oracle: they can leave a section-property history that Word's built-in `AcceptAllChangesInDoc` command resolves. The bulk reference pass therefore uses the built-in `AcceptAllChangesInDoc` and `RejectAllChangesInDoc` commands through `run VB macro`, saves the disposable document, and closes it.

Native revision-object indexing also needs caution for nested tables. In the two-row insertion fixture, indices 2 and 4 both expose `First B`, and indices 3 and 5 both expose the nested table range, despite the distinct entries shown in the Reviewing Pane. Accepting native revision 3 resolves both nested-row markers and all four nested text insertions; rejecting it removes the outer table as well. These results establish a mismatch with the current engine action scope, but do not establish a one-to-one mapping from each native object index to the visible pane entry. Do not use count or range equality alone to claim that mapping.

## Remaining limits

- The standalone alignment `tblPrChange` fixture opens with zero Word entries. Forced-save, Accept All and Reject All retain its current alignment and discard the history. The engine now treats this isolated, unambiguous alignment history as auxiliary metadata and cleans it during unfiltered bulk resolution. Filtered actions preserve it. A separate Word-created alignment edit carries table/grid/cell histories and is one formatting decision; accept retains both table and row alignment, while reject restores their absence. Native pane inspection and saved outputs confirm both behaviors. The standalone `tblGridChange` fixture also matches: zero pane entries and current grid widths retained in both directions. Only unambiguous isolated numeric grids qualify; shared identities, other live decisions, unknown properties and changed grid shapes remain explicit.
- Shared grid history now accompanies row-formatting decisions without creating a third card. Eight native single-entry probes confirm that resolving either entry retains the shared grid history while the other remains pending. The batch planner defers that history until the last row decision; regressions exercise both orders and all accept/reject combinations. Unsupported row histories and identities spanning groups keep grid histories independently addressable, so result counts cannot claim a retained history was resolved. Partial batch counts are computed from the resulting queue because removing a separating row can combine the remaining formatting groups. Preview resolution uses an isolated root so it cannot consume the live document’s node index or allocator state. Non-restorable row snapshots retain shared grid history, and move dependencies cannot be bypassed through a separately selected text deletion. This verifies history lifetime and row-height decisions, not numeric width/grid restoration parity.
- All 90 current fixture counts have native reference assertions. All 170 bulk content/topology outcomes and all 170 normalized geometry outcomes match. These matrices do not establish individual nested action membership.
- Native single-entry nested-row action membership remains unresolved. Native object indices do not map reliably to the visible entries. Built-in navigation followed by `AcceptChangesSelected`, `AcceptChangesOrAdvance`, and `AcceptChangesAndAdvance` resolves the first text entry, but leaves the selected third nested entry unchanged in the two-row fixture. Direct acceptance of revision object 3 instead resolves the nested table. These conflicting results are not a verified UI action oracle.
- Group metadata and arbitrary combinations beyond the synthetic matrix are not claimed to have universal Word parity.

For each remaining fixture, record the native review entry labels and counts, then accept and reject an individual entry on separate copies. Compare the remaining revision markers and resulting properties. Matching entry counts alone is insufficient: nested row markers must not disappear from the API without establishing which Word decision owns them, and table formatting must not absorb independent text or paragraph formatting.

The count matrix and all 170 content/topology outcomes match. The expanded geometry audit also matches all 170 outcomes: paragraph formatting, table width/alignment/grid, row height, and cell width/shading/span/merge. Unchanged import normalization is compared against separately forced Word-save baselines; remaining grid-cache differences are compared after reopening and force-saving the engine output in Word. This is semantic export parity, not byte-for-byte XML or universal rendering parity.

Rejecting a row-formatting decision restores cells without their own old-property record to default cell formatting. Cells with independent records retain them. Empty row snapshots in mixed changed/unchanged tables also require rebuilding the old grid: Word uses 360-twip fallback cells and preserves trailing omitted space. Fixed-layout native probes confirm the exact old grid; autofit probes confirm the exported constraints produce the same Word-saved grid. Protection checks include affected neighbouring cells and, when rebuilding the grid, the owning table. Unknown extension payloads remain intact.

A 32,094-step selection/reload audit additionally exposed a reporting bug for deeply nested rows: an inner row cannot be reported as retained if an eligible outer-row action removes it. The planner now accounts for ancestor removals. Individual nested decision ownership remains subject to the limitations above.

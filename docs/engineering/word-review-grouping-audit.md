# Word review grouping audit (in progress)

Native Microsoft Word Reviewing Pane observations from 2026-09-18. All examples are synthetic. The fixture generator is `packages/core/src/store/__tests__/fixtures/review-table-grouping-cases.ts`.

## Verified boundaries

- Consecutive inserted/deleted rows with the same author form one table-fragment entry, even with different revision IDs or timestamps.
- A different row author, an unchanged row, or a separate table starts a new entry.
- Same-direction text and paragraph marks inside those rows join the row decision, including text attributed to a different author or timestamp.
- Opposite-direction text and formatting remain independent.
- Cell insertion/deletion markers remain independent, including when a row marker is present.
- Untracked rows do not group independent insertions across their cells.

The matrix contains 87 synthetic fixtures inspected in Word, including seven move controls and two unchanged-gap controls. The tests record matching Reviewing Pane entry counts for 76 cases. They additionally verify canonical site membership, individual and batch resolution, preservation of independent decisions, undo/redo, live cell edits, activation, automation handles, and reused identities outside a group.

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

These controls expose a separate unresolved gap: the engine derives move decisions from wrappers and does not expose independent move-range decisions over ordinary insertion/deletion wrappers. Reclassifying those insertions as moves would not match Word's observed queue. Resolution and dependency semantics must be verified before adding the missing decisions.

## Native bulk-content references

Microsoft Word for Mac 16.113 (build 16.113.26091433) was used to save accept-all and reject-all results for the original 85 synthetic fixtures: 170 bulk-action outputs. `word-bulk-content-reference.json` records the resulting text, bold/italic text, nested table placement, row/cell topology, row heights and cell shading. These are independent native outputs, not expectations derived from the engine's resolution code.

The comparison deliberately ignores run splitting: Word can combine adjacent equally formatted runs without changing the result. It does **not** assert table widths, grid widths, all formatting properties, individual group ownership, or universal UI parity. Separate width/grid comparisons still expose differences.

The reference tests confirm 163 outputs for the listed properties and distinguish them from unresolved cases. Six native bulk outputs retain revisions: destructive actions on `nested-plain-*` and `nested-opposite-row-*`, and acceptance of the two orphan destination-range insertion controls. The paired ordinary insertion/deletion move-range rejection produces different text from the engine. These seven outputs are explicit TODOs, not passing parity tests.

Two native automation paths were tested. AppleScript's `accept all revisions` / `reject all revisions` collection commands are not a sufficient UI oracle: they can leave a section-property history that Word's built-in `AcceptAllChangesInDoc` command resolves. The bulk reference pass therefore uses the built-in `AcceptAllChangesInDoc` and `RejectAllChangesInDoc` commands through `run VB macro`, saves the disposable document, and closes it.

Native revision-object indexing also needs caution for nested tables. In the two-row insertion fixture, indices 2 and 4 both expose `First B`, and indices 3 and 5 both expose the nested table range, despite the distinct entries shown in the Reviewing Pane. Accepting native revision 3 resolves both nested-row markers and all four nested text insertions; rejecting it removes the outer table as well. These results establish a mismatch with the current engine action scope, but do not establish a one-to-one mapping from each native object index to the visible pane entry. Do not use count or range equality alone to claim that mapping.

## Remaining limits

- Standalone `tblPrChange` and `tblGridChange` fixtures each opened with zero Word entries. Save As copies contained neither history, while retaining current properties. The engine preserves those resolvable histories; removing them for count parity would change import/save behavior.
- Grid histories are combined only when one formatting group spans every row. The grid-with-gap and grid-with-different-row-authors fixtures each show two Word entries; the engine preserves a third grid decision. These and the two standalone histories account for the four unmatched fixture counts.
- Native single-entry nested-row action membership remains unresolved. Native object indices do not map reliably to the visible entries. Built-in navigation followed by `AcceptChangesSelected`, `AcceptChangesOrAdvance`, and `AcceptChangesAndAdvance` resolves the first text entry, but leaves the selected third nested entry unchanged in the two-row fixture. Direct acceptance of revision object 3 instead resolves the nested table. These conflicting results are not a verified UI action oracle.
- Group metadata and arbitrary combinations beyond the synthetic matrix are not claimed to have universal Word parity.

For each remaining fixture, record the native review entry labels and counts, then accept and reject an individual entry on separate copies. Compare the remaining revision markers and resulting properties. Matching entry counts alone is insufficient: nested row markers must not disappear from the API without establishing which Word decision owns them, and table formatting must not absorb independent text or paragraph formatting.

This is an incomplete parity investigation, not a claim of exact Word grouping.

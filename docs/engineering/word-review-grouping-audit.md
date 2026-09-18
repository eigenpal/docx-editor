# Word review grouping audit (in progress)

Native Microsoft Word Reviewing Pane observations from 2026-09-18. All examples are synthetic. The fixture generator is `packages/core/src/store/__tests__/fixtures/review-table-grouping-cases.ts`.

## Verified boundaries

- Consecutive inserted/deleted rows with the same author form one table-fragment entry, even with different revision IDs or timestamps.
- A different row author, an unchanged row, or a separate table starts a new entry.
- Same-direction text and paragraph marks inside those rows join the row decision, including text attributed to a different author or timestamp.
- Opposite-direction text and formatting remain independent.
- Cell insertion/deletion markers remain independent, including when a row marker is present.
- Untracked rows do not group independent insertions across their cells.

The initial 76 synthetic fixtures were opened and inspected in Word. Seven additional move controls were subsequently opened and inspected. The tests record matching entry counts for 74 cases. They additionally verify canonical site membership, individual and batch resolution, preservation of independent decisions, undo/redo, live cell edits, activation, automation handles, and reused identities outside a group.

## Nested tables

For both insertion and deletion, a tracked outer row containing a same-author tracked nested row has three entries: two nested text changes and one table entry. Changing the nested row's author produces four entries. A tracked nested row inside an untracked outer row also has three entries. An untracked nested table inside a tracked outer row leaves one entry.

Further cases establish that nested markers must not all be absorbed into an outer group. In two nested tracked rows, the first row marker joins the following row's first text change; the other text changes remain independent. An unchanged nested row breaks this flow. The implementation follows the nested row-end order and stops at enclosing cell boundaries. An unchanged paragraph following a nested table in an untracked outer row breaks grouping before a later text edit; insertion and deletion controls each show four entries. The tracked-outer-row case remains distinct because otherwise plain content participates in the outer row revision. The tested matrix includes three table levels, opposite directions, unchanged inner rows, two nested rows, and two nested tables in one cell. A membership test verifies that the two-row example keeps `First A`, `First B`, and `Second B` independent, with `Second A` joining the first nested row marker.

Native single-entry table acceptance/rejection remains unverified for the nested case. A navigation attempt accepted a nested text revision instead; saved XML exposed this, and it was not treated as evidence of table-group resolution. Selecting outer text can resolve that text without clearing the row markers. Display grouping and selection-based native acceptance must not be conflated.

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

## Remaining limits

- Standalone `tblPrChange` and `tblGridChange` fixtures each opened with zero Word entries. Save As copies contained neither history, while retaining current properties. The engine preserves those resolvable histories; removing them for count parity would change import/save behavior.
- Grid histories are combined only when one formatting group spans every row. The grid-with-gap and grid-with-different-row-authors fixtures each show two Word entries; the engine preserves a third grid decision. These and the two standalone histories account for the four unmatched fixture counts.
- Native single-entry nested-row action membership remains unresolved. The application can be read while inactive, but ribbon actions did not reliably operate on the intended selection. A saved nested-row acceptance attempt retained all revision markers, and was not counted as a successful comparison.
- Group metadata and arbitrary combinations beyond the synthetic matrix are not claimed to have universal Word parity.

For each remaining fixture, record the native review entry labels and counts, then accept and reject an individual entry on separate copies. Compare the remaining revision markers and resulting properties. Matching entry counts alone is insufficient: nested row markers must not disappear from the API without establishing which Word decision owns them, and table formatting must not absorb independent text or paragraph formatting.

This is an incomplete parity investigation, not a claim of exact Word grouping.

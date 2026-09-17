# Structural tracked-change resolution

Accept/reject operates on live revision records. Property snapshots are historical state; their embedded revision markers do not create additional review decisions.

## Supported transformations

| Revision                                                         | Accept                                    | Reject                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Row insertion / deletion (`trPr/ins`, `trPr/del`)                | Keep inserted rows; remove deleted rows   | Remove inserted rows; keep deleted rows                                       |
| Cell insertion / deletion (`cellIns`, `cellDel`)                 | Keep inserted cells; remove deleted cells | Remove inserted cells; keep deleted cells                                     |
| Vertical merge (`cellMerge`)                                     | Apply `vMerge`                            | Apply `vMergeOrig`                                                            |
| Run, paragraph, row, cell, table, row table-exception properties | Keep current properties                   | Restore recorded properties                                                   |
| Table grid (`tblGridChange`)                                     | Keep current grid                         | Restore recorded grid                                                         |
| Section properties (`sectPrChange`)                              | Keep current section properties           | Restore recorded properties while preserving live header/footer relationships |

Row and cell markers are independent structural records. Row-only changes and different authors on row/cell records are valid. Both row insertion and deletion markers may be present; the destructive decision determines whether the row survives.

Deleted cell space goes to the preceding surviving cell, or the first following cell when no preceding cell survives. Grid spans and compatible preferred widths change together. A cell-property snapshot restored during the same rejection already supplies the original geometry and is not expanded a second time. Unused grid boundaries are collapsed when no property history still depends on them. Rows with omitted leading/trailing cells retain equivalent offsets. Wrapped rows/cells retain their content-control containers; empty containers removed by the decision are included in protection checks. Grid compaction is omitted for wrapped rows/cells, preserving their existing coordinate system.

Merge states `rest`/`cont` map to `restart`/`continue`; an absent state removes the merge. Continuation content is discarded when the merge is resolved, as in Word. If deleting the merge head leaves a multi-row merge, the first surviving cell becomes its head. A surviving cell with no continuation becomes independent. Horizontal spans are retained/restored through cell properties.

Removing the last cell removes its row; removing the last row removes its table. A containing cell emptied by removal receives an empty paragraph.

## Selection, malformed records, and protection

Bulk planning groups dependent decisions before applying one operation. Excluded or unsupported descendants cannot disappear through removal of a cell, row, table, or merged continuation. Changes to a neighbouring cell's geometry depend on its pending property decisions. Merge heads and continuations are grouped, including across authors. Duplicate live records and invalid merge states remain visible and unresolved. Rejecting a missing required property snapshot refuses before mutation; an empty section snapshot is valid and restores defaults.

The operation path enforces content-control locks, including controls inside discarded content and cells affected by geometry changes. A failed guard leaves the document unchanged. Existing unsupported numbering-reference revisions remain unsupported.

Named move destinations with no matching source are retained on accept and reject, matching Word's handling of these imported records. Their paragraph marks remain separate; valid paired moves retain their existing behavior.

## Verification

Tests cover both actions, partial selections, independent authors, duplicate/malformed records, historical cell markers, nested/wrapped tables, first/middle/last-cell geometry, merge content, live section references, export/reload, and two-peer undo/redo.

Local Microsoft Word comparisons use synthetic row, cell, grid, merge, and property examples. Compare text, table topology, cell widths/spans, property values, and rendered results rather than ZIP bytes: Word renumbers relationship IDs, materializes defaults, and normalizes redundant XML during save. Customer documents are used only for private local verification and are not committed as fixtures.

Document-wide Word parity also requires shared-style revision resolution. The existing review commands operate on story parts and do not resolve tracked properties in `styles.xml`; those records can still produce a formatting revision bar after all story decisions are resolved. This separate package-level gap is tracked in [#917](https://github.com/eigenpal/docx-editor/issues/917).

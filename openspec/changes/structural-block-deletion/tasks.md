## 0. Baseline before code

- [x] 0.1 Record the current `bun test` baseline for `packages/core`
- [x] 0.2 Reproduce the loss at the base commit: Select All + Delete on `comprehensive-word-element-test.docx` leaves 29 top-level paragraphs, 317 table paragraphs, all 15 tables and 7 pages of empty skeletons

## 1. The op

- [x] 1.1 Add `deleteBlock` to `TreeDocOp` and `TREE_DOC_OP_KINDS`
- [x] 1.2 Add `unknown-block`, `not-a-block`, `block-required` and `carries-section-mark` to `TreeOpRejection`
- [x] 1.3 Validate the target kind: `paragraph`, `table`, `tableRow`; refuse the root and everything else with `not-a-block`
- [x] 1.4 Guard the container invariants with `block-required`: a `w:tc` left with no `w:p`, a `w:tbl` left with no `w:tr`, a part left with no paragraph
- [x] 1.5 Refuse a `w:p` carrying `w:pPr/w:sectPr` with `carries-section-mark`
- [x] 1.6 Apply over the existing `removeNode` primitive; report `deleted` = block id plus every contained paragraph id, `impact: 'flow-structural'`
- [x] 1.7 Store tests: each accepted kind removes; sibling ids survive; every rejection; a rejected op leaves the part object-identical and the revision unmoved; undo restores the subtree; redo removes it again
- [x] 1.8 Round-trip test: remove a table, serialize, re-read — the table is absent and every retained block is preserved

## 2. Range deletion planning

- [x] 2.1 Replace `deleteRangeOps` with `planRangeDeletion`, returning `{ ops, collapseTo }`
- [x] 2.2 Compute the fully-covered paragraph set from the ordered range
- [x] 2.3 Select removable tables: outermost `w:tbl` whose every descendant paragraph is covered
- [x] 2.4 Promote the survivor when the range's first paragraph sits inside a removable table; drop the removal when no paragraph outside one exists
- [x] 2.5 Plan text removals, then block removals, then joins with removed tables treated as transparent for sibling adjacency
- [x] 2.6 Planner tests: Select All over paragraphs plus a table; a table-first document; a table-only document; partial coverage; joins reaching across a removed table

## 3. Caret and call sites

- [x] 3.1 `deleteSelectionOps` becomes `deleteSelectionPlan` on the paginated surface; the cell-rectangle branch collapses to the range start as before
- [x] 3.2 Thread `collapseTo` through `deleteSelection`, `insertPlainText` and typing over a selection
- [x] 3.3 Thread `collapseTo` through `insertTab`, `insertLineBreak` and `insertPageBreak` in `surface-structure.ts`
- [x] 3.4 Tests: paste and typing over a selection whose first paragraph is inside a removed table land in the survivor

## 4. Verification and paperwork

- [x] 4.1 `bun run typecheck` and the `packages/core` test suite green
- [x] 4.2 Browser evidence on `comprehensive-word-element-test.docx`: Select All + Delete leaves 2 tables and 3 pages (down from 15 and 7), and typing and pasting after it work
- [x] 4.3 Amend the tables lane in `typed-ooxml-paragraph-editor/deferred-features.md` — structural block removal is supported; row and column operations remain deferred
- [x] 4.4 Changeset

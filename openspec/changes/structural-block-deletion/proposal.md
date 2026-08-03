## Why

The document is a tree, not a flat list. A `w:body` holds block children side by side — paragraphs and tables — and a table nests further, so a paragraph in the body and a paragraph in a table cell are four levels apart and have different parents.

The op vocabulary has no way to say that. Every operation in `TreeDocOp` edits text, runs, or paragraph properties; the closest thing to a removal is `joinParagraphs`, which merges two adjacent siblings under one parent. Nothing removes a node. There is no op that can delete a `w:tbl`, a `w:tr`, or even an empty `w:p`.

So deleting a range happens in two phases: `deleteText` on every paragraph the range covers, then `joinParagraphs` to collapse the emptied paragraphs into one. Phase 1 works everywhere. Phase 2 stops at a table — the paragraph before it and the paragraph inside its first cell are not siblings, so the join is not a paragraph edit at all and the store refuses it. Because a transaction is atomic, one refused join used to veto everything: Select All + Delete on any document containing a table deleted nothing at all. `deleteRangeOps` therefore skips joins that would cross a block boundary, trading the total failure for a partial one.

The partial result is what a user sees today. Select All + Delete on `comprehensive-word-element-test.docx`, measured at the paginated surface:

| | before | after |
| --- | --- | --- |
| top-level paragraphs | 248 | 29 |
| paragraphs inside tables | 326 | 317 |
| tables | 15 | 15 |
| text | 12848 chars | 102 chars |
| pages | 27 | 7 |

Text is gone everywhere, so phase 1 succeeded. Runs of consecutive body paragraphs collapsed to one survivor each, leaving roughly one empty paragraph per gap between tables. Only joins inside a single cell were legal, so a few multi-paragraph cells collapsed and the rest survived. Every table still exists in full — all rows, all cells, all borders — just empty. The result is seven pages of blank table skeletons, and pasting over that selection looks like it did nothing.

Deletion was never refused. The text was erased while the scaffolding stayed, because nothing in the vocabulary can remove scaffolding.

## What Changes

**A structural removal op**

- `TreeDocOp` gains `deleteBlock`, addressing one block by node id: `{ op: 'deleteBlock', blockId }`. It removes the whole subtree — the block and everything under it.
- Accepted targets are the three block kinds the canonical tree types: `w:p`, `w:tbl`, `w:tr`. Anything else — a run, a text value, `w:body`, a properties container — is refused rather than removed, so the op cannot be used to dismantle markup the paragraph lane does not own.
- Four typed rejections guard the tree invariants a removal can break: `unknown-block`, `not-a-block`, `block-required` (a `w:tc` left with no `w:p`, a `w:tbl` left with no `w:tr`, or a part left with no paragraph at all — the caret needs a home), and `carries-section-mark` (a `w:p` holding `w:pPr/w:sectPr`, where the section boundary rides on the mark being deleted).
- The effect reports the removed block id plus every paragraph id inside it as `deleted`, with `impact: 'flow-structural'`, so the layout scheduler reflows the block sequence rather than one paragraph.
- Undo and redo need no new machinery: history entries are whole-tree snapshots over a structurally shared persistent tree, so reversing a removal is the pointer swap it already is for every other op.

**Range deletion plans around blocks instead of stopping at them**

- `deleteRangeOps` becomes `planRangeDeletion`, returning both the ops and the position the caret collapses to.
- A `w:tbl` whose every descendant paragraph is fully inside the range is removed with `deleteBlock`; its paragraphs get no `deleteText` at all. Partial coverage keeps today's behavior — text clears, structure stays.
- Joins are then planned treating removed tables as transparent, so paragraphs separated only by a removed table really are adjacent siblings by the time the join applies.
- The survivor is the range's first paragraph unless that paragraph sits inside a removed table, in which case the first covered paragraph outside one is promoted. When every covered paragraph is inside a single table — a document that is only a table — that table stays and is emptied instead, because nothing else could host the caret.

**The caret follows the survivor**

Every call site that pairs a selection deletion with `orderedStart()` reads the plan's `collapseTo` instead. Inserting into a paragraph the same transaction deleted would be refused, and one refused op vetoes the transaction — which is how a paste over a promoted selection would silently do nothing.

`w:tr` is accepted by the op and covered by tests, but nothing emits it yet: partial table coverage deliberately keeps its current behavior, so no plan asks for a row removal. It is in the vocabulary for the row operations named in the editor contract.

## What still survives, and why

Measured the same way, Select All + Delete now leaves 19 top-level paragraphs, 20 paragraphs inside tables, 2 tables and 3 pages — against 29 / 317 / 15 / 7 before. What is left is exactly what the range cannot honestly be said to cover:

- **Eight block-level `w:sdt` containers.** A content control is a deferred lane, so the canonical tree keeps it generic rather than typed. `deleteBlock` accepts only the three typed block kinds — admitting any generic block would let a delete gesture dismantle markup this engine only preserves, and Word's own `w:lock` semantics are not modelled, so a locked control would go with the rest. Their paragraphs are emptied; each container that stays is a join boundary, which is why one empty paragraph is left beside each.
- **Two tables holding paragraphs layout never emitted** — the five inside those content controls, plus one more. A paragraph with no layout fragment is not in document order, so no selection covers it, so its table is not fully contained. Removing it would delete text the user could not see was selected.

The residue is one empty paragraph per surviving block, which is the same rule the plan applies everywhere. Removing block-level content controls is the next step and belongs to the content-controls lane, where the lock semantics live.

## Impact

- `packages/core/src/store/store/tree-op-validate.ts` — op shape, kind list, rejections, block guards
- `packages/core/src/store/store/tree-op-apply.ts` — the applier over the existing `removeNode` primitive
- `packages/core/src/editor/surface-selection-ops.ts` — `planRangeDeletion`
- `packages/core/src/editor/paginated-surface.ts`, `packages/core/src/editor/surface-structure.ts` — plan-aware call sites
- `openspec/changes/typed-ooxml-paragraph-editor/deferred-features.md` — the tables lane no longer defers every structural operation

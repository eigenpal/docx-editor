# Table implementation evidence

The table slice implements the 13 editing members in tasks 2.44–2.56.

- `packages/editor-api/src/model/tables.ts` contains Table, TableRow, TableCell, and their collections.
- Range.insertTable and Body/Range.tables use the shared table protocol dispatcher.
- `packages/core/src/automation/plan-tables.ts` resolves opaque handles and table style display names.
- `packages/core/src/store/store/table-authoring-plan.ts` computes canonical table edits.
- `authorTable` applies all required primitive edits as one store operation. New cell IDs remain inside the store.
- `setTableProperties` preserves unrelated table, row, cell, and foreign XML properties.
- Per-member runtime notes are in `packages/editor-api/compat/manifest.json`.

## Verification

Eight canonical tests pass in `packages/core/src/automation/__tests__/table-authoring.test.ts`.
They cover insertion, population, rows, columns, formatting, save/reopen, merged refusal, foreign markup, and locked controls.
They also verify split effects and initial values after a planner preview.

Six public API workflow tests pass in `packages/editor-api/src/model/__tests__/model-tables.test.ts`.
They cover every editing member, named styles, returned rows, cell bodies, table deletion, save/reopen, overlap refusal, and stale cells.
The sixth test verifies same-sync range, table, row, cell, cell-body text, and cell-body range dependencies.

`packages/editor-api/src/__tests__/table-types.test.ts` checks public entry parity and method signature shapes.
Focused table lint and formatting checks passed.
`packages/editor-api/src/model/__tests__/model-table-parity.test.ts` runs the same authoring function on browser and server hosts. All 13 editing members produce matching transcripts. The test checks the live painted table, invalid-matrix refusal, untouched surrounding text, and both hosts' DOCX save/reopen results.

The final focused run passed 78 tests across model-tables, model-table-parity, model-reads, and model-writes (139 assertions). Independent report-agent verification and final reviewer closure are recorded in `consumer-review.md` and `independent-review.md`.

## Review corrections

1. Future node IDs cannot be replayed from a planning preview. The semantic store operation now allocates and populates cells internally.
2. Validation does not apply primitives while collaboration capture may be active.
3. Composite operations preserve paragraph split and caret effects.
4. Post-commit answers find created tables and rows by committed identity differences.
5. Parent admission claims cell text paragraphs against overlapping range edits.
6. Cell body settlement uses the same scoped root before and after commit.
7. Table styles use display names at the API boundary and IDs in OOXML.
8. Shading reads return `#RRGGBB`, matching Microsoft's documented color shape.
9. Whole-table deletion supports existing merged tables. Rectangular authoring still refuses merged topology.
10. Table value payloads have an aggregate one-million-character limit.
11. Body.insertText, Body.load, and Body.getRange defer handles for read-derived cell-body dependencies.

The Microsoft [TableCell reference](https://learn.microsoft.com/en-us/javascript/api/word/word.tablecell?view=word-js-preview) confirms points for uniform-column widths and the color string shape.

## Explicit limits

Creation/configuration of objects produced by a write still needs a sync boundary unless the parent runtime adds transactional dependency support.
Structural table mutations must be the only mutation in their sync.
Rectangular value authoring accepts single-paragraph text cells. Multiline values, nested authoring, and merged structural authoring refuse.
Table style writes require an existing named table style. The API does not invent style definitions.

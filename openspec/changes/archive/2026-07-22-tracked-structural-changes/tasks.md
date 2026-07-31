# Tasks: Tracked Structural Changes

Three landable phases. Each phase is a separate PR. Phase 1 includes the snapshot-and-restore infrastructure so Phases 2 and 3 are independent.

## Phase 1 — Paragraph-mark, section, and shared infra (issue #614 fix)

### Schema

- [ ] Add `pPrIns`, `pPrDel`, `pPrChange[]`, `paraRPrChange[]`, `sectPrChange`, `sectPrChangeBodyLevel` attrs to the paragraph node in `packages/core/src/prosemirror/schema/nodes.ts`. Default `null`.
- [ ] Confirm `ParagraphAttrs` `@public` status; `bun run api:extract` after edits

### Parser

- [ ] `paragraphParser/properties.ts` — `parseParagraphMarkRevision(rPrEl)` for `<w:ins/>` / `<w:del/>` inside `<w:pPr><w:rPr>`, expose as `pPrIns` / `pPrDel`
- [ ] `paragraphParser/properties.ts` — `parseParagraphMarkRPrChange(rPrEl)` for `CT_ParaRPrChange` (last child of `<w:pPr><w:rPr>`); NOT the run-rPrChange path
- [ ] Confirm `pPrChange` parses to `Paragraph.propertyChanges[]` (existing — verify wiring through `toProseDoc`)
- [ ] Locate section parsing site (likely `documentParser.ts` or `paragraphParser/properties.ts` — `sectionParser.ts` does not currently exist; do not create a file unless refactor is wanted) — read `<w:sectPrChange>` at both `pPr/sectPr` and body-level placements

### Snapshot-and-restore infrastructure (shared across phases)

- [ ] `packages/core/src/prosemirror/plugins/suggestionMode.ts` — add `withSuggestingSnapshot(commandImpl, snapshotter)` helper that wraps a property-edit command with snapshot-on-first-edit-per-(id,author,date) logic
- [ ] After each property edit, compare snapshotted fields against current values; if all equal, clear the `*Change` attr (Word's "no-op net change ⇒ no revision")
- [ ] `packages/core/src/prosemirror/utils/restorePriorProperties.ts` (new) — utility used by reject handlers to write `prior` back into node attrs / run rPr

### Cache key

- [ ] `packages/core/src/flow-model/metrics/cache.ts` — extend `paragraphCacheKey` to include `pPrIns`/`pPrDel`/`pPrChange`/`paraRPrChange`/`sectPrChange` presence flags and `revision_change` mark presence on runs
- [ ] If `hashTableBlock` (or equivalent) exists, mirror

### ContentNode plumbing

- [ ] `packages/core/src/pagination-model/buildBoxTree*.ts` — pass the new revision attrs through into `ParagraphBlock.attrs` so measurement is consistent with the cache key

### Conversion

- [ ] `toProseDoc/paragraph.ts` — map model `pPrIns`/`pPrDel`/`pPrChange[]`/`paraRPrChange[]`/`sectPrChange` to PM node attrs
- [ ] `fromProseDoc/paragraph.ts` — inverse, preserve array shapes
- [ ] `packages/core/src/prosemirror/utils/extractTrackedChanges.ts` — walk node attrs in addition to text marks; emit one entry per `(id, author, date)` triple with multi-site sites collected under one entry

### Serializer

- [ ] `serializer/paragraphSerializer.ts` — emit `<w:pPr><w:rPr><w:ins/>` / `<w:del/>` from `pPrIns` / `pPrDel` in the **first** position inside `<w:rPr>` (per `EG_ParaRPrTrackChanges` ordering)
- [ ] Emit `<w:rPrChange>` (from `paraRPrChange`) as the **last** child of `<w:pPr><w:rPr>` (per `EG_RPrContent` ordering)
- [ ] Emit `<w:pPrChange>` as the **last** child of `<w:pPr>`
- [ ] Section emission (in `documentSerializer.ts` or `paragraphSerializer.ts`, wherever section emission currently lives) — emit `<w:sectPrChange>` as the last child of `<w:sectPr>` in both pPr-level and body-level placements
- [ ] `serializer/runSerializer.ts` (or wherever run rPr is emitted) — enforce `<w:rPrChange>` is the last child of `<w:rPr>`

### Suggesting-mode plugin

- [ ] `plugins/suggestionMode.ts` — Enter handler that **calls into** `splitBlockClearBorders` (in `BaseKeymapExtension.ts`), then sets `pPrIns` on the _first_ paragraph of the resulting split (normative)
- [ ] Same Enter handler covers selection-covering-content (wrap as `deletion` then split) and empty-paragraph cases
- [ ] Backspace at paragraph start (collapsed, non-first): set `pPrDel` on previous paragraph; cursor lands at its end; no actual join
- [ ] Delete at paragraph end (collapsed, non-last): set `pPrDel` on current paragraph
- [ ] Backspace at first paragraph start: no-op
- [ ] Selection spanning paragraph boundary + Backspace/Delete: wrap inline + set `pPrDel` on covered paragraph marks; cursor at original `from`
- [ ] Wrap paragraph-property commands (alignment, indent, line spacing, style) and section-property commands with `withSuggestingSnapshot`

### Accept / Reject

- [ ] `commands/comments.ts` — `acceptChangeById(revisionId: number): Command`
- [ ] `rejectChangeById(revisionId: number): Command`
- [ ] `acceptChangesInRange(from, to): Command` (returns count of triples resolved)
- [ ] `rejectChangesInRange(from, to): Command`
- [ ] Extend `acceptAll` / `rejectAll` to walk paragraph node attrs; redefine return value as count of distinct `(id, author, date)` triples (modify behavior — note in `tracked-changes-review/spec.md` MODIFIED Requirements)
- [ ] Per-marker semantics: `pPrIns`, `pPrDel`, `pPrChange`, `paraRPrChange`, `sectPrChange`
- [ ] Edge cases: `pPrIns` reject on last paragraph (clear-only, log, return true); `pPrDel` accept on first paragraph (clear-only, log, return true)
- [ ] Cross-revision dependency: `pPrIns` reject on a paragraph with `pPrChange` first rejects the `pPrChange` if the join would remove the host
- [ ] Bypass suggesting-mode keymap inside accept/reject (apply, don't author)
- [ ] Idempotence: `acceptChangeById` / `rejectChangeById` on unknown or already-resolved id return `false`

### Painter

- [ ] `packages/core/src/painter-model/renderParagraph.ts` (canonical painter; React/Vue inherit) — pilcrow `<span class="ep-revision-pilcrow ep-revision-ins" data-revision-id data-revision-author data-revision-date>¶</span>` for `pPrIns`; class `ep-revision-del` for `pPrDel`; margin change bar for `pPrChange` / `paraRPrChange` / `sectPrChange`
- [ ] Section gutter cue for `sectPrChange` (carries `sectPrChangeBodyLevel` to position the cue correctly)
- [ ] All revision DOM carries `data-revision-id`, `data-revision-author`, `data-revision-date`

### Selection mapping

- [ ] Accept arrow-key navigation crosses `pPrDel` boundaries normally (recommended; NodeView virtualization deferred to follow-up issue)

### Sidebar

- [ ] Extend `TrackedChangeEntry` type to carry structural revisions with site list
- [ ] `useCommentSidebarItems.tsx` — group by `(id, author, date)` triple; multi-site entries collapse to one
- [ ] Click → scroll-to-block via `data-revision-id`
- [ ] Accept / Reject buttons → `acceptChangeById` / `rejectChangeById`

### i18n (all 7 locales)

- [ ] Add all **15** keys to `packages/i18n/en.json` (with English values for those Phase 1 actually uses; placeholder strings for Phase 2/3 keys so `i18n:validate` is green):
  - `revisions.paragraphMarkInserted`, `revisions.paragraphMarkDeleted`, `revisions.paragraphPropertiesChanged`, `revisions.paragraphMarkPropertiesChanged`, `revisions.sectionPropertiesChanged`, `revisions.runPropertiesChanged`, `revisions.rowInserted`, `revisions.rowDeleted`, `revisions.rowPropertiesChanged`, `revisions.cellInserted`, `revisions.cellDeleted`, `revisions.cellMerged`, `revisions.cellPropertiesChanged`, `revisions.tablePropertiesChanged`, `revisions.tableGridChanged`
- [ ] `bun run i18n:fix` to mirror null entries into de, he, pl, pt-BR, tr, zh-CN

### Vue parity

- [ ] Verify painter changes inherit transparently (changes are in `packages/core/src/painter-model/`)
- [ ] Mirror sidebar wiring in `packages/vue/src/`
- [ ] Update `scripts/parity/parity.contract.json` with new `DocxEditorRef` methods (paired bucket)

### Agents package

- [ ] Decide: extend `packages/agents/src/changes.ts` to handle `paragraph.pPrIns`/`pPrDel`/`pPrChange` and section revisions, OR open tracking issue for deferred support
- [ ] If extending: update agents API snapshot (`bun run api:extract`)

### Tests

- [ ] Fixtures in `packages/core/src/docx/__tests__/fixtures/tracked-structural/`: minimal `<w:pPr><w:rPr><w:ins/>` and `<w:del/>` DOCX, `pPrChange` DOCX, `paraRPrChange` DOCX, `sectPrChange` (pPr-level and body-level) DOCX
- [ ] Add `assertOoxmlEquivalent(a, b)` helper using canonical XML comparison
- [ ] Parser round-trip tests per fixture (parse → re-serialize → assert semantically equivalent)
- [ ] Conversion unit tests in `packages/core/src/__tests__/conversion/` — Document ↔ PM, including array-shaped attrs
- [ ] Playwright: `packages/react/src/__tests__/playwright/tracked-changes-structural.spec.ts` — Enter in suggesting mode produces `pPrIns`; Backspace/Delete produce `pPrDel`; accept clears; reject reverses; last-paragraph and first-paragraph edge cases
- [ ] Playwright: open fixture with structural revisions, save, reopen — markers preserved
- [ ] Required regression: `comments-sidebar.spec.ts` (per CLAUDE.md, sidebar files are touched)
- [ ] `bun run typecheck && bun run i18n:validate && bun run check:parity-contract && bun run api:check && bun run format`

### Release

- [ ] `bun changeset` — minor bump (additive API)

---

## Phase 2 — Table-row and cell revisions

### Schema

- [ ] Add `trIns`, `trDel`, `trPrChange[]`, `tblPrExChange[]` (per-row) to `table_row` node
- [ ] Add `cellMarker` (`{ kind: 'ins' | 'del' | 'merge', info, vMerge?, vMergeOrig? }` discriminated union, mutually exclusive per schema), `tcPrChange[]` to `table_cell` node
- [ ] Add `tblPrChange[]`, `tblGridChange` (id-only, no author/date) to `table` node

### Parser

- [ ] `tableParser.ts` — read `<w:trPr><w:ins/>` / `<w:del/>` (currently not read)
- [ ] Wire existing parses of `trPrChange`, `cellIns`, `cellDel`, `cellMerge` (vertical only — `vMerge`/`vMergeOrig`, no `val` attribute), `tcPrChange`, `tblPrChange`, `tblGridChange` to model fields
- [ ] **Relocate `tblPrExChange` from table-level to row-level** model storage

### Conversion

- [ ] `toProseDoc/table.ts` — map every table revision to attrs
- [ ] `fromProseDoc/table.ts` — inverse
- [ ] `extractTrackedChanges.ts` extends to walk table attrs

### Cache key

- [ ] `hashTableBlock` (or equivalent) — extend to include revision attrs

### ContentNode plumbing

- [ ] `buildBoxTree` — pass table revision attrs through to `TableBlock.attrs`

### Serializer

- [ ] `tableSerializer.ts` — emit `<w:trPr><w:ins/>` / `<w:del/>` and all `*Change` markers
- [ ] Emit `<w:cellIns/>`, `<w:cellDel/>` from `cellMarker.kind === 'ins' | 'del'`
- [ ] Emit `<w:cellMerge w:vMerge="rest|cont"/>` from `cellMarker.kind === 'merge'` (**NOT `w:val`**); include `vMergeOrig` if present
- [ ] Emit `<w:tblGridChange w:id="…"/>` **id only** — do not emit `w:author` or `w:date` (schema rejects)
- [ ] Move `<w:tblPrExChange>` emission to per-row position

### Suggesting-aware table commands

- [ ] `extensions/nodes/TableExtension.ts` — `addRow` sets `trIns` and `cellMarker: ins` on new cells
- [ ] `deleteRow` sets `trDel` and `cellMarker: del` on the row's cells rather than removing
- [ ] `addColumn` sets `cellMarker: ins` on each new cell
- [ ] `deleteColumn` sets `cellMarker: del` on each affected cell
- [ ] `mergeCells` horizontal: set `cellMarker: ins` on the merging cell and `cellMarker: del` on absorbed cells (matches Word's on-disk convention; no horizontal `cellMerge` element exists)
- [ ] `mergeCells` vertical: set `cellMarker: { kind: 'merge', vMerge: 'rest' }` on the top cell and `cellMarker: { kind: 'merge', vMerge: 'cont' }` on each cell below
- [ ] `splitCells` clears the relevant `cellMarker` entries
- [ ] Wrap table/row/cell property commands with `withSuggestingSnapshot`

### Accept / Reject

- [ ] Per-marker semantics from design table for every table revision
- [ ] Resolution order: cell-level → row-level → table-level
- [ ] Cell-content reconciliation on horizontal merge accept: surviving cell keeps its content; absorbed cells' content is concatenated as additional paragraphs at the end of the surviving cell's content (spec'd in `tracked-structural-tables/spec.md`)
- [ ] `trDel` accept on the only row of a table: remove the table node
- [ ] `cellMarker` mutual exclusion: authoring `ins` on a cell that already has `ins` is a no-op; authoring `del` on a cell that has `ins` from the same `(id, author, date)` clears both (insert-then-delete collapse)

### Painter

- [ ] `packages/core/src/painter-model/renderTable.ts` — colored border on revised rows/cells, change bar, strikethrough for deletions
- [ ] Dashed boundary for unaccepted vertical `cellMerge`
- [ ] `data-revision-id`, `data-revision-author`, `data-revision-date` on all revision DOM

### Sidebar

- [ ] Item builders for `trIns`, `trDel`, `trPrChange`, `cellMarker` (ins/del/merge), `tcPrChange`, `tblPrChange`, `tblPrExChange`, `tblGridChange`
- [ ] Multi-site grouping: a row insertion with N inserted cells under one `(id, author, date)` is one entry, not N+1
- [ ] i18n keys for table kinds (already stubbed in Phase 1)

### Vue parity

- [ ] Painter inherits transparently from core
- [ ] Mirror any new sidebar item builders in Vue

### Agents package

- [ ] Extend or defer (per Phase 1 decision); if extending, handle table revision attrs

### Tests

- [ ] Fixtures per marker type in `packages/core/src/docx/__tests__/fixtures/tracked-structural/`
- [ ] Parser round-trip tests
- [ ] Conversion unit tests
- [ ] Playwright: add/delete row, add/delete column, horizontal/vertical merge in suggesting mode
- [ ] Playwright: open fixture with table revisions, save, reopen
- [ ] Single-row delete-row accept removes table node
- [ ] Accept/reject coverage for each marker
- [ ] `comments-sidebar.spec.ts` regression

### Release

- [ ] `bun changeset` — minor bump

---

## Phase 3 — Run-level property revisions (`revision_change` mark)

### Schema

- [ ] New `revision_change` mark in `TrackedChangeExtensions.ts` with attrs `{ revisionId, author, date, prior: RunFormatting }` — **run only**, NOT for paragraph-mark rPr changes
- [ ] Canonicalize `prior`: sort keys, `Object.freeze`, allow shared references for adjacency

### Parser / Serializer / Conversion

- [ ] Wire run `rPrChange` from existing model field into `revision_change` mark via `toProseDoc/run.ts`
- [ ] `fromProseDoc/run.ts` — inverse
- [ ] Confirm `rPrChange` emission path works end-to-end and respects `<w:rPr>` last-child ordering (already enforced in Phase 1)
- [ ] `findAdjacentRevision` in `suggestionMode.ts` extended to deep-compare `revision_change` attrs for span coalescing

### Suggesting-aware run-property commands

- [ ] `toggleBold` / `toggleItalic` / `toggleUnderline` / `setFont` / `setFontSize` / `setColor` / `setHighlight` / `toggleStrike` / `toggleSubscript` / `toggleSuperscript` — snapshot prior `rPr` of affected runs and apply `revision_change` mark via `withSuggestingSnapshot`
- [ ] Per-(id, author, date) freeze-on-first-edit semantics
- [ ] Clear `revision_change` if all snapshotted fields equal current

### Accept / Reject

- [ ] `revision_change` accept: remove mark
- [ ] `revision_change` reject: restore prior `rPr` to the run, remove mark
- [ ] `pPrChange` / `tcPrChange` / `trPrChange` / `tblPrChange` / `tblPrExChange` / `tblGridChange` / `paraRPrChange` reject: restore prior via `restorePriorProperties` (Phase 1 utility)

### Painter

- [ ] `revision_change` mark renders with class `ep-revision-change` in `editor.css` (subtle wavy underline or background tint; exact CSS value with design)

### Sidebar

- [ ] Sidebar entries name the changed property: "Bold added", "Font changed from Calibri to Times New Roman, 11pt to 12pt"
- [ ] i18n keys already stubbed in Phase 1; Phase 3 fills English values for run-property descriptions

### Vue parity

- [ ] Mirror

### Tests

- [ ] Fixtures for `rPrChange` with prior rPr containing various properties
- [ ] Conversion unit tests
- [ ] Playwright: toggle bold in suggesting mode → `revision_change` mark appears; accept removes; reject restores prior
- [ ] Round-trip with mixed property changes
- [ ] Property-based test: apply N random formatting ops, accept-all should equal applying ops without tracking; reject-all leaves doc unchanged
- [ ] `comments-sidebar.spec.ts` regression

### Release

- [ ] `bun changeset` — minor bump
- [ ] Final `bun run api:extract`

---

## Deferred (out of scope for this change)

- [ ] `<w:moveFrom>` / `<w:moveTo>` / move-range markers — model exists, conversion drops them. Separate change.
- [ ] `<w:numPr><w:ins/>` — list-item-assignment revisions (`<w:numberingChange>` is not in `wml.xsd`). Separate change.
- [ ] `<w:customXml*RangeStart/End>` — parser preserves as opaque only.
- [ ] Collaboration / Yjs integration with `feat/controlled-comments-collab` — non-goal; separate effort.
- [ ] `w:authorId` modeling — non-goal; sidebar dedup by display name only.
- [ ] NodeView virtualization of `pPrDel` boundary for "deferred join feels joined" UX — follow-up issue.

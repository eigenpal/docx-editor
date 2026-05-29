## Why

Track changes in the editor today covers only inline text (insertions and deletions of characters wrapped in `<w:ins>` / `<w:del>`). Every other category of revision that Word produces is silently lost.

This bites in two directions:

- **Round-trip data loss.** A file that comes in with structural revisions (new paragraphs, deleted rows, reformatted cells, changed margins, prior formatting state) opens with that history stripped. The DOCX parser actually reads several of these markers into the `Document` model — `w:pPrChange`, `w:rPrChange`, `w:trPrChange`, `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:tblPrChange`, `w:tblPrExChange`, `w:tblGridChange` — but `toProseDoc` has no schema attrs to put them on, so they evaporate. The serializer would happily write them back if they survived.
- **No way to author a structural change.** With suggesting mode on, pressing Enter mid-paragraph splits the paragraph silently. Pressing Backspace at the start of a paragraph joins it silently. Inserting or deleting a table row, merging cells, or changing a paragraph's alignment all happen as untracked edits even though the editor is in suggesting mode. The only thing that actually tracks is character typing.

GitHub issue #614 reports the second symptom. The first is a quieter, larger source of bug reports.

## What Changes

Add Word-parity coverage of OOXML structural and property revisions, end-to-end: schema, parser, serializer, suggesting-mode keymap, accept/reject, painter, review sidebar.

### Schema (PM nodes)

- **`paragraph` node** — new attrs `pPrIns`, `pPrDel`, `pPrChange[]`, `paraRPrChange[]` (for `CT_ParaRPrChange`, distinct from the run-rPrChange path), `sectPrChange`, `sectPrChangeBodyLevel`.
- **`table_row` node** — new attrs `trIns`, `trDel`, `trPrChange[]`, `tblPrExChange[]` (per-row exception changes; previously misplaced at table level in earlier drafts).
- **`table_cell` node** — new attr `cellMarker` (discriminated union: `'ins' | 'del' | 'merge'`, all mutually exclusive per schema; `merge` carries `vMerge`/`vMergeOrig` for vertical-merge tracking), `tcPrChange[]`.
- **`table` node** — new attrs `tblPrChange[]`, `tblGridChange` (note: `CT_TblGridChange` extends `CT_Markup`, **id-only — no `w:author` / `w:date`**).
- **Inline `revision_change` mark** — for run-level `w:rPrChange` only. Paragraph-mark `CT_ParaRPrChange` uses the `paraRPrChange` paragraph attr instead.

Revision attrs that can stack from multiple authors are **arrays** (`pPrChange[]` etc.), matching the existing `Paragraph.propertyChanges: ParagraphPropertyChange[]` model.

All revision attrs carry the OOXML triple: `{ revisionId: number; author: string; date: string | null }`. `revisionId` is `number` to match OOXML `w:id` (decimal integer) and the existing model/agents-package signatures. `date` is ISO 8601 UTC with `Z` suffix; `null` if `w:date` is absent (it is optional in the schema).

Prior-state attrs (`*Change`) carry a **full frozen snapshot** of the prior `*Base` schema type (e.g. `pPrChange.prior: CT_PPrBase`, not `CT_PPr` — so prior cannot itself nest `rPr`, `sectPr`, or further changes). The snapshot is frozen on first edit per `(id, author, date)` session. After each subsequent edit, if all snapshotted fields equal current values, the change is cleared (Word's "no-op net change ⇒ no revision" behavior).

### Identity and grouping

Sidebar entries and `acceptChangeById` resolution group by the **triple `(w:id, w:author, w:date)`**, not bare id. OOXML does not enforce id uniqueness across authors, so collisions are possible and must not silently merge.

### Parser

`packages/core/src/docx/paragraphParser/properties.ts` learns to read paragraph-mark insertions and deletions from `<w:pPr><w:rPr><w:ins/>` / `<w:del/>`, and `CT_ParaRPrChange` (the paragraph-mark formatting change, distinct from the run rPrChange element). Section parsing reads `<w:sectPrChange>` at both `pPr/sectPr` and body-level placements. Existing parsing of `pPrChange`, `rPrChange`, `trPrChange`, `tcPrChange`, `cellIns`, `cellDel`, `cellMerge`, `tblPrChange`, `tblPrExChange` (which is per-row, not per-table), `tblGridChange` is wired through to `toProseDoc`. `extractTrackedChanges` is extended to walk node attrs in addition to text marks.

### Conversion

`packages/core/src/prosemirror/conversion/toProseDoc/*` maps every model-level revision onto the new PM attrs (or `revision_change` mark for run rPrChange). `fromProseDoc` does the inverse, so a no-op round-trip preserves byte-identical revision metadata under canonical XML comparison.

### Suggesting mode

`packages/core/src/prosemirror/plugins/suggestionMode.ts` extends to cover every structural edit. The Enter handler **composes with** the existing `splitBlockClearBorders` in `BaseKeymapExtension` (which copies style attrs and clears borders) — it calls into that helper, then sets `pPrIns` on the first paragraph of the resulting split. Replacing rather than composing would regress paragraph-style inheritance.

- **Enter mid-paragraph** — split via `splitBlockClearBorders`, set `pPrIns` on the _first_ paragraph (normative).
- **Backspace at paragraph start** / **Delete at paragraph end** — set `pPrDel` on the paragraph being deleted; defer the actual merge to "accept".
- **Insert table row / column** — set `trIns` / `cellMarker: ins`.
- **Delete table row / column** — set `trDel` / `cellMarker: del`.
- **Vertical cell merge** — set `cellMarker: { kind: 'merge', vMerge: 'rest' | 'cont' }` on the involved cells.
- **Horizontal cell merge** — `cellMarker: ins` on the merging cell and `cellMarker: del` on each absorbed cell (matching Word's actual on-disk convention; `cellMerge` only encodes vertical).
- **Change paragraph / run / table / cell / section properties** — snapshot prior props, set the appropriate `*Change` attr; clear if subsequent edits revert to prior values.

A small `withSuggestingSnapshot(commandImpl, snapshotter)` helper applied at each property-command site centralizes the snapshot-on-first-edit logic (new infrastructure; lands in Phase 1).

### Accept / Reject

`acceptChange` / `rejectChange` / `acceptAll` / `rejectAll` (in `packages/core/src/prosemirror/commands/comments.ts`) are extended to operate on node attrs as well as inline marks. New commands:

- `acceptChangeById(revisionId: number)` / `rejectChangeById(revisionId: number)` — resolve all sites sharing a `(id, author, date)` triple in one PM transaction.
- `acceptChangesInRange(from, to)` / `rejectChangesInRange(from, to)` — range-scoped variants.

`acceptAll` / `rejectAll` return the count of **distinct triples** resolved, not the count of marker sites. Accept/reject of an unknown or already-resolved id returns `false` (idempotent no-op).

Resolution order within `acceptAll` / `rejectAll`: inline → run-property marks → paragraph-property → paragraph-mark → cell-level → row-level → table-level → section-level. Inner-to-outer.

### Schema-mandated child ordering

Three serializer rules MUST be enforced or output is rejected by strict readers:

- `<w:rPrChange>` is the **last** child of `<w:rPr>`.
- `<w:pPrChange>` is the **last** child of `<w:pPr>`.
- Inside `<w:pPr><w:rPr>`, the `EG_ParaRPrTrackChanges` group (`ins`, `del`, `moveFrom`, `moveTo`) appears **first**, before regular properties.

### Painter

`packages/core/src/layout-painter/renderParagraph.ts` and `renderTable.ts` are the canonical painter (per CLAUDE.md). Both React and Vue inherit. Cues:

- Vertical change bar in the page margin for any block carrying a structural revision attr.
- Pilcrow glyph at the end of paragraphs with `pPrIns` (insert color) or `pPrDel` (delete color, strike).
- Colored borders + change bar on rows/cells with `trIns` / `trDel` / `cellMarker`.
- Dashed boundary for unaccepted vertical `cellMerge`.

Inline `revision_change` marks render with class `ep-revision-change`. The existing insertion / deletion mark styles are unchanged.

All revision DOM carries `data-revision-id`, `data-revision-author`, `data-revision-date` for sidebar grouping.

### Cache key

`paragraphCacheKey` in `packages/core/src/layout-bridge/measuring/cache.ts` MUST include the new revision-presence flags. Without this, two paragraphs with identical text and different `pPrIns` would share a cached measurement — a cross-document paint bug.

### Review sidebar

`UnifiedSidebar.tsx` + `useCommentSidebarItems.tsx` + `extractTrackedChanges.ts` grow entries for every structural revision, grouped by `(id, author, date)`. Each entry: kind label (i18n), short description, click-to-block via `data-revision-id`, Accept/Reject buttons routed to `acceptChangeById` / `rejectChangeById`.

### FlowBlock invariant

No new `FlowBlock` variants. The structural attrs ride on existing block nodes. `buildBoxTree` plumbs the new attrs into `ParagraphBlock.attrs` so measurement is consistent with the cache key.

## Capabilities

### New Capabilities

- **`tracked-structural-paragraphs`** — paragraph-mark insert/delete (`pPrIns`/`pPrDel`), `pPrChange`, `paraRPrChange`, `sectPrChange`; suggesting-mode handlers for split/join/property-change; accept/reject semantics; painter cues.
- **`tracked-structural-tables`** — row/cell insert/delete (`trIns`/`trDel`/`cellMarker`), vertical merge tracking, `trPrChange`/`tcPrChange`/`tblPrChange`/`tblPrExChange`/`tblGridChange`; suggesting-mode handlers; accept/reject; painter cues.
- **`tracked-property-revisions`** — `pPrChange`, run `rPrChange` (as inline `revision_change` mark), `paraRPrChange`; prior-state snapshot storage and freeze-on-first-edit semantics; reject-restores semantics.
- **`tracked-changes-review`** — sidebar entries grouped by `(id, author, date)`, `acceptChangeById` / `rejectChangeById` / `acceptChangesInRange` / `rejectChangesInRange`, accept-all/reject-all coverage.

### Modified Capabilities

- The existing inline tracked-change feature (`InsertionExtension` / `DeletionExtension`) is unchanged in spec but the accept/reject command surface is widened to also resolve node-level attrs. `acceptAll` / `rejectAll` return-value definition is changed (count of distinct triples vs. count of sites) — see `tracked-changes-review/spec.md`.

## Impact

- **Schema** — additive only. Existing documents load without migration; new attrs default to `null`. Public API snapshot regenerates (`bun run api:extract`).
- **Vue parity** — painter changes inherit via `packages/core/src/layout-painter/`. Suggestion-mode keymap is in `packages/core/`. Vue work is sidebar wiring only.
- **Public API** — `acceptChange` / `rejectChange` / `acceptAll` / `rejectAll` signatures unchanged. New methods on `DocxEditorRef`: `acceptChangeById`, `rejectChangeById`, `acceptChangesInRange`, `rejectChangesInRange`. New public fields on `ParagraphAttrs`, `TableAttrs`, `TableRowAttrs`, `TableCellAttrs` (all currently `@public`).
- **Backwards compatibility** — no breaks. Files with no structural revisions are byte-identical on round-trip under canonical XML comparison. Files with structural revisions stop losing them.
- **Agents package** — Phase 1 extends `packages/agents/src/changes.ts` to handle new structural-revision fields, or explicitly defers with a tracking issue. Decision recorded in `tasks.md`.
- **i18n** — 15 new keys mirrored across all 7 locales (`bun run i18n:fix`).
- **Test surface** — fixtures live in `packages/core/src/docx/__tests__/fixtures/tracked-structural/`. Playwright in `packages/react/src/__tests__/playwright/tracked-changes-structural.spec.ts`. `comments-sidebar.spec.ts` is a required regression every phase.
- **Phasing** — three landable PRs (see `tasks.md`): paragraph-mark + sectPr + snapshot-and-restore infra (the issue #614 fix), then tables, then run-level property revisions.

## Non-goals

- Collaboration / multi-author conflict resolution. The design is single-user. Coordinating with `feat/controlled-comments-collab` is a separate effort.
- `w:authorId` modeling — sidebar dedup is by display name only. Two distinct users sharing "Jane" merge in the sidebar.
- `<w:moveFrom>` / `<w:moveTo>` move-range markers and `<w:numPr><w:ins/>` numbering revisions — Tier 2, deferred to a separate change.
- `<w:customXml*RangeStart/End>` — Tier 3, parser preserves as opaque only.

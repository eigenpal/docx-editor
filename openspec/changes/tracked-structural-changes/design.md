# Design: Tracked Structural Changes

## OOXML reference

Most structural revision markers carry the attribute triple `w:id` (required, `xsd:int`), `w:author` (required, `xsd:string` display name), `w:date` (optional, `xsd:dateTime`). The schema-level base is `CT_TrackChange` (`wml.xsd:805`). A few exceptions extend `CT_Markup` instead and carry **only `w:id`**:

- `<w:tblGridChange>` (`CT_TblGridChange`, extends `CT_Markup`, `wml.xsd:893`) — id only.

Per-marker prior-state elements (`*Change`) carry a **full prior snapshot**, not a diff. The schema base of each prior element is a `*Base` type (e.g. `pPrChange` contains `CT_PPrBase`, not `CT_PPr`), so the prior **cannot** itself nest `rPr`, `sectPr`, or a further `*Change`.

### Schema-mandated child ordering inside `<w:rPr>` and `<w:pPr>`

The serializer MUST honor these orderings or Word and strict readers will reject the output:

- Inside a run `<w:rPr>` (per `EG_RPrContent`, `wml.xsd:1784`): regular base properties first, **`<w:rPrChange>` last**.
- Inside a paragraph-mark `<w:pPr><w:rPr>` (per `EG_ParaRPrTrackChanges`, `wml.xsd:1837`): `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>` **first** (in that order), then base properties, then `<w:rPrChange>` last.
- Inside `<w:pPr>` (per `CT_PPr`, `wml.xsd:1044`): base properties first, **`<w:pPrChange>` last**.
- Inside `<w:tcPr>`, `<w:trPr>`: structural change elements appear in `EG_CellMarkupElements` / `EG_TrackChange` positions per `wml.xsd:977,2330`; the `*Change` snapshot variants appear last.

### `cellMerge` is vertical-merge tracking, not horizontal

`CT_CellMergeTrackChange` (`wml.xsd:811`) extends `CT_TrackChange` with **`vMerge`** and **`vMergeOrig`** attributes of type `ST_AnnotationVMerge` (values `cont`, `rest`). There is **no `val` attribute** and there is no horizontal-merge dimension in this element. **Horizontal merge** tracking in Word is conveyed by `<w:cellIns>` on the merging cell and `<w:cellDel>` on each absorbed cell (the absorbed cells remain in the row XML until the merge is accepted; on accept they are removed and the surviving cell's `gridSpan` is increased).

### Distinct paragraph-mark rPr change

`CT_ParaRPrChange` (`wml.xsd:938`) is a **separate element** from `CT_RPrChange` (the regular run rPr change). It tracks changes to the formatting of the paragraph-mark glyph itself ("the paragraph mark used to be bold"), and lives at the **end of `CT_ParaRPr`** (i.e. `<w:pPr><w:rPr><w:rPrChange>` uses `CT_ParaRPrChange`, not `CT_RPrChange`). Wiring it to the inline `revision_change` mark would write to the wrong schema position. It needs its own paragraph-node attr.

### Tier 1 — MUST support for round-trip without data loss

| Marker                                                | Location                                                                       | Tracks                                                             | Currently parsed                        | Currently serialized       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------- | -------------------------- |
| `<w:ins>` / `<w:del>` wrapping runs                   | inside `<w:p>`                                                                 | inline insert/delete                                               | yes (mark)                              | yes                        |
| `<w:pPr><w:rPr><w:ins/>`                              | inside `<w:pPr><w:rPr>`                                                        | paragraph-mark inserted                                            | **no**                                  | no                         |
| `<w:pPr><w:rPr><w:del/>`                              | inside `<w:pPr><w:rPr>`                                                        | paragraph-mark deleted                                             | **no**                                  | no                         |
| `<w:pPrChange>`                                       | last child of `<w:pPr>`                                                        | prior paragraph props (full snapshot, frozen)                      | yes (model only, dropped at toProseDoc) | yes (only if model has it) |
| `<w:rPrChange>` (run)                                 | last child of `<w:rPr>`                                                        | prior run props (full snapshot, frozen)                            | yes (model only, dropped)               | yes (only if model has it) |
| `<w:rPrChange>` (paragraph-mark, `CT_ParaRPrChange`)  | last child of `<w:pPr><w:rPr>`                                                 | prior paragraph-mark rPr                                           | **no (separate code path)**             | no                         |
| `<w:sectPrChange>`                                    | last child of `<w:sectPr>` (both body-level and `pPr/sectPr` placements legal) | prior section props                                                | **no**                                  | no                         |
| `<w:trPr><w:ins/>`                                    | inside `<w:trPr>`                                                              | row inserted                                                       | **no**                                  | no                         |
| `<w:trPr><w:del/>`                                    | inside `<w:trPr>`                                                              | row deleted                                                        | **no**                                  | no                         |
| `<w:trPrChange>`                                      | child of `<w:trPr>`                                                            | prior row props                                                    | yes (model only, dropped)               | yes (only if model has it) |
| `<w:tcPr><w:cellIns/>`                                | inside `<w:tcPr>` (choice, exclusive)                                          | cell inserted                                                      | yes (model only, dropped)               | no                         |
| `<w:tcPr><w:cellDel/>`                                | inside `<w:tcPr>` (choice, exclusive)                                          | cell deleted (and used to mark cells absorbed by horizontal merge) | yes (model only, dropped)               | no                         |
| `<w:tcPr><w:cellMerge vMerge=…>`                      | inside `<w:tcPr>` (choice, exclusive)                                          | vertical cell merge                                                | yes (model only, dropped)               | no                         |
| `<w:tcPrChange>`                                      | child of `<w:tcPr>`                                                            | prior cell props                                                   | yes (model only, dropped)               | no                         |
| `<w:tblPrChange>`                                     | child of `<w:tblPr>`                                                           | prior table props                                                  | yes (model only, dropped)               | no                         |
| `<w:tblPrExChange>`                                   | child of `<w:tblPrEx>` **inside `<w:tr>`** (per-row exceptions)                | prior table-exception props for this row                           | yes (model only, dropped)               | no                         |
| `<w:tblGridChange>` (`CT_TblGridChange`, **id only**) | child of `<w:tblGrid>`                                                         | prior grid (column widths)                                         | yes (model only, dropped)               | no                         |

### Tier 2 — SHOULD support (covered later)

| Marker                                                                     | Location           | Tracks                                                             |
| -------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `<w:moveFrom>` / `<w:moveTo>`                                              | wrap runs          | block move source / destination                                    |
| `<w:moveFromRangeStart/End>`                                               | inline             | move-source span anchors                                           |
| `<w:moveToRangeStart/End>`                                                 | inline             | move-target span anchors                                           |
| `<w:numPr><w:ins/>` (in schema; `<w:numberingChange>` is NOT in `wml.xsd`) | inside `<w:numPr>` | list-item assignment inserted (no `numPr/del` exists — limitation) |

### Tier 3 — NICE-TO-HAVE (out of scope)

`<w:customXmlInsRangeStart/End>` and its variants (parser SHOULD at minimum round-trip them as opaque to avoid stripping third-party tracking).

### Identity and grouping

Sidebar entries and `acceptChangeById` resolution group by the **triple `(w:id, w:author, w:date)`**, not bare `w:id`. The schema does not enforce id uniqueness and Word does not scope ids by author, so id collisions across authors are possible.

### Accept / Reject behavior

Per-marker semantics. Word's behavior is the reference (sources cited in research notes accompanying this proposal).

| Marker                                                                                                           | Accept                                                                                                 | Reject                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| inline `w:ins`                                                                                                   | keep text, drop wrapper                                                                                | remove text and wrapper                                                                                      |
| inline `w:del`                                                                                                   | remove text and wrapper                                                                                | keep text, drop wrapper                                                                                      |
| `pPr/rPr/ins` (paragraph-mark ins, on first paragraph of the split)                                              | clear marker, keep split                                                                               | join this paragraph with next; **resulting paragraph inherits the _second_ paragraph's `pPr`**; clear marker |
| `pPr/rPr/del` (paragraph-mark del)                                                                               | join this paragraph with next; resulting paragraph inherits the second paragraph's `pPr`; clear marker | clear marker, keep split                                                                                     |
| `pPrChange`                                                                                                      | clear `pPrChange`, current props win                                                                   | restore full prior `pPr` snapshot, clear `pPrChange`                                                         |
| `rPrChange` (run)                                                                                                | clear, current rPr wins                                                                                | restore full prior `rPr` snapshot, clear                                                                     |
| `paraRPrChange` (paragraph-mark)                                                                                 | clear, current paragraph-mark rPr wins                                                                 | restore full prior paragraph-mark rPr, clear                                                                 |
| `sectPrChange`                                                                                                   | clear, current section props win                                                                       | restore full prior `sectPr`, clear                                                                           |
| `trPr/ins`                                                                                                       | clear marker                                                                                           | delete row                                                                                                   |
| `trPr/del`                                                                                                       | delete row                                                                                             | clear marker                                                                                                 |
| `trPrChange`                                                                                                     | clear                                                                                                  | restore prior `trPr`, clear                                                                                  |
| `cellIns`                                                                                                        | clear marker                                                                                           | delete cell (and adjust `gridSpan`)                                                                          |
| `cellDel`                                                                                                        | delete cell (and adjust `gridSpan` of surviving cells)                                                 | clear marker                                                                                                 |
| `cellMerge` (vertical, `vMerge`/`vMergeOrig` pair on adjacent rows' cells sharing a `(id, author, date)` triple) | apply the vertical merge                                                                               | clear markers                                                                                                |
| `tcPrChange`                                                                                                     | clear                                                                                                  | restore prior `tcPr`, clear                                                                                  |
| `tblPrChange` / `tblPrExChange` (per-row)                                                                        | clear                                                                                                  | restore prior, clear                                                                                         |
| `tblGridChange` (id-only)                                                                                        | clear                                                                                                  | restore prior `<w:tblGrid>`, clear                                                                           |

#### Edge cases

- `pPrIns` reject on the **last paragraph in the document** has no following sibling to join with. Behavior: clear attr without joining, log a diagnostic, return `true`.
- `pPrDel` accept on the **first paragraph** has no previous sibling. Behavior: clear attr without joining, log a diagnostic, return `true`. (Word emits this rarely; conformance still requires it.)
- `trDel` accept on the **only row** of a table leaves the table with zero rows, which is invalid per PM schema. Behavior: accept removes the entire table node.
- `cellIns` / `cellDel` / `cellMerge` on the same cell are mutually exclusive per `EG_CellMarkupElements` (`wml.xsd:977`). Authoring a second on a cell that already carries one collapses both (insert-then-delete in the same session ⇒ no marker; insert-then-merge ⇒ keep only the more recent).
- Adjacent paragraphs each carrying `pPrIns`: rejecting either is per-id, and "join with following" uses the post-acceptance position, not the original (so rejecting in id-order is well-defined).

## PM schema additions

All revision attrs use the shape:

```ts
type RevisionInfo = {
  revisionId: number; // matches OOXML w:id (xsd:int)
  author: string; // display name from w:author
  date: string | null; // ISO 8601 UTC ("…Z"), null if w:date absent
};

type PropertyChangeInfo<P> = RevisionInfo & {
  prior: P; // full frozen snapshot; not field-merged
};
```

`revisionId` is a `number` to match (a) OOXML `w:id` (decimal integer), (b) the existing `InsertionExtension` / `DeletionExtension` mark attrs in `TrackedChangeExtensions.ts`, (c) the existing agents-package `acceptChange(id: number)` signature in `packages/agents/src/changes.ts`.

`date` is normatively ISO 8601 with explicit `Z` (UTC) and no fractional seconds; the parser accepts any valid `xsd:dateTime` and normalizes; missing `w:date` is tolerated as `null`.

`prior` for `pPrChange` is the parsed `ParagraphFormatting` snapshot **without** `_originalFormatting`, `_sectionProperties`, or any nested change. `prior` is **frozen on first edit** within a (id, author, date) revision session and never updated by subsequent edits in the same session. After every edit, the implementation compares the resulting current properties against `prior`; if **all** prior fields equal current, the `*Change` attr is cleared (Word's "no-op net change ⇒ no revision" behavior).

### Relationship to existing `_originalFormatting` attrs

`ParagraphAttrs._originalFormatting` (and the `TableAttrs` / `TableCellAttrs` counterparts) already exists in `packages/core/src/prosemirror/schema/nodes.ts`. Its purpose is **parse-time baseline preservation** so unhandled OOXML round-trips losslessly. `pPrChange.prior` is **edit-time pre-snapshot** for revision tracking — a different lifecycle. The two coexist and never overwrite each other. On save, the serializer reads `_originalFormatting` for fields the editor doesn't model and `pPrChange.prior` for tracked-change history; both are emitted in their respective XML positions.

### Multi-author / multi-session changes per node

Existing model types (`Paragraph.propertyChanges: ParagraphPropertyChange[]`) treat property changes as an **array**: two authors editing the same paragraph stack changes. To preserve this, the new attrs are arrays:

```ts
// ParagraphAttrs additions
pPrIns: RevisionInfo | null;
pPrDel: RevisionInfo | null;
pPrChange: (PropertyChangeInfo < ParagraphFormatting > []) | null;
paraRPrChange: (PropertyChangeInfo < ParagraphMarkFormatting > []) | null;
sectPrChange: PropertyChangeInfo<SectionFormatting> | null;
sectPrChangeBodyLevel: boolean | null; // true if the sectPr is body-level rather than pPr-level
```

`pPrIns` and `pPrDel` remain single-valued (only one author can be "the one who inserted" a given paragraph mark).

### `table` / `table_row` / `table_cell` node — additions

```ts
// table
tblPrChange:   PropertyChangeInfo<TableFormatting>[] | null
tblGridChange: PropertyChangeInfoNoAuthor<TableGrid> | null   // CT_Markup: id only

// table_row
trIns:           RevisionInfo | null
trDel:           RevisionInfo | null
trPrChange:      PropertyChangeInfo<TableRowFormatting>[] | null
tblPrExChange:   PropertyChangeInfo<TablePropertyExceptions>[] | null

// table_cell (cellIns / cellDel / cellMerge are mutually exclusive per schema)
cellMarker:    | { kind: 'ins',   info: RevisionInfo }
               | { kind: 'del',   info: RevisionInfo }
               | { kind: 'merge', info: RevisionInfo, vMerge: 'rest' | 'cont', vMergeOrig?: ... }
               | null
tcPrChange:    PropertyChangeInfo<TableCellFormatting>[] | null
```

`PropertyChangeInfoNoAuthor<P>` is `{ revisionId: number; prior: P }` for the `CT_Markup`-extending change types (only `tblGridChange`). Sidebar entries for these display "Unknown" for author/date.

### New `revision_change` mark (for run rPrChange only)

```ts
revisionChange: {
  attrs: { revisionId, author, date, prior: RunFormatting }
  inclusive: false
}
```

Used **only** for run-level `<w:rPrChange>`. The paragraph-mark `CT_ParaRPrChange` does NOT use this mark — it uses the paragraph node's `paraRPrChange` attr.

**Mark identity / merging:** PM `Mark.eq` compares attr objects by reference. To allow adjacent runs that share a revision to render as a single span, `prior` is canonicalized at creation: keys are deterministically sorted, and the resulting object is `Object.freeze`d. A shared `prior` reference is reused when possible. `findAdjacentRevision` in `suggestionMode.ts` is extended to deep-compare `revision_change` attrs for adjacency.

## Cache key updates

`paragraphCacheKey` (`packages/core/src/flow-model/metrics/cache.ts`) keys paragraph measurements by a fixed allowlist of attrs (text, alignment, indent, spacing, default font, borders, suppress flag). Adding the new revision attrs without updating this hash would cause **cross-doc cache bleed**: two paragraphs with identical text and different `pPrIns` would share an entry. The hash MUST include:

- `pPrIns` / `pPrDel` presence (any non-null pulls a discriminator into the key — a struck/inserted pilcrow takes width).
- `pPrChange` / `paraRPrChange` presence (margin change bar).
- Any `revision_change` mark on the paragraph's runs (subtle paint cue).
- `sectPrChange` presence (gutter cue).

Equivalent updates apply to `hashTableBlock` if it exists (verify at implementation), and to whatever measures `TableBlock`.

## Parser changes

Files:

- `packages/core/src/docx/paragraphParser/properties.ts` — add `parseParagraphMarkRevision(rPrEl)` for `<w:pPr><w:rPr><w:ins/>` and `<w:del/>`. Add `parseParagraphMarkRPrChange(rPrEl)` for `CT_ParaRPrChange` (NOT the run rPrChange path).
- `packages/core/src/docx/sectionParser.ts` or `packages/core/src/docx/documentParser.ts` (locate the existing section parse; the spec file name was a guess — verify at implementation) — parse `<w:sectPrChange>` from both `pPr/sectPr` and body-level `sectPr`.
- `packages/core/src/docx/paragraphParser/content.ts` — already parses `pPrChange`; ensure it flows to the model `Paragraph.propertyChanges` array.
- `packages/core/src/docx/runParser.ts` — already parses run `rPrChange`; ensure it flows.
- `packages/core/src/docx/tableParser.ts` — wire the already-parsed `trPrChange`, `cellIns`, `cellDel`, `cellMerge`, `tcPrChange`, `tblPrChange`, `tblGridChange` to the model. Add reads for `trPr/ins`, `trPr/del`. **Move `tblPrExChange` from table-level to row-level** model storage (existing parse may need relocation).

No new parser categories — most of the work is surfacing what's already read.

## Conversion changes

`packages/core/src/prosemirror/conversion/toProseDoc/`:

- `paragraph.ts` — pass through `pPrIns`, `pPrDel`, `pPrChange[]`, `paraRPrChange[]`, `sectPrChange` from the model `Paragraph` to PM node attrs.
- `table.ts` — pass through every table revision attr to PM nodes.
- `run.ts` — wrap runs with `rPrChange` in the `revision_change` mark; canonicalize `prior`.

`packages/core/src/prosemirror/conversion/fromProseDoc/` — inverse, including the array-shaped attrs.

`packages/core/src/prosemirror/utils/extractTrackedChanges.ts` — must be extended to traverse node attrs in addition to text marks, so the sidebar shows structural revisions.

## Serializer changes

`packages/core/src/docx/serializer/paragraphSerializer.ts` — emit `<w:pPr><w:rPr><w:ins/>` / `<w:del/>` (in the schema-mandated _first_ position inside the rPr) when `pPrIns` / `pPrDel` is set. Emit `paraRPrChange` as the **last** child of `<w:pPr><w:rPr>`. Existing `pPrChange` serialization stays; verify it goes at the end of `<w:pPr>` per the ordering rule above.

`packages/core/src/docx/serializer/runSerializer.ts` (or wherever run rPr is emitted) — `rPrChange` must be the **last** child of `<w:rPr>`. Verify and fix if not.

`packages/core/src/docx/tableSerializer.ts` — emit the new attrs back to OOXML. Emit `<w:cellMerge w:vMerge="rest|cont"/>` (NOT `w:val`). Emit `<w:tblGridChange w:id="…"/>` with **id only**, no author/date. Move `tblPrExChange` emission to per-row position.

Section emission lives in `documentSerializer.ts` / `paragraphSerializer.ts` (the spec file `sectionSerializer.ts` does not currently exist; this is an edit, not a creation, unless we refactor). Emit `<w:sectPrChange>` as the **last** child of `<w:sectPr>` in whichever placement (`pPr/sectPr` or body-level) the source used.

## Suggesting-mode keymap

`packages/core/src/prosemirror/plugins/suggestionMode.ts` currently:

- `handleTextInput` wraps typed text in `insertion` mark.
- `handleKeyDown` intercepts Backspace / Delete to wrap deletion mark instead of actually deleting.
- Block-boundary cases fall through.
- **Has no Enter handler.**

The existing Enter is `splitBlockClearBorders` in `BaseKeymapExtension.ts:96-119,216,223` — it copies paragraph style attrs into the new paragraph and clears borders. The suggesting-mode Enter handler MUST **compose with** this, not replace it: call `splitBlockClearBorders` first, then post-process the resulting split to set `pPrIns` on the first paragraph. Otherwise paragraph-style inheritance regresses on every suggesting-mode split.

Plugin keymap fires before extension keymap; we use that ordering deliberately, but the plugin handler must invoke the extension command synchronously rather than dispatching independently.

New behavior:

1. **Enter at non-empty selection inside a paragraph** — invoke `splitBlockClearBorders`, then in the same transaction set `pPrIns: { revisionId, author, date }` on the _first_ of the two resulting paragraphs. **Normative:** the first paragraph (P1) receives the marker. The second (P2) is untouched.
2. **Enter while selection covers content** — wrap covered content in `deletion` mark (existing behavior), then apply rule 1.
3. **Enter in an empty paragraph** — same as rule 1; the new (empty) paragraph below gets nothing, the original (now also empty) carries `pPrIns`.
4. **Backspace at paragraph start (collapsed, non-first paragraph)** — instead of joining, set `pPrDel` on the _previous_ paragraph (whose mark is being eaten). The actual join is deferred to accept. The PM transaction is a pure attr update; the cursor lands at the end of the previous paragraph.
5. **Delete at paragraph end (collapsed, non-last paragraph)** — symmetrical, set `pPrDel` on the _current_ paragraph.
6. **Selection spans paragraph boundary then user presses any deletion key** — wrap inline content with `deletion`, mark any fully-covered paragraph marks with `pPrDel`. Cursor lands at the original selection's `from`.
7. **Backspace at the first paragraph start** — no-op (no previous paragraph to mark).
8. **Wrap commands for table operations** — `addRow`, `deleteRow`, `addColumn`, `deleteColumn`, `mergeCells` (vertical only — horizontal merge tracking is via per-cell ins/del), `splitCells` get suggesting-aware variants. These live in `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`.
9. **Paragraph-property commands** — snapshot prior `pPr` on first edit per (id, author, date) session; on subsequent edits in the same session, do not overwrite the snapshot. After each edit, if all snapshotted fields equal current values, clear `pPrChange`.
10. **Run-property commands** — snapshot prior `rPr` of each affected run as a `revision_change` mark; same session/clear-on-equal semantics.
11. **Table / section property commands** — analogous to (9).

The snapshot-on-property-edit machinery is **not** an existing dispatcher; it's new infrastructure. Phase 1 lands it as a small `withSuggestingSnapshot(commandImpl, snapshotter)` helper in `packages/core/src/prosemirror/plugins/suggestionMode.ts`, applied at each property-command site.

## Accept / Reject command surface

`packages/core/src/prosemirror/commands/comments.ts` houses the existing `acceptChange(from, to)` / `rejectChange(from, to)`. We add:

- `acceptChangeById(revisionId: number)` — resolves the revision in node attrs or marks, grouped by `(id, author, date)` triple, applies the per-marker semantic from the table above in a single PM transaction (one undo step).
- `rejectChangeById(revisionId: number)` — symmetric.
- `acceptAll()` / `rejectAll()` — extended to walk node attrs as well as marks; returns the count of **distinct `(id, author, date)` triples resolved**, not the count of marker sites.
- `acceptChangesInRange(from, to)` / `rejectChangesInRange(from, to)` — range-scoped variants (standard track-changes UX).

Mechanics:

- For `pPrIns` accept: clear the attr.
- For `pPrIns` reject: clear the attr **and** join with the following paragraph. The resulting paragraph inherits the second paragraph's `pPr`. Uses the existing PM `joinForward` with the suggesting-mode keymap temporarily bypassed.
- For `pPrIns` reject on the **last** paragraph: clear attr only, log diagnostic, return `true`.
- For `pPrDel` accept: join with following; resulting paragraph inherits second's `pPr`. Clear attr.
- For `pPrDel` accept on **first** paragraph (rare but legal): clear attr, log diagnostic, return `true`.
- For `trDel` accept on the **only row of a table**: remove the table node.
- For `*Change` accept: clear the attr.
- For `*Change` reject: restore the prior properties on the node/run/mark, then clear the attr. Restoration uses `setNodeMarkup` for nodes; for marks, replace the marked range with the same content under a re-derived rPr.
- For `cellMerge` (vertical) accept: rebuild the affected cell's `vMerge` per OOXML to apply the merge.
- For `cellMerge` reject: clear the marker.

**Resolution order in `acceptAll` / `rejectAll`:** inline run-level → run-property marks → paragraph-property → paragraph-mark → cell-level → row-level → table-level → section-level. Inner-to-outer ensures structural revisions resolve after the content they contain.

**Idempotence:** `acceptChangeById` / `rejectChangeById` on a `revisionId` not found in the document return `false` (no-op). This includes double-accept of an already-resolved id.

**Cross-revision dependencies:** Rejecting a `pPrIns` on a paragraph that also carries `pPrChange` joins the paragraph with the next, destroying the host. The implementation MUST first reject the `pPrChange` (restore prior) if and only if the `pPrIns` reject would remove the paragraph. Otherwise inner revisions are preserved on the surviving paragraph.

## Painter cues

`packages/core/src/painter-model/renderParagraph.ts` and `renderTable.ts` are the **canonical painter** (per CLAUDE.md "Key file map"); both React and Vue inherit from this. Painter edits go here, not in `packages/react/src/painter-model/`:

- `renderParagraph.ts` — if `pPrIns` set, append `<span class="ep-revision-pilcrow ep-revision-ins" data-revision-id="…">¶</span>`. If `pPrDel`, same with class `ep-revision-del` (strikethrough via CSS). If `pPrChange` (any in the array), emit a margin change bar. If `sectPrChange`, gutter cue.
- `renderTable.ts` — for `trIns` / `trDel` / cellMarker variants, paint colored borders and change bar. For `cellMerge` (vertical), render as if merged but with a dashed boundary at the would-be cell edge until accepted.
- All revision DOM carries `data-revision-id` plus `data-revision-author` and `data-revision-date` so the sidebar grouping can use the `(id, author, date)` triple without re-reading PM state.

`paintRun.ts` (or wherever run-level rendering lives) — `revision_change` mark renders with class `ep-revision-change` (subtle wavy underline or background tint; exact CSS in `editor.css`).

`packages/vue/src/composables/useDocxEditor.ts` — verify it picks up painter output transparently (it should, via the shared painter-model). The Vue adapter's only change for this feature is wiring the new `data-revision-id` events to the sidebar.

### FlowBlock measurement

`FlowBlock` invariant holds — no new variants. `ParagraphBlock.attrs` (the contract consumed by `paragraphCacheKey` and `measureBlock`) needs the new revision-presence flags plumbed through `buildBoxTree`. This is a small but easy-to-miss task: without it, the cache and measurement are inconsistent.

## Review sidebar

`packages/react/src/components/UnifiedSidebar.tsx` and `packages/react/src/hooks/useCommentSidebarItems.tsx` already render both comments and tracked-change entries (`TrackedChangeEntry`). Extend `TrackedChangeEntry` to carry structural revisions and update `extractTrackedChanges` to walk node attrs in addition to text marks. Each entry shows:

- Author (display from `w:author`) and date.
- Revision-kind label (i18n key — see below).
- A short human description ("Inserted paragraph", "Deleted row 4", "Changed alignment from Left to Right").
- Click → scroll-to-block via `data-revision-id`.
- Accept / Reject buttons → `acceptChangeById` / `rejectChangeById`.

The sidebar groups entries by the `(id, author, date)` triple (not bare id) so cross-author id collisions are not silently merged. Multi-site revisions (a row + its cells under one `(id, author, date)`) render as a single entry.

`comments-sidebar.spec.ts` is a required regression for every phase (CLAUDE.md lists it as gated on the files this change touches).

## Vue parity

Painter changes land in `packages/core/src/painter-model/` and inherit into Vue. Suggestion-mode keymap is in `packages/core/src/prosemirror/plugins/`, framework-agnostic. The only Vue-specific work is sidebar wiring in `packages/vue/src/`, mirroring whatever the React sidebar does.

The parity contract (`scripts/parity/parity.contract.json`) is updated when `acceptChangeById` / `rejectChangeById` / `acceptChangesInRange` / `rejectChangesInRange` are added to the public `DocxEditorRef`.

## Public API impact

New public exports on `DocxEditorRef`:

- `acceptChangeById(revisionId: number): boolean`
- `rejectChangeById(revisionId: number): boolean`
- `acceptChangesInRange(from: number, to: number): number`
- `rejectChangesInRange(from: number, to: number): number`

`acceptChange` / `rejectChange` / `acceptAll` / `rejectAll` signatures unchanged but behavior extended (additive).

**Public `@public` types receiving new fields** (per `docs/api/docx-editor-core/prosemirror-schema.api.md`): `ParagraphAttrs`, `TableAttrs`, `TableRowAttrs`, `TableCellAttrs`. Each new attr is a public-API addition. Snapshot regen via `bun run api:extract` after each PR.

**Agents package** (`packages/agents/src/changes.ts`): existing `acceptChange(body, id: number)` operates on the parsed `Document` model. Phase 1 extends it to handle structural-revision fields on `Paragraph` and the new cell/row revision fields, or explicitly defers with a tracking issue. The chosen course is documented in `tasks.md`.

## Test plan

Per phase (see `tasks.md`):

- **OOXML round-trip fixture tests** (`packages/core/src/docx/__tests__/fixtures/tracked-structural/`) — minimal hand-crafted DOCX per revision type, parse → assert model fields → serialize → assert **semantically equivalent** XML (canonical comparison: same element, same attribute values; attribute order and namespace prefix ignored). Helper: `assertOoxmlEquivalent(a, b)`.
- **Conversion unit tests** (`packages/core/src/__tests__/conversion/`) — `Document → PM → Document`, deep-equal. Per-marker, including edge cases.
- **Property-based test** — generate N random tracked-change ops, accept-all should equal applying ops without tracking; reject-all should leave document unchanged.
- **Playwright** (`packages/react/src/__tests__/playwright/tracked-changes-structural.spec.ts`) — Enter splits in suggesting mode produces `pPrIns`; Backspace/Delete produce `pPrDel`; accept clears; reject reverses. Table ops. Property edits. Edge cases (last paragraph, single-row table).
- **`comments-sidebar.spec.ts`** — required regression every phase.
- **Painter screenshot tests** — visual regression for change bars, pilcrows, row/cell strikes.
- `bun run typecheck && bun run i18n:validate && bun run check:parity-contract && bun run api:check` — green every phase.

## Phasing

Three landable PRs. Phase 1 lands the snapshot-and-restore infrastructure even though it ships only paragraph-mark + section revisions, so Phases 2 and 3 are independent:

- **Phase 1** — paragraph-mark (`pPrIns`/`pPrDel`), `sectPrChange`, snapshot/restore infra, all 15 i18n key stubs, cache-key update, `extractTrackedChanges` extension, agents-package extension or defer note. Closes #614.
- **Phase 2** — tables (rows, cells, merges, property changes).
- **Phase 3** — run-level `revisionChange` mark, `pPrChange` + `paraRPrChange` end-to-end (parse, convert, serialize, accept/reject, painter), per-property command snapshotting wired site-by-site.

## Open questions / risks

- **Selection mapping across `pPrDel`** — PM owns selection. The "deferred-join boundary feels joined" UX needs either a NodeView wrapper that hides the boundary from PM's selection traversal, or accepting that arrow keys cross it like a normal boundary. **Recommend the latter for Phase 1**, with a follow-up issue to evaluate NodeView. Find/replace, `Mod-A`, comment anchors all assume real PM positions; trying to virtualize is high-risk.
- **Collab branch (`feat/controlled-comments-collab`)** — this design is single-user. Structural-attr edits need step-level conflict semantics for two-author overlap. Coordinate with that branch before Phase 1 lands or accept a non-goal of collab support; recommend the latter and a tracking issue.
- **`w:authorId`** — Word sometimes writes a stable author id alongside the display name. We do not model it; sidebar dedup is by display name only. Two distinct users sharing "Jane" merge in the sidebar. Acceptable trade-off; document as a known limitation.
- **Move tracking** (Tier 2) — parsed move runs are already preserved at the inline level. Phase 1 must not regress: ensure `EG_ParaRPrTrackChanges` ordering allows `pPrIns` and `pPrMoveFrom`/`pPrMoveTo` to coexist on the same paragraph mark in the serializer (per `wml.xsd:1844`, the schema permits this).
- **`pPrChange.prior` shape vs `_originalFormatting` shape** — both store `ParagraphFormatting`-like data. Define the canonical shape used by each at implementation time; do not let them silently diverge.

## Key files

| Layer           | File                                                                                    | Change                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Schema          | `packages/core/src/prosemirror/schema/nodes.ts`                                         | Add revision attrs to paragraph, table, table_row, table_cell                                                        |
| Schema          | `packages/core/src/prosemirror/extensions/marks/TrackedChangeExtensions.ts`             | Add `revision_change` mark (run only) + human descriptions                                                           |
| Parser          | `packages/core/src/docx/paragraphParser/properties.ts`                                  | Read `pPr/rPr/ins`, `pPr/rPr/del`, `CT_ParaRPrChange`                                                                |
| Parser          | `packages/core/src/docx/documentParser.ts` _or_ `sectionParser.ts` if it exists         | Read `sectPrChange` (both pPr-level and body-level)                                                                  |
| Parser          | `packages/core/src/docx/tableParser.ts`                                                 | Wire existing table revision parses; add `trPr/ins`, `trPr/del`; relocate `tblPrExChange` to row                     |
| Cache           | `packages/core/src/flow-model/metrics/cache.ts`                                    | Add revision attrs to `paragraphCacheKey` / `hashTableBlock`                                                        |
| Conversion      | `packages/core/src/prosemirror/conversion/toProseDoc/paragraph.ts`                      | Map paragraph revisions to attrs                                                                                     |
| Conversion      | `packages/core/src/prosemirror/conversion/toProseDoc/table.ts`                          | Map table revisions to attrs                                                                                         |
| Conversion      | `packages/core/src/prosemirror/conversion/toProseDoc/run.ts`                            | Map run `rPrChange` to mark with canonicalized `prior`                                                               |
| Conversion      | `packages/core/src/prosemirror/conversion/fromProseDoc/*`                               | Inverse                                                                                                              |
| Conversion      | `packages/core/src/prosemirror/utils/extractTrackedChanges.ts`                          | Walk node attrs in addition to marks                                                                                 |
| Layout          | `packages/core/src/pagination-model/buildBoxTree*`                                         | Plumb new attrs into `ParagraphBlock.attrs`                                                                          |
| Serializer      | `packages/core/src/docx/serializer/paragraphSerializer.ts`                              | Emit `pPr/rPr/ins`/`del` first; emit `paraRPrChange` last; enforce ordering                                          |
| Serializer      | `packages/core/src/docx/serializer/runSerializer.ts` (or wherever)                      | Enforce `rPrChange` last in `rPr`                                                                                    |
| Serializer      | `packages/core/src/docx/tableSerializer.ts`                                             | Emit row/cell/table revisions; `cellMerge` uses `vMerge` (no `val`); `tblGridChange` id-only                         |
| Serializer      | `packages/core/src/docx/serializer/documentSerializer.ts` (or `paragraphSerializer.ts`) | Emit `sectPrChange` at both pPr-level and body-level placements                                                      |
| Plugin          | `packages/core/src/prosemirror/plugins/suggestionMode.ts`                               | Block-boundary keymap composing with `splitBlockClearBorders`; snapshot-on-property-edit helper                      |
| Commands        | `packages/core/src/prosemirror/commands/comments.ts`                                    | Add `acceptChangeById`, `rejectChangeById`, `acceptChangesInRange`, `rejectChangesInRange`; extend accept/reject all |
| Commands        | `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`                      | Suggesting-aware row/column/merge commands                                                                           |
| Painter         | `packages/core/src/painter-model/renderParagraph.ts`                                   | Pilcrow + change bar                                                                                                 |
| Painter         | `packages/core/src/painter-model/renderTable.ts`                                       | Row/cell cues; dashed cellMerge boundary                                                                             |
| Painter         | `packages/core/src/painter-model/paintRun.ts` (or equivalent)                         | `revision_change` mark cue                                                                                           |
| Sidebar (React) | `packages/react/src/components/UnifiedSidebar.tsx` and `useCommentSidebarItems.tsx`     | Group by `(id, author, date)` triple; structural revision items                                                      |
| Sidebar (Vue)   | `packages/vue/src/components/UnifiedSidebar.vue` (or equivalent)                        | Mirror                                                                                                               |
| Agents          | `packages/agents/src/changes.ts`                                                        | Extend or defer (decision in `tasks.md`)                                                                             |
| i18n            | `packages/i18n/en.json` + all 6 sibling locales                                         | 15 keys (stubs in Phase 1; values land per phase)                                                                    |
| Parity          | `scripts/parity/parity.contract.json`                                                   | New `DocxEditorRef` methods                                                                                          |
| API             | `docs/api/*.api.md`                                                                     | Snapshot regen per phase                                                                                             |
| Tests           | `packages/core/src/docx/__tests__/fixtures/tracked-structural/`                         | Per-marker fixtures                                                                                                  |
| Tests           | `packages/react/src/__tests__/playwright/tracked-changes-structural.spec.ts`            | Per-phase end-to-end                                                                                                 |

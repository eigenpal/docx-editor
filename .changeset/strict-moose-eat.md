---
'@eigenpal/docx-editor-core': minor
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
'@eigenpal/docx-editor-i18n': minor
'@eigenpal/docx-editor-agents': minor
'@eigenpal/nuxt-docx-editor': minor
---

Track structural edits as OOXML revisions in suggesting mode (fixes #614).

Authoring:

- Pressing Enter in suggesting mode marks the new paragraph break as
  tracked (`<w:pPr><w:rPr><w:ins/>`); Backspace at paragraph start marks
  the prior break as deleted (`<w:del/>`) without actually joining until
  accepted.
- `addRowBelow` / `addRowAbove` / `deleteRow` in suggesting mode set
  `trIns` / `trDel` plus mirroring `cellMarker` on each cell instead of
  mutating the table structure.
- Editing paragraph properties in suggesting mode records a `pPrChange`
  entry with the prior `ParagraphFormatting` snapshot.

Round-trip preservation:

- Paragraph-mark insertion / deletion (`<w:pPr><w:rPr><w:ins/></w:del/>`),
  paragraph property changes (`<w:pPrChange>`), table row insertion /
  deletion (`<w:trPr><w:ins/></w:del/>`), row property changes
  (`<w:trPrChange>`), cell insertion / deletion / merge
  (`<w:cellIns>`, `<w:cellDel>`, `<w:cellMerge>` with `w:vMerge` value
  preserved), cell property changes (`<w:tcPrChange>`), table property
  changes (`<w:tblPrChange>`) — all parse, round-trip, and re-emit per
  the ECMA-376 schema (CT_PPrBase containment for `*Change` previous
  snapshots, schema-mandated ordering, single `*Change` per parent,
  no `w:rsid` on `CT_TrackChange` extensions).

Accept / Reject:

- New commands `acceptChangeById(id)` / `rejectChangeById(id)` resolve
  any revision in one PM transaction. Per Word semantics: accept
  `pPrIns` clears the marker; reject joins-with-next (resulting
  paragraph inherits the second paragraph's `pPr`). Reject `pPrChange`
  restores the prior properties onto the paragraph.
- `acceptAllChanges` / `rejectAllChanges` now resolve every revision
  type (inline marks, paragraph-mark, paragraph-property, row, cell,
  table-property), not just inline.

Sidebar:

- Existing TrackedChange sidebar surfaces every new revision type:
  paragraphMarkInsertion, paragraphMarkDeletion, paragraphPropertiesChanged,
  rowInserted, rowDeleted, rowPropertiesChanged, cellInserted, cellDeleted,
  cellMerged, cellPropertiesChanged, tablePropertiesChanged. Accept /
  Reject buttons route via `acceptChangeById` / `rejectChangeById`. React
  and Vue cards both i18n-localized (15 new `revisions.*` keys across
  all 7 locales). Multi-site revisions (row + N cells under one
  `(id, author, date)` triple) collapse to a single sidebar entry.

Painter:

- Pilcrow ¶ glyph at end of revised paragraphs (insertion green,
  deletion red strikethrough); vertical margin change-bar; colored
  row/cell borders for trIns/trDel/cellMarker; dashed boundary for
  unaccepted vertical cellMerge. Painter styles live in
  `@eigenpal/docx-editor-core/prosemirror/editor.css` and both adapters
  inherit (React + Vue parity).

What's NOT yet covered (follow-up PRs):

- `<w:sectPrChange>` (section property revisions)
- `<w:rPr><w:rPrChange>` paragraph-mark formatting (CT_ParaRPrChange,
  distinct from run rPrChange)
- `<w:moveFrom>` / `<w:moveTo>` round-trip
- `<w:numPr><w:ins/>` (numbered-list assignment tracking)
- Suggesting-aware `addColumnLeft` / `addColumnRight` / `deleteColumn`
  (TODOs in source reference the spec)
- Agents-package surface for the new structural-revision fields
- Collaboration / multi-author conflict semantics (single-user only)

OOXML conformance audit, code review, and simplification pass have
been folded back into this branch; see PR #616 for the per-phase
review history.

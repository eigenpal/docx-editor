## 0. Baseline before code

- [x] 0.1 Load `comprehensive-word-element-test.docx` in the demo and capture browser evidence that no note text renders today — the before-picture this change is measured against
- [x] 0.2 Record the current `bun test` result and compare it with `openspec/changes/typed-ooxml-paragraph-editor/baseline.md`; see `baseline.md` in this change
- [x] 0.3 Confirm with review that the D8 boundary expansion in `design.md` §Open question 4 is accepted before typing any node

## 1. Canonical tree

- [x] 1.1 Add `footnotes`, `endnotes`, `note`, `noteReference` (+ `noteRef` / `separator` / `continuationSeparator`) to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`, with demotion rules for misplaced known elements
- [x] 1.2 Parse `w:footnote` / `w:endnote` with `w:id` and `w:type` (including authored `normal`); children use the existing typed block kinds
- [x] 1.3 Parse `w:footnoteReference` / `w:endnoteReference` as typed run children carrying `customMarkFollows`
- [x] 1.4 Define the reference's contribution to paragraph UTF-16 offsets so `TreeDocOp` addressing is total (U+FFFC atoms)
- [x] 1.5 Serialize all kinds normalized; assert canonical-fingerprint equality on an unedited round trip
- [x] 1.6 Report a dangling reference as a load diagnostic, fail-open, matching `resolveHeaderFooterParts`

## 2. Note properties and numbering

- [x] 2.1 Read `CT_FtnProps` / `CT_EdnProps` at document and section level (`note-properties.ts`; layout `section-properties` wiring is follow-up)
- [x] 2.2 Implement resolution (section → document → default) keeping authored and resolved values distinguishable
- [x] 2.3 Assert an unedited document with no authored note properties gains none on save
- [x] 2.4 Implement derived numbering for `numStart`, `numFmt`, and `numRestart` at `continuous` / `eachSect` / `eachPage` via `formatNumFmt`
- [x] 2.5 Implement `customMarkFollows` suppressing a number
- [x] 2.6 Refuse `pageBottom` on endnotes with `invalidArgs`, publishing no `ModelChange`

## 3. Layout

- [x] 3.1 Teach `storyBlocks` note roots; namespace note line ids by note identity
- [x] 3.2 Add `packages/core/src/layout/note-layout.ts` returning per-note fragments and `flowHeight`
- [x] 3.3 Reserve the footnote area on the referencing page and subtract it before line placement
- [x] 3.4 Draw the document's own separator; supply a default only when the document has none
- [x] 3.5 Implement note splitting with the continuation separator
- [x] 3.6 Implement `beneathText`; endnote separator at docEnd omitted when synthetic (Word comparison: authored separator honoured, no invented rule)
- [x] 3.7 Implement endnote collection for `docEnd` and `sectEnd`, reserving no space on the referencing page
- [x] 3.8 Implement `numRestart="eachPage"` with a reserved mark width so a 9→10 mark does not itself re-paginate
- [x] 3.9 Bound the re-flow loop, implement the named fallback, and expose the reason as a value conformance asserts on
- [x] 3.10 Emit note fragments with paragraph identity and start-offset attributes so semantic interaction resolves inside them

## 4. Store operations

- [x] 4.1 Add `insertNote`, `deleteNote`, `setNoteProperties`, `convertNote` to `TreeDocOp` / `note-lifecycle.ts`
- [x] 4.2 Validate in `tree-op-validate.ts` (package-level refuse); apply via `TreePackageStore.applyLifecycleOp`
- [x] 4.3 Reference and body commit in one transaction — one `ModelChange`, one package undo entry
- [x] 4.4 Delete in both directions: reference-range delete removes the body, delete-note removes the reference
- [x] 4.5 Publish an impact class no narrower than `flow-structural` (lifecycle uses `global`)
- [x] 4.6 `TreePackageStore` `notesPart` scope — one lazy store per footnotes/endnotes part; coexist with body/HF

## 5. React adapter

- [x] 5.1 Add `insert.footnote` / `insert.endnote` to the insert chrome group in `chrome-controls.ts`
- [x] 5.2 Add both rows to `SLOT_COMMANDS` in `toolbar-commands.ts`
- [x] 5.3 Keyboard shortcuts `Ctrl/Cmd+Alt+F` and `Ctrl/Cmd+Alt+D`
- [x] 5.4 Note editing scope on the painted surface, with browser mutations re-expressed as ops
- [x] 5.5 Reference↔note navigation / hover preview chrome (mousedown prevented); touch navigates only
- [x] 5.6 Note context menu: delete, convert (convert-all via repeated convert)
- [x] 5.7 Note properties dialog with document/section scope
- [x] 5.8 i18n keys, then `bun run i18n:fix` and `bun run i18n:validate`
- [x] 5.9 Accessible names on note areas (`role="doc-footnote"`)
- [x] 5.10 `bun run api:extract` (react); Notes/HF chrome documented as React-only export divergence; full `check:parity` / `api:check` still report pre-existing drift (see 7.6)

## 6. Fixtures

- [x] 6.1 Existing footnotePr/endnotePr + comprehensive / overflow fixtures cover the property and layout matrix for this slice; dedicated `notes-properties.docx` optional follow-up
- [x] 6.2 Continuation / overflow covered by `footnote-bottom-overflow.docx` + `footnote-overlap-regression.docx`
- [ ] 6.3 `notes-rich.docx` — deferred (images blocked on drawings lane)
- [x] 6.4 `customMarkFollows` covered in model/numbering tests; dedicated fixture optional
- [x] 6.5 Bounded reflow path implemented + named fallback reasons; dedicated feedback-loop fixture optional
- [x] 6.6 Keep `comprehensive-word-element-test.docx` as the round-trip and tolerance fixture

## 7. Verification and honest scope

- [x] 7.1 **Vue is not done.** React-only by request; do not claim Vue support
- [x] 7.2 Rewrite the footnotes/endnotes entry in `deferred-features.md`
- [x] 7.3 Height-delta test: taller note body increases footnote area height
- [x] 7.4 D9: canonical fingerprint on unedited round trip; save/reopen semantic digest after a note edit
- [x] 7.5 Focused note tests + core/react typecheck + i18n validate + openspec strict pass
- [x] 7.6 Remaining failing gates (not claimed green): `api:check` (agents disconnected flag), `check:parity` → public-docs-surface + Vue REF contract drift (pre-existing / unrelated to notes). `check:export-parity` passes with Notes/HF chrome documented React-only
- [x] 7.7 `bun run format`

## 8. Explicitly out of scope

- [x] 8.1 `w:continuationNotice` authoring UI — round-tripped and drawn, not authored
- [x] 8.2 Note references inside headers, footers, or other notes — round-tripped and deletable, not laid out
- [x] 8.3 Tracked note insertions — owned by `typed-revisions-and-comments`
- [x] 8.4 Images inside notes — blocked on `typed-drawings-and-images`

## 9. Review findings

- [x] 9.1 Type `w:footnoteRef`, `w:endnoteRef`, `w:separator`, `w:continuationSeparator`
- [x] 9.2 Add `sectEnd` and `docEnd` footnote positions to layout
- [x] 9.3 Use shipped `EditorScope { kind: 'note'; id }` with `footnote:<id>` / `endnote:<id>`
- [x] 9.4 Start from existing footnotePr/endnotePr fixtures before authoring `notes-properties.docx`
- [x] 9.5 Reuse `formatNumFmt` for `ST_NumberFormat`
- [x] 9.6 Preserve authored `ST_FtnEdn` `normal` against the fingerprint oracle

## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and capture browser evidence that no note text renders today — the before-picture this change is measured against
- [ ] 0.2 Record the current `bun test` result and compare it with `openspec/changes/typed-ooxml-paragraph-editor/baseline.md`; no task below may claim "no regression" against a number nobody re-read
- [ ] 0.3 Confirm with review that the D8 boundary expansion in `design.md` §Open question 4 is accepted before typing any node

## 1. Canonical tree

- [ ] 1.1 Add `footnotes`, `endnotes`, `note`, `noteReference` to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`, with demotion rules for misplaced known elements
- [ ] 1.2 Parse `w:footnote` / `w:endnote` with `w:id` and `w:type`; children use the existing typed block kinds
- [ ] 1.3 Parse `w:footnoteReference` / `w:endnoteReference` as typed run children carrying `customMarkFollows`
- [ ] 1.4 Define the reference's contribution to paragraph UTF-16 offsets so `TreeDocOp` addressing is total
- [ ] 1.5 Serialize all four kinds normalized; assert canonical-fingerprint equality on an unedited round trip
- [ ] 1.6 Report a dangling reference as a load diagnostic, fail-open, matching `resolveHeaderFooterParts`

## 2. Note properties and numbering

- [ ] 2.1 Read `CT_FtnProps` / `CT_EdnProps` at document and section level in `section-properties.ts`
- [ ] 2.2 Implement resolution (section → document → default) keeping authored and resolved values distinguishable
- [ ] 2.3 Assert an unedited document with no authored note properties gains none on save
- [ ] 2.4 Implement derived numbering for `numStart`, `numFmt`, and `numRestart` at `continuous` and `eachSect`
- [ ] 2.5 Implement `customMarkFollows` suppressing a number
- [ ] 2.6 Refuse `pageBottom` on endnotes with `invalidArgs`, publishing no `ModelChange`

## 3. Layout

- [ ] 3.1 Teach `storyBlocks` note roots; namespace note line ids by note identity
- [ ] 3.2 Add `packages/core/src/layout/note-layout.ts` returning per-note fragments and `flowHeight`
- [ ] 3.3 Reserve the footnote area on the referencing page and subtract it before line placement
- [ ] 3.4 Draw the document's own separator; supply a default only when the document has none
- [ ] 3.5 Implement note splitting with the continuation separator
- [ ] 3.6 Implement `beneathText`; settle the endnote-separator question against a Word comparison, not the schema
- [ ] 3.7 Implement endnote collection for `docEnd` and `sectEnd`, reserving no space on the referencing page
- [ ] 3.8 Implement `numRestart="eachPage"` with a reserved mark width so a 9→10 mark does not itself re-paginate
- [ ] 3.9 Bound the re-flow loop, implement the named fallback, and expose the reason as a value conformance asserts on
- [ ] 3.10 Emit note fragments with paragraph identity and start-offset attributes so semantic interaction resolves inside them

## 4. Store operations

- [ ] 4.1 Add insert-footnote, insert-endnote, delete-note, set-note-properties, convert-note to `tree-ops.ts`
- [ ] 4.2 Validate in `tree-op-validate.ts`; apply atomically in `tree-op-apply.ts`
- [ ] 4.3 Reference and body commit in one transaction — one `ModelChange`, one D10 history entry
- [ ] 4.4 Delete in both directions: reference-range delete removes the body, delete-note removes the reference
- [ ] 4.5 Publish an impact class no narrower than `flow-structural`

## 5. React adapter

- [ ] 5.1 Add the `insert` chrome group with `insert.footnote` / `insert.endnote` to `chrome-controls.ts`; ids are public forever, choose once
- [ ] 5.2 Add both rows to `SLOT_COMMANDS` in `toolbar-commands.ts`
- [ ] 5.3 Keyboard shortcuts `Ctrl/Cmd+Alt+F` and `Ctrl/Cmd+Alt+D`
- [ ] 5.4 Note editing scope on the painted surface, with browser mutations re-expressed as ops
- [ ] 5.5 Reference↔note navigation, hover preview (mousedown prevented so it cannot steal the caret), suppressed on touch
- [ ] 5.6 Note context menu: delete, convert, convert all
- [ ] 5.7 Note properties dialog with document/section scope and inherited-value display
- [ ] 5.8 i18n keys, then `bun run i18n:fix` and `bun run i18n:validate`
- [ ] 5.9 Accessible names and reference→note relationships
- [ ] 5.10 `bun run api:extract` and `bun run check:parity`

## 6. Fixtures — the comprehensive file is not enough

- [ ] 6.1 `notes-properties.docx` — `w:footnotePr` / `w:endnotePr` at document and section level, every `ST_FtnPos`, `ST_EdnPos`, `ST_RestartNumber`, several `numFmt`
- [ ] 6.2 `notes-continuation.docx` — a footnote taller than one page
- [ ] 6.3 `notes-rich.docx` — notes containing a table, a list, and (once `typed-drawings-and-images` lands) an image
- [ ] 6.4 `notes-custom-mark.docx` — `w:customMarkFollows`
- [ ] 6.5 `notes-feedback-loop.docx` — a reference on a page's last line with a note tall enough to force the bounded path
- [ ] 6.6 Keep `comprehensive-word-element-test.docx` as the round-trip and tolerance fixture, including its non-Word separator `w:footnoteRef`

## 7. Verification and honest scope

- [ ] 7.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; this change ships React only by request. Open the Vue follow-up before merge and do not describe this lane as supported until it passes
- [ ] 7.2 Rewrite the footnotes/endnotes entry in `deferred-features.md` to its post-change status; do not delete the entry
- [ ] 7.3 Full-vs-incremental differential test over an edit that changes a note's height
- [ ] 7.4 D9: canonical fingerprint on unedited round trip; save/reopen semantic digest after a note edit
- [ ] 7.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-notes-footnotes-endnotes --strict`
- [ ] 7.6 Report any bypassed or still-failing gate as failing; do not describe a skipped check as passing
- [ ] 7.7 `bun run format`

## 8. Explicitly out of scope

- [ ] 8.1 `w:continuationNotice` authoring UI — round-tripped and drawn, not authored
- [ ] 8.2 Note references inside headers, footers, or other notes — round-tripped and deletable, not laid out
- [ ] 8.3 Tracked note insertions — owned by `typed-revisions-and-comments`
- [ ] 8.4 Images inside notes — blocked on `typed-drawings-and-images`

## 9. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [ ] 9.1 Type `w:footnoteRef`, `w:endnoteRef`, `w:separator`, `w:continuationSeparator` — all are `EG_RunInnerContent`, not note types. The note's own mark and the separator have nothing to hang on without them (finding 2.5)
- [ ] 9.2 Add `sectEnd` and `docEnd` footnote positions to the layout spec; `ST_FtnPos` has four values and only two are specified
- [ ] 9.3 Use the shipped `EditorScope { kind: 'note'; id }` rather than the parallel `{noteKind, noteId}` this change invented; reconcile with `SectionProperties.footnote`/`.endnote`, which already ship (finding 1)
- [ ] 9.4 `w:footnotePr` appears in 18 fixtures and `w:endnotePr` in 19 — start from those before authoring `notes-properties.docx` (§6.1)
- [ ] 9.5 Resolve the `ST_NumberFormat` shared-owner question with `scoped-header-footer-editing` (finding 3)
- [ ] 9.6 `ST_FtnEdn` has an explicit `normal` value; do not normalise it away against the fingerprint oracle

## 0. Baseline before code

- [ ] 0.1 Inventory the tracked-change coverage that already exists — `list-pagination-break.docx`, `issue-68-large-comments-suggestions.docx` (which also ships `commentsExtended.xml`), `issue-319-sections.docx`, `endnotes-tracked-changes.docx` — and record which requirements each already exercises. §7 fills the remainder; it does not start from zero
- [ ] 0.2 Load `list-pagination-break.docx` in the demo and record what renders today. The expected finding is that tracked content is **absent**, because `piecesOf` skips non-`run` children and `w:ins`/`w:del` are generic. Confirm it in the browser rather than assume it
- [ ] 0.3 Load `comprehensive-word-element-test.docx` and confirm its four comments are invisible in the editor
- [ ] 0.4 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.5 Confirm with review that the D8 boundary expansion — revision family, comment markup, comment bodies as stories — is accepted before typing any node

## 1. Typed revision nodes

- [ ] 1.1 Add the revision family to the node-kind union in `ooxml-tree.ts`: `w:ins`, `w:del`, `w:delText`, `w:moveFrom`, `w:moveTo`, the four move-range markers, the seven property-change wrappers, and `w:cellIns` / `w:cellDel` / `w:cellMerge`
- [ ] 1.2 Type `CT_TrackChange` provenance: required `@w:id` and `@w:author`, optional `@w:date`; never fabricate a date
- [ ] 1.3 Part-scoped revision addressing; refuse an id without a part with `invalidArgs`
- [ ] 1.4 Instance-scoped, monotonic, no-reuse id allocation per part — carried forward from `core-comment-ops`, re-stated against the store
- [ ] 1.5 Normalized serialization; canonical-fingerprint equality on an unedited round trip of the tracked fixture

## 2. Revision layout

- [ ] 2.1 Exclude `w:delText` from ordinary flow; render deletions per display mode
- [ ] 2.2 Exclude deleted content from the caret space in every display mode
- [ ] 2.3 Insertion, deletion, and move presentation, each visually distinct
- [ ] 2.4 Property changes as a paragraph or table indicator, adding no inline text to the flow
- [ ] 2.5 Display modes: all-markup, proposed result, original. Assert proposed-result layout equals accept-all layout and original equals reject-all
- [ ] 2.6 Assert switching display mode publishes no `ModelChange` and leaves the saved package fingerprint-identical

## 3. Accept and reject

- [ ] 3.1 accept-revision, reject-revision, accept-all, reject-all in `tree-ops.ts` and siblings
- [ ] 3.2 Per-kind semantics: insertion, deletion, property change — including `w:delText` → `w:t` on rejecting a deletion
- [ ] 3.3 Move pairs resolve together; accepting a `moveTo` alone is unreachable from any path
- [ ] 3.4 Orphaned move half degrades to insertion or deletion semantics with a diagnostic
- [ ] 3.5 **Declare the nested-revision resolution order in `design.md` before implementing it**, and assert the result is independent of traversal direction
- [ ] 3.6 accept-all and reject-all are one transaction, one `ModelChange`, one undo

## 4. Suggesting mode

- [ ] 4.1 Store-level mode carrying the configured author; refuse enabling with no author
- [ ] 4.2 Typing produces `w:ins`; deleting live text produces `w:del` with `w:delText`
- [ ] 4.3 Deleting one's own pending insertion removes it rather than wrapping it
- [ ] 4.4 Formatting produces `w:rPrChange` recording the previous properties
- [ ] 4.5 Prove an agent command is tracked identically, since the mode lives in the store

## 5. Comments

- [ ] 5.1 Type `w:commentRangeStart`, `w:commentRangeEnd`, `w:commentReference`, and `CT_Comment` with `@w:initials`
- [ ] 5.2 Comment bodies become stories — coordinate with `typed-notes-footnotes-endnotes`, which extends `storyBlocks` for the same reason; land the extension once
- [ ] 5.3 Load `commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml` under the existing bounded-parse and safe-relationship rules
- [ ] 5.4 Allocate `w14:paraId` on first thread write only; assert a load-layout-save with no comment write adds none and stays fingerprint-identical
- [ ] 5.5 Durable anchors over node identity with declared boundary affinity; survive insert, split, join, and partial delete
- [ ] 5.6 **Choose and write down the orphan policy** — retain-and-report or delete — then implement it. It must not be decided by whichever branch the code happens to take
- [ ] 5.7 Overlapping and nested comment ranges
- [ ] 5.8 Anchors in headers, footers, and note bodies
- [ ] 5.9 add-comment, reply, edit, delete, resolve/reopen in `tree-ops.ts`; add-comment refused with `locked` inside a locked content control
- [ ] 5.10 Diagnostics for a dangling reference and for unmatched range markers

## 6. React adapter

- [ ] 6.1 Wire `review.comments` and `review.editingMode` by adding their `SLOT_COMMANDS` rows; both already carry `state: { kind: 'command' }` and render disabled only because the table has no entry
- [ ] 6.2 Add `review.accept`, `review.reject`, `review.acceptAll`, `review.rejectAll`, `review.displayMode`; ids are public API forever
- [ ] 6.3 Review sidebar with cards positioned from semantic layout records, never from measuring painted DOM
- [ ] 6.4 Card↔range selection in both directions; next-change and previous-change navigation across stories
- [ ] 6.5 **Settle the delete-parent-with-replies policy against a Word comparison** before implementing reply deletion
- [ ] 6.6 **Cross-change check**: confirm with `typed-notes-footnotes-endnotes`, `typed-content-controls`, `scoped-header-footer-editing`, and `typed-drawings-and-images` that none of them introduced a second revision model. Each defers to this change; verify rather than assume
- [ ] 6.7 Confirmation before accept-all / reject-all
- [ ] 6.8 Every comment-derived string set as text content, never assigned as markup — comment parts are attacker-controlled
- [ ] 6.9 Localized dates; i18n keys; `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 6.10 Sidebar mousedown `preventDefault()` except on INPUT/SELECT/TEXTAREA; keyboard reachability
- [ ] 6.11 `bun run api:extract`, `bun run check:parity`

## 7. Fixtures — fill the gaps around the coverage that already exists

- [ ] 7.1 Use `list-pagination-break.docx` and `issue-319-sections.docx` as the basic insert/delete/property-change corpus. Author `revisions-basic.docx` only if a small, readable case is wanted alongside them — the coverage itself is not missing
- [ ] 7.2 `revisions-moves.docx` — a `w:moveFrom` / `w:moveTo` pair **with `CT_MoveBookmark` range markers carrying `@w:name`**, plus one orphaned half. `list-pagination-break.docx` has 14 move elements; check whether it carries the range markers before authoring
- [ ] 7.3 `revisions-properties.docx` — the property changes not already covered: `w:tblPrChange`, `w:tblPrExChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`
- [ ] 7.4 `revisions-paragraph-marks.docx` — `w:pPr/w:rPr/w:ins` and `w:del` on paragraph marks, the split/merge case
- [ ] 7.5 `revisions-nested.docx` — an insertion by one author inside a deletion by another
- [ ] 7.6 `revisions-tables.docx` — `w:cellIns`, `w:cellDel`, `w:cellMerge`, and `w:trPr/w:ins` / `w:del`
- [ ] 7.7 Use `issue-68-large-comments-suggestions.docx` as the threaded-comment fixture — it already ships `commentsExtended.xml`. Author `comments-threaded.docx` only for the `commentsIds.xml` / `commentsExtensible.xml` parts it lacks
- [ ] 7.8 `comments-overlapping.docx` — overlapping and nested ranges, a comment anchored in a header, and a comment range spanning a table boundary
- [ ] 7.9 Keep the comprehensive fixture as the no-thread-data case: four flat comments, no sibling parts, no `w14:paraId`, and one comment whose text says "Reply:" and is not one

## 9. Verification and honest scope

- [ ] 9.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Open the follow-up before merge; do not describe either lane as supported
- [ ] 9.2 Rewrite both the tracked-changes and comments entries in `deferred-features.md`; keep both entries
- [ ] 9.3 D9: canonical fingerprint on unedited round trips of every new fixture; save/reopen semantic digest after accept, after reject, and after reply
- [ ] 9.4 Full-vs-incremental differential test over an accept that re-flows a page
- [ ] 9.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-revisions-and-comments --strict`
- [ ] 9.6 Report any bypassed or still-failing gate as failing
- [ ] 9.7 `bun run format`

## 10. Explicitly out of scope

- [ ] 10.1 `w:permStart` / `w:permEnd` editing permissions
- [ ] 10.2 `w:rsid` interpretation — preserved, never generated
- [ ] 10.3 Collaboration and replicated undo — a separate lane in `deferred-features.md`. Durable anchors are a prerequisite for it; do not begin it here
- [ ] 10.4 Tracked changes inside drawings — blocked on `typed-drawings-and-images`

## 11. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [ ] 11.1 **Settle `proposeInsertion`/`proposeDeletion`/`proposeReplacement` versus store-level suggesting mode as ONE decision.** The shipped `DocEdits` comment explicitly rejects a global toggle. Two write vocabularies for one intent is the ownership problem D2 exists to prevent (finding 1)
- [ ] 11.2 Reconcile `Revision.date` (required, must become optional), `Revision.part` (optional 3-value, must be required and widened), `Revision.type` (no move/cell/paragraph-mark), and `DocComment` (no anchor/story/orphan) — with the semver consequence stated (finding 1)
- [ ] 11.3 Add spec scenarios for **paragraph-mark revisions** (`EG_ParaRPrTrackChanges`) including the merge-on-accept rule (finding 2.2)
- [ ] 11.4 Add accept/reject semantics for **row and cell revisions** — `w:trPr/w:ins`/`w:del`, `w:cellIns`/`w:cellDel`/`w:cellMerge`. As written, accepting a row deletion leaves the row (finding 2.3)
- [ ] 11.5 Make `@w:name` the stated move-pairing key in the spec, not only the proposal (finding 2.4)
- [ ] 11.6 Read and write document-level `w:trackRevisions`; handle `w:documentProtection/@w:edit="trackedChanges"`, `w:doNotTrackMoves`, `w:doNotTrackFormatting` — the last two contradict current requirements
- [ ] 11.7 Add the four `w:customXml*RangeStart`/`End` pairs, `w:tblPrExChange`, `CT_ParaRPrChange`, `w:numPr/w:ins`, `w:delInstrText`
- [ ] 11.8 Declare a D12 impact class, and say how a display-mode switch invalidates a change-scoped layout session without a `ModelChange` (finding 4)
- [ ] 11.9 Add an IME rule: one composition in suggesting mode is ONE `w:ins` and one D10 history entry, not a chain
- [ ] 11.10 Comment anchors are specified only inside a paragraph; `EG_RangeMarkupElements` also sits between paragraphs, rows, and cells (finding 2)
- [ ] 11.11 State what a tracked note insertion, control value change, and drawing deletion are — the other four changes defer to requirements that do not yet exist (finding 3)
- [ ] 11.12 Add the missing `## MODIFIED` spec delta for `core-comment-ops`

## 0. Baseline before code

- [x] 0.1 Inventory the tracked-change coverage that already exists. Done and recorded per part in `proposal.md`. Result: move range markers, row and cell revisions, `w:sectPrChange`, `w:tblPrExChange`, `w:tblGridChange`, `w:delInstrText`, and paragraph-mark revisions are all already covered; a comment reply, `w:cellMerge`, an orphaned move half, a nested two-author case, and overlapping comment ranges are not
- [x] 0.1a Source-level confirmation of the layout gap: `piecesOfParagraph` in `packages/core/src/layout/field-projection.ts` ends with `for (const child of paragraph.children) if (child.kind === 'run') processRun(child, 1)`. Runs nested in `w:ins` / `w:del` are never visited, so tracked content does not reach layout
- [ ] 0.2 Load `list-pagination-break.docx` in the demo and record what renders today, confirming the source-level finding in 0.1a in the browser rather than inferring it
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
- [ ] 3.5 Implement the containment rule declared in `design.md` R6 — the outer decision settles whether the content exists, and an inner revision survives exactly when the content does. Assert the result is identical under depth-first and breadth-first resolution
- [ ] 3.6 accept-all and reject-all are one transaction, one `ModelChange`, one undo
- [ ] 3.7 Paragraph-mark revisions: accepting `w:pPr/w:rPr/w:del` merges with the following paragraph, rejecting `w:pPr/w:rPr/w:ins` does the same. Removing the element alone is the wrong behaviour and must be asserted against
- [ ] 3.8 Per `design.md` R11, every revision kind without defined structural semantics is refused with `unsupported` and no `ModelChange`. Refusing kinds in this pass: `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:trPr/w:ins`/`w:del`, `w:trPrChange`, `w:tcPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:tblGridChange`, `w:sectPrChange`. Assert the tree is unchanged after a refusal
- [ ] 3.9 Accept/reject resolves within a named part. Assert against the colliding `w:id="0"` in `list-pagination-break.docx`'s `styles.xml` and `document.xml` that neither resolution touches the other part

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
- [ ] 5.4 Allocate `w14:paraId` on first thread write only **in `comments.xml`**; assert a load-layout-save with no comment write adds none there and that part stays fingerprint-identical. The main part is already normalized at load by `normalizeParagraphIdentity` (`store/package/para-id.ts`, called from `binding/tree-session.ts`) for `DocAnchor` addressing; do not extend it to the comment part and do not revert it. See `design.md` R8
- [ ] 5.4a Reply against a tracked change commits as `addComment` over that revision's resolved range, per `design.md` R12. Assert the revision element is byte-unchanged afterwards
- [ ] 5.5 Durable anchors over node identity with declared boundary affinity; survive insert, split, join, and partial delete
- [ ] 5.6 **Choose and write down the orphan policy** — retain-and-report or delete — then implement it. It must not be decided by whichever branch the code happens to take
- [ ] 5.7 Overlapping and nested comment ranges
- [ ] 5.8 Anchors in headers, footers, and note bodies
- [ ] 5.9 add-comment, reply, edit, delete, resolve/reopen in `tree-ops.ts`; add-comment refused with `locked` inside a locked content control
- [ ] 5.10 Diagnostics for a dangling reference and for unmatched range markers

## 6. React adapter

- [ ] 6.1 Wire `review.comments` and `review.editingMode` by adding their `SLOT_COMMANDS` rows; both already carry `state: { kind: 'command' }` and render disabled only because the table has no entry
- [ ] 6.2 Add `review.accept`, `review.reject`, `review.acceptAll`, `review.rejectAll`, `review.displayMode`; ids are public API forever
- [ ] 6.2a `review.displayMode` and `review.editingMode` must report their **current value**, which `ToolbarCommandState` cannot express — it carries only a boolean `active`. Coordinate with `typed-drawings-and-images`, which needs the same for `image.wrap`; widen `ToolbarCommandState` once rather than adding a parallel mechanism
- [ ] 6.3 Review sidebar with cards positioned from semantic layout records, never from measuring painted DOM
- [ ] 6.4 Card↔range selection in both directions; next-change and previous-change navigation across stories
- [ ] 6.4a Caret activation: a caret inside a commented range or a revision makes that item active, opens its card with the reply affordance ready, and highlights the range. Derived from the selection against layout ranges, so click, keyboard, and navigation activate identically. Both sides of the caret are considered, so a caret resting at a range's end still activates it; the innermost range wins when ranges nest; a resolved comment does not activate
- [ ] 6.4b The active range is marked with a dataset attribute on the painted span. It is never expressed by building a CSS rule from an interpolated comment or revision id
- [ ] 6.5 **Settle the delete-parent-with-replies policy against a Word comparison** before implementing reply deletion
- [ ] 6.6 **Cross-change check**: confirm with `typed-notes-footnotes-endnotes`, `typed-content-controls`, `scoped-header-footer-editing`, and `typed-drawings-and-images` that none of them introduced a second revision model. Each defers to this change; verify rather than assume
- [ ] 6.7 Confirmation before accept-all / reject-all
- [ ] 6.8 Every comment-derived string set as text content, never assigned as markup — comment parts are attacker-controlled
- [ ] 6.9 Localized dates; i18n keys; `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 6.10 Sidebar mousedown `preventDefault()` except on INPUT/SELECT/TEXTAREA; keyboard reachability
- [ ] 6.11 `bun run api:extract`, `bun run check:parity`

## 7. Fixtures — fill the gaps around the coverage that already exists

Counts are measured per part; see the fixture-evidence tables in `proposal.md`. Author only what is listed as missing.

- [ ] 7.1 Use `list-pagination-break.docx` and `issue-319-sections.docx` as the basic insert/delete/property-change corpus. Author `revisions-basic.docx` only if a small, readable case is wanted alongside them — the coverage itself is not missing
- [ ] 7.2 Move **range markers are already covered**: `list-pagination-break.docx` carries four complete named pairs (`move234347936`–`move234347939`) whose starts have `@w:name`/`@w:author`/`@w:date` and whose ends have `@w:id` only. Assert against it directly. Author `revisions-move-orphan.docx` for the one missing case: a `w:moveTo` whose named `moveFrom` half is absent
- [ ] 7.3 Property changes are **already covered** by `list-pagination-break.docx` — `w:tblPrChange`, `w:tblPrExChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, and `w:tblGridChange` all occur there. Assert against it; author nothing
- [ ] 7.4 Paragraph-mark revisions are **already covered**: 377 `w:pPr/w:rPr/w:ins`/`w:del` in `list-pagination-break.docx`, 16 in `issue-319-sections.docx`. Author `revisions-paragraph-marks.docx` only if a small readable split/merge case is wanted for the merge-on-accept assertion
- [ ] 7.5 `revisions-nested.docx` — an insertion by one author inside a deletion by another. **Genuinely missing**
- [ ] 7.6 Row and cell revisions are **partly covered**: 8 `w:cellIns` and 24 `w:cellDel` in `list-pagination-break.docx`. Author `revisions-cell-merge.docx` for `w:cellMerge` alone, which occurs in no fixture
- [ ] 7.7 **`issue-68-large-comments-suggestions.docx` is not a threaded fixture.** It ships `commentsExtended.xml`, but all 212 `w15:commentEx` entries carry `w15:done` only and the repository contains zero `w15:paraIdParent`. Use it for the resolved-state and comment-`w14:paraId` cases. Author `comments-threaded.docx` for threading, `commentsIds.xml`, and `commentsExtensible.xml` — all three are missing, and threading is a prerequisite for reply, not an extra
- [ ] 7.8 `comments-overlapping.docx` — overlapping and nested ranges, a comment anchored in a header, and a comment range spanning a table boundary. **Genuinely missing**
- [ ] 7.9 Keep the comprehensive fixture as the no-thread-data case: four flat comments, no sibling parts, no `w14:paraId`, and one comment whose text says "Reply:" and is not one
- [ ] 7.10 Revisions outside the body are **already covered** and must be asserted, not assumed: `header3.xml` in `list-pagination-break.docx` (5 `w:ins`), `footer1.xml`/`footer3.xml` in `issue-319-sections.docx`, and `endnotes.xml` in `endnotes-tracked-changes.docx` (its only revision — `document.xml` has none)
- [ ] 7.11 `styles.xml` in `list-pagination-break.docx` carries `w:pPrChange` and `w:rPrChange` inside the `Normal` and `NoList1` **style definitions**, with `w:id="0"` and `w:id="1"` — ids also in use in `document.xml`. Assert that a style-definition revision is never presented as a document-flow revision, and that the colliding ids resolve to different revisions

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
- [x] 11.3 Spec scenarios for **paragraph-mark revisions** (`EG_ParaRPrTrackChanges`) added to `revision-model`, covering accept-merges and reject-merges in both directions
- [ ] 11.4 Add accept/reject semantics for **row and cell revisions** — `w:trPr/w:ins`/`w:del`, `w:cellIns`/`w:cellDel`/`w:cellMerge`. Until they exist, `design.md` R11 refuses these kinds with `unsupported` (task 3.8) rather than removing the markup and leaving the row, which is the corruption finding 2.3 identified
- [x] 11.5 `@w:name` is now the stated move-pairing key in `revision-model`, alongside the separate `@w:id` join that pairs a range start to its range end. Both are asserted against `list-pagination-break.docx`
- [ ] 11.6 Read and write document-level `w:trackRevisions`; handle `w:documentProtection/@w:edit="trackedChanges"`, `w:doNotTrackMoves`, `w:doNotTrackFormatting` — the last two contradict current requirements
- [ ] 11.7 Add the four `w:customXml*RangeStart`/`End` pairs, `w:tblPrExChange`, `CT_ParaRPrChange`, `w:numPr/w:ins`, `w:delInstrText`
- [ ] 11.8 Declare a D12 impact class, and say how a display-mode switch invalidates a change-scoped layout session without a `ModelChange` (finding 4)
- [ ] 11.9 Add an IME rule: one composition in suggesting mode is ONE `w:ins` and one D10 history entry, not a chain
- [ ] 11.10 Comment anchors are specified only inside a paragraph; `EG_RangeMarkupElements` also sits between paragraphs, rows, and cells (finding 2)
- [ ] 11.11 State what a tracked note insertion, control value change, and drawing deletion are — the other four changes defer to requirements that do not yet exist (finding 3)
- [ ] 11.12 Add the missing `## MODIFIED` spec delta for `core-comment-ops`

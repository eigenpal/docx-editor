## 0. Baseline before code

- [ ] 0.1 Author the tracked-changes fixture from §7.1 **first**. No fixture in this repository contains a single `w:ins`, `w:del`, `w:moveFrom`, or property-change wrapper, so nothing in `revision-model` is observable or testable until one exists
- [ ] 0.2 Load that fixture in the demo and record what renders today. The expected finding is that inserted and deleted text both render as ordinary text, indistinguishable from final content. Confirm it rather than assume it
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

- [ ] 6.1 Wire `review.comments` and `review.editingMode` in `SLOT_COMMANDS` — both are declared and unwired today
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

## 7. Fixtures — tracked changes have zero coverage in this repository

- [ ] 7.1 `revisions-basic.docx` — `w:ins`, `w:del` with `w:delText`, two authors, dates, and `<w:trackChanges/>` in settings. **Author this before task 0.2**
- [ ] 7.2 `revisions-moves.docx` — a `w:moveFrom` / `w:moveTo` pair with range markers, plus one orphaned half
- [ ] 7.3 `revisions-properties.docx` — `w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`
- [ ] 7.4 `revisions-nested.docx` — an insertion by one author inside a deletion by another
- [ ] 7.5 `revisions-tables.docx` — `w:cellIns`, `w:cellDel`, `w:cellMerge`
- [ ] 7.6 `comments-threaded.docx` — `commentsExtended.xml` with `@w15:paraIdParent` and `@w15:done`, `commentsIds.xml`, `commentsExtensible.xml`, and real `w14:paraId` values
- [ ] 7.7 `comments-overlapping.docx` — overlapping and nested ranges, plus a comment anchored in a header
- [ ] 7.8 Keep the comprehensive fixture as the no-thread-data case: four flat comments, no sibling parts, no `w14:paraId`, and one comment whose text says "Reply:" and is not one

## 8. Retire the superseded spec

- [ ] 8.1 `openspec/specs/core-comment-ops/spec.md` specifies ProseMirror transaction builders that no longer exist. Archive or rewrite it in this change, **carrying its id-allocation requirement forward verbatim** against the store's allocator. Do not leave two contradictory descriptions standing, and do not lose the requirement

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

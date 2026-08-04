## 0. Baseline before code

- [x] 0.1 Inventory the tracked-change coverage that already exists. Done and recorded per part in `proposal.md`. Result: move range markers, row and cell revisions, `w:sectPrChange`, `w:tblPrExChange`, `w:tblGridChange`, `w:delInstrText`, and paragraph-mark revisions are all already covered; a comment reply, `w:cellMerge`, an orphaned move half, a nested two-author case, and overlapping comment ranges are not
- [x] 0.1a Source-level confirmation of the layout gap: `piecesOfParagraph` in `packages/core/src/layout/field-projection.ts` ends with `for (const child of paragraph.children) if (child.kind === 'run') processRun(child, 1)`. Runs nested in `w:ins` / `w:del` are never visited, so tracked content does not reach layout
- [ ] 0.2 Load `list-pagination-break.docx` in the demo and record what renders today, confirming the source-level finding in 0.1a in the browser rather than inferring it
- [ ] 0.3 Load `comprehensive-word-element-test.docx` and confirm its four comments are invisible in the editor
- [ ] 0.4 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.5 Confirm with review that the D8 boundary expansion — revision family, comment markup, comment bodies as stories — is accepted before typing any node

## 1. Typed revision nodes

- [x] 1.1 Add the revision family to the node-kind union in `ooxml-tree.ts`: `w:ins`, `w:del`, `w:delText`, `w:moveFrom`, `w:moveTo`, the four move-range markers, the seven property-change wrappers, and `w:cellIns` / `w:cellDel` / `w:cellMerge`
- [x] 1.2 Type `CT_TrackChange` provenance: required `@w:id` and `@w:author`, optional `@w:date`; never fabricate a date
- [x] 1.3 Part-scoped revision addressing. Structurally guaranteed: `applyTreeOp` takes the part, so an address without one is unrepresentable rather than refused at runtime
- [ ] 1.4 Instance-scoped, monotonic, no-reuse id allocation per part — carried forward from `core-comment-ops`, re-stated against the store
- [ ] 1.5 Normalized serialization; canonical-fingerprint equality on an unedited round trip of the tracked fixture

## 2. Revision layout

- [x] 2.1 `w:delText` never flows as ordinary text: it contributes model offsets but is laid out only inside a deletion, and only in modes that show it. A bare `w:delText` outside any wrapper is suppressed unconditionally
- [x] 2.2 Deleted content leaves the caret space in every display mode, via `caretStops` — the one seam every navigation command reads
- [ ] 2.3 Insertion, deletion, and move presentation, each visually distinct
- [ ] 2.4 Property changes as a paragraph or table indicator, adding no inline text to the flow
- [x] 2.5 Display modes: all-markup, proposed result, original. Asserted against accept-all / reject-all output, on synthetic markup and on `issue-319-sections.docx`
- [ ] 2.5a **Known gap, asserted rather than hidden**: the resolved display modes suppress CONTENT by containment but do not merge paragraph marks, while accept-all does. The two agree on what the document says and disagree on how many paragraphs say it. Block-level projection closes this; the differential test asserts the divergence so it fails when that lands
- [x] 2.6 Switching display mode applies no op and leaves the package fingerprint-identical. Invalidation rides the measurement producer, so a mode change invalidates the break cache and session checkpoints without a `ModelChange` (closes 11.8's question)

## 3. Accept and reject

- [x] 3.1 accept-revision, reject-revision, accept-all, reject-all in `store/store/tree-op-revisions.ts`
- [x] 3.2 Per-kind semantics: insertion, deletion, property change — including `w:delText` → `w:t` on rejecting a deletion
- [x] 3.3 Move pairs resolve together; accepting a `moveTo` alone is unreachable from any path
- [x] 3.4 Orphaned move half degrades to insertion or deletion semantics with a diagnostic
- [x] 3.5 Implement the containment rule declared in `design.md` R6 — the outer decision settles whether the content exists, and an inner revision survives exactly when the content does. Assert the result is identical under depth-first and breadth-first resolution
- [x] 3.6 accept-all and reject-all are one transaction, one `ModelChange`, one undo
- [x] 3.7 Paragraph-mark revisions: accepting `w:pPr/w:rPr/w:del` merges with the following paragraph, rejecting `w:pPr/w:rPr/w:ins` does the same. Removing the element alone is the wrong behaviour and must be asserted against
- [x] 3.8 Per `design.md` R11, every revision kind without defined structural semantics is refused with `unsupported` and no `ModelChange`. Refusing kinds in this pass: `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:trPr/w:ins`/`w:del`, `w:trPrChange`, `w:tcPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:tblGridChange`, `w:sectPrChange`. Assert the tree is unchanged after a refusal
- [x] 3.9 Accept/reject resolves within a named part. Assert against the colliding `w:id="0"` in `list-pagination-break.docx`'s `styles.xml` and `document.xml` that neither resolution touches the other part

## 4. Suggesting mode

- [ ] 4.1 Store-level mode carrying the configured author; refuse enabling with no author
- [ ] 4.2 Typing produces `w:ins`; deleting live text produces `w:del` with `w:delText`
- [ ] 4.3 Deleting one's own pending insertion removes it rather than wrapping it
- [ ] 4.4 Formatting produces `w:rPrChange` recording the previous properties
- [ ] 4.5 Prove an agent command is tracked identically, since the mode lives in the store

## 5. Comments

- [x] 5.1 Type `w:commentRangeStart`, `w:commentRangeEnd`, `w:commentReference`, and `CT_Comment` with `@w:initials`
- [ ] 5.2 Comment bodies become stories — coordinate with `typed-notes-footnotes-endnotes`, which extends `storyBlocks` for the same reason; land the extension once
- [x] 5.3 Read `commentsExtended.xml` thread state (`threadStateOfPart`). `commentsIds.xml` / `commentsExtensible.xml` still to load —, `commentsIds.xml`, `commentsExtensible.xml` under the existing bounded-parse and safe-relationship rules
- [ ] 5.4 Allocate `w14:paraId` on first thread write only **in `comments.xml`**; assert a load-layout-save with no comment write adds none there and that part stays fingerprint-identical. The main part is already normalized at load by `normalizeParagraphIdentity` (`store/package/para-id.ts`, called from `binding/tree-session.ts`) for `DocAnchor` addressing; do not extend it to the comment part and do not revert it. See `design.md` R8
- [x] 5.4a Reply against a tracked change commits as `addComment` over that revision's range, per `design.md` R12
- [x] 5.5a Anchors resolve as ranges over node identity plus offsets, with both boundaries counting for activation
- [ ] 5.5b Durability across insert, split, join, and partial delete — still to assert
- [ ] 5.6 **Choose and write down the orphan policy** — retain-and-report or delete — then implement it. It must not be decided by whichever branch the code happens to take
- [x] 5.7 Overlapping and nested comment ranges
- [ ] 5.8 Anchors in headers, footers, and note bodies
- [x] 5.9a add-comment and reply implemented
- [ ] 5.9b edit, delete, resolve/reopen still to do; add-comment refused with `locked` inside a locked content control still to do
- [ ] 5.10 Diagnostics for a dangling reference and for unmatched range markers

## 6. React adapter

- [x] 6.1a `review.editingMode` is wired: Editing / Suggesting / Viewing, with the current mode in the snapshot and in `ToolbarCommandState.value`
- [~] 6.1 `review.comments` is wired: it runs `toggleReviewPane`, a view command, so the button's pressed state comes from `isActive` like every other button and the pane state rides the snapshot. `review.editingMode` is still unwired (it needs the current-VALUE reporting that 6.2a describes)
- [ ] 6.2 Add `review.accept`, `review.reject`, `review.acceptAll`, `review.rejectAll`, `review.displayMode`; ids are public API forever
- [~] 6.2a `ToolbarCommandState` now carries an optional `value`, and `review.editingMode` reports through it — the single widening this task asked for. `image.wrap` reuses it rather than growing a second channel. `review.displayMode` still needs wiring. Was: `review.displayMode` and `review.editingMode` must report their **current value**, which `ToolbarCommandState` cannot express — it carries only a boolean `active`. Coordinate with `typed-drawings-and-images`, which needs the same for `image.wrap`; widen `ToolbarCommandState` once rather than adding a parallel mechanism
- [x] 6.3 Review rail shipped as `DocxEditor.Review` with its parts, over `useReview()`. Cards sit at anchors taken from layout records via `reviewItemGeometry`; the adapter never measures painted DOM. Stacking is opt-in and takes measured card heights from the caller, since only the caller knows how tall its own card is
- [ ] 6.4 Card↔range selection in both directions; next-change and previous-change navigation across stories
- [x] 6.4a Caret activation: a caret inside a commented range or a revision makes that item active, opens its card with the reply affordance ready, and highlights the range. Derived from the selection against layout ranges, so click, keyboard, and navigation activate identically. Both sides of the caret are considered, so a caret resting at a range's end still activates it; the innermost range wins when ranges nest; a resolved comment does not activate
- [ ] 6.4b The active range is marked with a dataset attribute on the painted span. It is never expressed by building a CSS rule from an interpolated comment or revision id
- [ ] 6.5 **Settle the delete-parent-with-replies policy against a Word comparison** before implementing reply deletion
- [ ] 6.6 **Cross-change check**: confirm with `typed-notes-footnotes-endnotes`, `typed-content-controls`, `scoped-header-footer-editing`, and `typed-drawings-and-images` that none of them introduced a second revision model. Each defers to this change; verify rather than assume
- [ ] 6.7 Confirmation before accept-all / reject-all
- [x] 6.8 Every comment-derived string is rendered as React text content; the rail builds no markup from file data
- [ ] 6.9 Localized dates; i18n keys; `bun run i18n:fix`, `bun run i18n:validate`
- [x] 6.10 Rail mousedown calls `preventDefault()` except on INPUT/SELECT/TEXTAREA; cards are focusable and take Enter/Space, and the card's own key handler ignores events from its children so the reply box keeps its spaces
- [ ] 6.11 `bun run api:extract`, `bun run check:parity`

## 7. Fixtures — fill the gaps around the coverage that already exists

Counts are measured per part; see the fixture-evidence tables in `proposal.md`. Author only what is listed as missing.

- [ ] 7.1 Use `list-pagination-break.docx` and `issue-319-sections.docx` as the basic insert/delete/property-change corpus. Author `revisions-basic.docx` only if a small, readable case is wanted alongside them — the coverage itself is not missing
- [ ] 7.2 Move **range markers are already covered**: `list-pagination-break.docx` carries four complete named pairs (`move234347936`–`move234347939`) whose starts have `@w:name`/`@w:author`/`@w:date` and whose ends have `@w:id` only. Assert against it directly. Author `revisions-move-orphan.docx` for the one missing case: a `w:moveTo` whose named `moveFrom` half is absent
- [ ] 7.3 Property changes are **already covered** by `list-pagination-break.docx` — `w:tblPrChange`, `w:tblPrExChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, and `w:tblGridChange` all occur there. Assert against it; author nothing
- [ ] 7.4 Paragraph-mark revisions are **already covered**: 377 `w:pPr/w:rPr/w:ins`/`w:del` in `list-pagination-break.docx`, 16 in `issue-319-sections.docx`. Author `revisions-paragraph-marks.docx` only if a small readable split/merge case is wanted for the merge-on-accept assertion
- [x] 7.5 Nested two-author revisions are **already covered**, contrary to the earlier note. `list-pagination-break.docx` carries a `w:del` by "John Doe" inside a `w:ins` by "Author", over the text "Amended thatagreement functionality ". Note the direction: the real-world case is a reviewer deleting part of an EARLIER author's insertion, which is the mirror of the insertion-inside-deletion the design describes. The containment rule covers both, and both are asserted
- [ ] 7.6 Row and cell revisions are **partly covered**: 8 `w:cellIns` and 24 `w:cellDel` in `list-pagination-break.docx`. Author `revisions-cell-merge.docx` for `w:cellMerge` alone, which occurs in no fixture
- [ ] 7.7 **`issue-68-large-comments-suggestions.docx` is not a threaded fixture.** It ships `commentsExtended.xml`, but all 212 `w15:commentEx` entries carry `w15:done` only and the repository contains zero `w15:paraIdParent`. Use it for the resolved-state and comment-`w14:paraId` cases. Author `comments-threaded.docx` for threading, `commentsIds.xml`, and `commentsExtensible.xml` — all three are missing, and threading is a prerequisite for reply, not an extra
- [ ] 7.8 `comments-overlapping.docx` — overlapping and nested ranges, a comment anchored in a header, and a comment range spanning a table boundary. **Genuinely missing**
- [ ] 7.9 Keep the comprehensive fixture as the no-thread-data case: four flat comments, no sibling parts, no `w14:paraId`, and one comment whose text says "Reply:" and is not one
- [ ] 7.10 Revisions outside the body are **already covered** and must be asserted, not assumed: `header3.xml` in `list-pagination-break.docx` (5 `w:ins`), `footer1.xml`/`footer3.xml` in `issue-319-sections.docx`, and `endnotes.xml` in `endnotes-tracked-changes.docx` (its only revision — `document.xml` has none)
- [ ] 7.11 `styles.xml` in `list-pagination-break.docx` carries `w:pPrChange` and `w:rPrChange` inside the `Normal` and `NoList1` **style definitions**, with `w:id="0"` and `w:id="1"` — ids also in use in `document.xml`. Assert that a style-definition revision is never presented as a document-flow revision, and that the colliding ids resolve to different revisions

## 8. Cross-part writes — a blocker this change did not anticipate

- [x] 8.1 **Was:** `TreeDocumentStore` held ONE `OoxmlPart`. `private current: OoxmlPart`, and transactions, undo and `ModelChange` are all scoped to it. Every comment write spans five parts: range markers and the reference in the story, the body in `comments.xml`, thread state in `commentsExtended.xml`, a relationship in `document.xml.rels`, and a content-type override. `TreeDocOp` cannot express that, so add-comment and reply are not implementable as `TreeDocOp`s
- [x] 8.2 Package-level transaction seam landed: the store holds the package and edits a named story part; `ctx.applyTo(partName, op)` and `ctx.applyPackage(edit)` stage across parts; history entries hold a package reference, so undo reverses every part one intent wrote. Two package invariants run at the commit boundary — no relationship to a part the package lacks, and every part typed. Primitives: `withNewPart`, `withRelationship`, `withContentTypeOverride`, editing `[Content_Types].xml` and the `.rels` parts as TREES so untouched entries keep their authored bytes. Was:: many parts, one `ModelChange`, one undo entry, with the same validate-then-apply discipline `applyTreeOp` has. Nothing may escape between the unvalidated intermediate and the validated result
- [ ] 8.3 **Cross-change check**: `typed-notes-footnotes-endnotes` needs the same seam for `footnotes.xml`/`endnotes.xml`, and `typed-drawings-and-images` for media parts and their relationships. Whichever lands first owns it; the others reuse it rather than each growing a private multi-part path
- [x] 8.4 Resolved by 8.2 and 8.5: the reply affordance is now backed by a real write, so it can be rendered
- [x] 8.5 `addComment` / reply implemented on the seam (`store/store/comment-writes.ts`), with `insertCommentMarker` placing the story markup. Covers part creation, relationship, content type, comment id seeded from the document, `w14:paraId` minted on write only, and the `w14` root binding the attribute needs

- [x] 6.11 Queue derived from the TREE (`layout/review-model.ts`), not from laid-out spans: a queue read off the painted page empties by half when the reader switches display mode, and the changes that vanished become unreachable from the surface meant to resolve them
- [x] 6.12 Six `Editor` members carry the whole surface — `getReviewItems`, `getReviewRevision`, `setActiveReviewItem`, `acceptReviewItem`, `rejectReviewItem`, `replyToReviewItem` — and publish presentation-ready placements, so neither adapter derives author, initials, date or body text from the tree
- [x] 6.13 A reply to a parent carrying no `w14:paraId` mints one for the parent in the same transaction rather than refusing; only the comment being replied to is touched
- [x] 6.14 Commented ranges are highlighted in the document, and the item the caret is in draws a deeper band — comments in yellow, a tracked change in its own colour. One layer over the pages, multiplying, from `keyedRangeRects` in a single pass over the lines
- [x] 6.15 Clicking the canvas around the page closes the open item; the surface owns that flag so the band and the card cannot disagree
- [x] 6.16 The pane collapses to a marker per item, and the document re-centres for whichever state it is in — ruler included
- [x] 6.17 Performance: paragraph anchors are indexed once per layout (`reviewAnchorIndex`) instead of a document walk per card, and the rail mounts only the cards inside the scroll window. A 423-item document toggles the pane in under a millisecond of main-thread work
- [x] 6.20 The compose card joins the stacking run, below anything already at that anchor — it is a card, and rendered outside the run it landed on top of the comment whose text had just been re-selected. The BUTTON is pulled out of the column onto the page edge instead, where there is nothing to collide with
- [x] 6.19 Comment on a selection: a button appears beside the selected range (`getSelectionPlacement`, so no adapter derives geometry) and opens a compose box. Nothing is written until it is submitted — an empty `w:comment` is a real comment in the file. The range is pinned with `retainSelection` while the box has focus, and a backwards drag anchors the same range as a forwards one
- [x] 6.18 The rail reads `publishedLayout()`, never `layout()`. The flushing accessor turned every keystroke into a synchronous full layout pass — measured at 11.2 SECONDS per read on a 2432-block document with 423 review items; 3.4ms after. Band rectangles are additionally bounded to the materialized pages, and items anchored off-screen are skipped before anything about them is measured

- [x] 6.22 Suggesting COALESCES the way Word does. An insertion extends the `w:ins` the caret is already in; a deletion joins an adjacent one by the same author, reusing its whole `CT_TrackChange` triple — sharing only the id left a fresh timestamp per keystroke, and since a revision is identified by (id, author, date) the run split back into one card per character. Adjacent wrappers that are the same revision are folded into one element
- [x] 6.23 Replacement is ONE card. The insertion adopts the identity of the deletion it replaces (same `CT_TrackChange` triple, bounded to a 60s editing window so an old deletion by the same author is never absorbed), and the halves are written in Word's order — struck text, then what takes its place. `pairReplacements` additionally pairs an adjacent delete+insert by ADJACENCY for files this engine did not write, where the halves carry different ids; both addresses ride on the card and accept/reject resolves them in one transaction. Adjacency is measured on the deletion's LAST range against the insertion's FIRST, because one edit becomes several `w:del` elements whenever the struck text crosses a run that holds no text — an endnote or footnote reference, a field, a break — and requiring one range each turned that into a Deleted card plus an Inserted card
- [x] 6.24 **Structural edits are tracked.** Enter writes `w:pPr/w:rPr/w:ins` on the FIRST paragraph (§17.13.5 — its mark is the one the split introduced), and Backspace at a paragraph start writes `w:pPr/w:rPr/w:del` on the first paragraph and leaves BOTH paragraphs standing, so rejecting restores the boundary as well as the words. New op `setParagraphMarkRevision`; the resolve side already merged forward. A run of Enters coalesces into one decision by joining a neighbouring same-author mark from the same moment. `w:rPr` is placed per `CT_PPr` — after the base properties, before `w:sectPr`/`w:pPrChange` — which is what the tree invariant was catching when it read as first. Was:: Enter and Backspace-at-a-paragraph-start still split and join outright in suggesting mode instead of writing `w:pPr/w:rPr/w:ins|w:del` paragraph marks. Task 11.3's scenarios describe the accept/reject side; the WRITE side is missing
- [x] 6.21 Viewing is RUNTIME state, not the construction-time `EditorConfig.mode`: `exec` and `can` both refuse with `locked`, and switching back restores editing without a remount

- [x] 6.25a `commitReviewOps` re-raises the model-moved flag after its flush and reports a RESULT rather than a boolean. The flag is one-shot: the flush inside the thunk consumed it, so the final render adopted the stale DOM selection back over the clamp and the caret jumped to the paragraph start. The boolean lost the refusal reason, so a refused accept cleared `lastRejection` instead of setting it
- [x] 6.25 Review writes go through the surface's commit path (`commitReviewOps`), not straight to the session: applying them directly skipped relayout, repaint and the caret clamp, so after an Accept the pages painted text the tree no longer had and every keystroke was refused with `offset-out-of-range` until the user clicked elsewhere
- [x] 6.26 `viewing` refuses at the SURFACE through a GATED SESSION every lane shares. Gating one function was not enough: breaks, lists, indent, section properties, formatting, hyperlinks and the IME readback are separate lanes over the same session and each reached it directly, so a read-only document still took Ctrl-B and a page-orientation change, and suggesting mode wrote an untracked tab. Review writes (accept, reject, comment, reply) are gated in `commitReviewOps` for the same reason. Was: `viewing` refuses at the SURFACE, not only at `Editor.exec`. The keymap and `beforeinput` are wired to the surface, so a facade-only gate left the document fully typeable while the toolbar reported it read-only
- [x] 6.27 Suggesting with no ambient author refuses a DELETION rather than writing it untracked. The one mode whose promise is "nothing is destroyed" must not destroy text when it cannot attribute the proposal
- [x] 6.28 `nextRevisionId` counts only revision `@w:id`s, strictly parsed and clamped to 2147483647. It scanned every `w:id` in the part — bookmark ids are a different, attacker-controlled and unbounded space, and a 23-digit one produced `w:id="1e+22"`: not an integer, and a file Word calls unreadable
- [x] 6.29 `w:delText` gets `xml:space="preserve"` like `w:t`. Without it a conformant reader drops edge whitespace from struck text, so REJECTING the deletion restored the words with their spacing already gone
- [x] 6.30 A `w:ins`/`w:del` on a RUN's `w:rPr` is refused rather than treated as a paragraph mark — accepting one merged two paragraphs. An insertion no longer descends into a `w:del`, where it would have been written as `w:t` inside a deletion that could take it away on accept
- [x] 6.31 The review model's offsets count a tab and a break as one, matching `segmentsOf`. They counted zero, so every card in a paragraph containing a tab reported a range short by one per tab

- [x] 6.32 Replacement pairing requires the same editing MOMENT and the same paragraph. Adjacency alone folded two edits an hour apart into one card; the cross-paragraph rule never checked that the deletion sat at the END of its paragraph, so "deleted mid-paragraph, then inserted at the start of the next" — routine in a reviewed document — merged two unrelated revisions into one Accept
- [x] 6.33 `asChild` on the review rail clones the consumer's element ONCE, keeping its own children and appending the rail's. The first shape rendered nothing; the second rendered the consumer's element once per card
- [x] 6.34 The React-only review exports are recorded in `intentional-export-divergence.md`, with the reason a faithful Vue twin is blocked: the compose box pins the selection through `editor.surface.retainSelection()`, and `surface` is the escape hatch rather than the contract

- [x] 6.44 A multi-paragraph delete in suggesting mode strikes the text AND proposes the mark between the paragraphs, instead of joining them outright — reject now restores the original exactly
- [x] 6.35 Accepting a deleted paragraph mark on the LAST paragraph of a container keeps the paragraph and drops the mark. It spilled the runs into `w:body`/`w:tc`, which the invariants reject, so the whole transaction refused and Accept All failed for the entire document with an opaque reason — on the file Word writes for "deleted a trailing paragraph with tracking on"
- [x] 6.36 A revision is grouped by its ELEMENT as well as its `(id, author, date)`. `@w:id` has no uniqueness constraint and Word writes one date per editing burst, so an insertion and a deletion could share all three: they showed as one `insert` card with both texts run together, whose Accept deleted the half the card claimed to insert
- [x] 6.37 An authorless revision is LISTED, read-only, instead of being skipped. Skipped, it was invisible in the pane and invisible to Accept All, which then reported success over a document that still held tracked markup
- [x] 6.38 Comment offsets descend into hyperlinks, so commenting on link text — or on anything after a link, or at the end of that paragraph — is no longer refused with `offset-out-of-range`
- [x] 6.39 `snapshot().editable` answers for the LIVE mode; a document opened `mode: 'view'` refuses the mode control rather than letting the pill read "Editing" over a read-only document; and a destroyed editor answers `notFound` for every command instead of `ok`
- [x] 6.40 Band keys split on NUL rather than `#`, which an author name can contain; a band whose range spans off-screen pages is kept; the rect cache compares page sets by value; a dismissed item no longer hides the ones beneath it; and band measurement falls back to a caret-page window when the scroller is unknown, instead of measuring every page (30ms per keystroke)
- [x] 6.41 `lastRejection` reaches `EditorSnapshot`. The engine always knew why an edit was refused and never published it, so a keystroke refused for viewing — or for suggesting with no author — looked like the editor had stopped responding
- [x] 6.42 Revision and comment dates are written to the second, like Word's; comments carry `CommentText` and `CommentReference`
- [x] 6.43 React: root-level part overrides are consumed (six parts advertised the rung and did nothing); the card is a named `button` that takes focus from the mouse and leaves its text selectable; each marker names its own item; closing a compose box returns focus to the document; the mode menu follows the ARIA menu keyboard model and reads its enabled state from `toolbarCommandState`; `useReview` returns a memoized result

- [x] 6.45 Undo and redo are gated by the mode. They reached the session directly — past `applyOps`, `applyPmDoc` and `commitReviewOps` alike — so Ctrl+Z silently rewound a document the toolbar called read-only
- [x] 6.46 Suggesting with no author refuses EVERY edit, not only the destructive ones. Insertions were landing untracked while the pill said Suggesting and the pane stayed empty — half the keyboard proposing and half editing outright
- [x] 6.47 Proposing to delete a paragraph mark YOU proposed adding retracts it (a real join) instead of re-labelling it `w:del`, which left a break that Reject then made permanent. Another author's mark is kept beside yours — `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`, and stripping every revision took theirs out of the file
- [x] 6.48 A merge proposal is addressed by the SECOND paragraph (`proposeParagraphMerge`), so a multi-paragraph delete marks each paragraph's own predecessor instead of stamping the group head N times — which left one empty paragraph per selected paragraph on accept. Refused when there is no preceding sibling in the same container, which also stops a `w:del` mark landing on the last paragraph of a `w:tc`
- [x] 6.49 Splitting a run inside a `w:del` keeps writing `w:delText`. It built `w:t` unconditionally, so commenting on struck text or bolding across it silently re-labelled the deletion as live text — corrupting the markup only once the file reached Word
- [x] 6.50 The replacement text is inserted AFTER the struck words. A tracked deletion keeps its characters, so inserting at the selection start put the replacement before them: mid-sentence replacements showed as two unrelated cards and a reviewer could accept one half
- [x] 6.51 A paragraph-mark revision anchors at the paragraph's END, where the pilcrow is. Collapsed to offset 0, a tracked Enter's card never opened at the break that made it, activating it threw the caret to the paragraph start, and its zero-width range painted no band
- [x] 6.52 `w:instrText` becomes `w:delInstrText` inside a deletion (§17.16.23) — the reject path already renamed it back, so the write path could never produce what that code exists to undo. Extending your own `w:ins` is bounded to the same editing moment, matching the deletion path. A stale refusal is cleared when the mode changes

## 9. Verification and honest scope

- [ ] 9.1 **Vue is not done.** The rail is React-only; the Vue twin over the same `Editor` members is the follow-up. `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Open the follow-up before merge; do not describe either lane as supported
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

- [x] 11.1 **Settled: the mode lives on the SURFACE, the ops stay explicit.** `insertText`/`deleteText` carry an optional `revision` attribution, so an op still says on its face whether it is tracked and there is no global toggle for `DocEdits` to reject. The surface — the one thing that knows a keystroke happened — attaches the attribution at a single interception point, so no emit site can forget and silently write an untracked edit in suggesting mode. Implemented in `store/store/tree-op-tracked.ts`, with Word's merge rules: typing extends your own `w:ins`, deleting your own insertion removes it rather than nesting `w:del`, and deleting inside an existing `w:del` is a no-op
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

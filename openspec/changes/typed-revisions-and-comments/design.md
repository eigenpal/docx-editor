# Design — typed revisions and comments

## Context

`typed-ooxml-paragraph-editor` is the production authority. This change closes two of its deferred lanes together — tracked changes and comments — because they share anchor infrastructure, a review surface, and one chrome group.

The current failure is not "the feature is missing". `piecesOf` in `packages/core/src/layout/paragraph-flow.ts` walks only direct children of kind `run` and `continue`s on everything else. `w:ins` and `w:del` are `generic`, so their nested runs are never reached and **tracked content is dropped from layout entirely** — the insertion does not appear, and neither does the deletion.

A reviewer therefore sees a third text: not the original, not the proposal, and not a merge. The markup survives the save, so nothing signals the loss until the file is compared in Word.

The distinction matters for what gets built: the requirement is not only "`w:delText` is never laid out as ordinary text" but "tracked content reaches layout at all, under a presentation the display mode selects". An implementation that merely styles what already flows would fix nothing, because nothing flows.

The same root cause hits inline content controls, whose runs are also nested inside a `generic` wrapper — `typed-content-controls` owns that half.

Comments fail quietly instead: the anchors are generic and invisible and `comments.xml` is not a story, so the review thread does not exist in the editor at all.

## Decisions

### R1: Provenance is required at the API, because the schema requires it

`CT_TrackChange` makes `@w:author` required. An API that lets a caller create a revision without one either writes invalid XML or invents an author. Requiring it — and refusing suggesting mode with no author — makes the invalid state unrepresentable rather than repaired later.

`@w:date` is optional in the schema and stays optional here. Fabricating a date on a file that omits one is a silent content change.

### R2: Revision identity is the (id, author, date) triple, not (part, id)

`@w:id` is `ST_DecimalNumber` on `CT_Markup`, with no uniqueness constraint and no author scoping. Addressing a revision by `(part, id)` is therefore wrong twice over.

Two authors' revisions may legally carry the same id in one part, so `(part, id)` merges distinct revisions. And one logical revision is deliberately many elements sharing an id — a tracked row insertion writes `w:trPr/w:ins` on the row and `w:cellIns` on each cell — so a uniqueness rule cannot express the most common structural revision at all.

The identity is the `(id, author, date)` triple, resolved within a named part, and accept/reject resolves every site carrying that triple in one transaction and one undo step.

The part still matters: a body revision and a footnote revision may share a triple, so an address without a part is refused rather than resolving to whichever part is searched first.

### R3: Deleted content leaves the caret space

Excluding `w:delText` from layout is not enough. If the caret can enter deleted content, a user types inside text that does not exist in either the original or the proposal, and there is no valid tree for the result. Stepping over a deletion is the same treatment a note reference gets.

### R4: Display modes are layout inputs, not document mutations

"Show final" must not be implemented as accept-all. A user who switches to final view, saves, and sends the file would ship a document with every proposal silently accepted.

Specifying the modes as equal to accept-all and reject-all *output* gives a strong differential test — layout in proposed-result mode must equal layout after accept-all — without either mutating anything.

### R5: A move is one decision

`w:moveFrom` and `w:moveTo` are two halves of one intent. Accepting the `moveTo` without the `moveFrom` duplicates the content; rejecting the `moveFrom` without the `moveTo` does the same. Making the pair the unit removes an entire class of corruption, and the surface must not offer the half.

An orphaned half is a real file condition — Word produces one when the other half is deleted — so it degrades to insertion or deletion semantics with a diagnostic, rather than refusing the document.

### R6: Nested revisions resolve by containment, not by traversal order

An insertion by author A inside a deletion by author B is ordinary in a two-round review. Accepting the outer deletion has to decide what happens to the inner insertion, and the answer must not change when an unrelated part of the walker is refactored.

**The rule: containment governs existence, and a surviving container preserves its inner revisions verbatim.**

| Action on the outer revision | Content | Inner revision |
| --- | --- | --- |
| Accept `w:del` | removed | removed with it |
| Reject `w:del` | kept | preserved, still pending |
| Accept `w:ins` | kept | preserved, still pending |
| Reject `w:ins` | removed | removed with it |

Read plainly: the outer decision settles whether the content exists at all. An inner revision is a pending decision *about that content*, so it survives exactly when the content survives, and it is never silently resolved on the inner author's behalf.

Stating the rule on containment rather than on visit order is what makes it traversal-independent. A depth-first and a breadth-first walker both have to answer "is this node inside a revision that was removed", and they agree.

### R11: A partial implementation refuses, it does not approximate

Accept and reject land before every revision kind has defined structural semantics. The kinds without them SHALL be refused with `unsupported` and surfaced as read-only on the review surface, rather than resolved by the nearest available rule.

The case that forces this: accepting a tracked row deletion by removing the `w:del` inside `w:trPr` leaves the row in the table. The markup is gone, the reviewer sees the decision applied, and the document now says the opposite of what was accepted. A refusal is visible and recoverable; that is not.

`list-pagination-break.docx` contains 8 `w:cellIns`, 24 `w:cellDel`, 4 `w:trPrChange`, and 34 `w:tcPrChange`, so refusals are not a theoretical branch. They will be on screen the first time the fixture is opened, and the surface must state the engine's reason rather than hide the card.

### R12: Replying to a tracked change is a comment, because OOXML has nothing else

`w:ins` and `w:del` carry `(@w:id, @w:author, @w:date)` and no body. There is no reply, no thread, and no text on a revision anywhere in the schema.

A reply offered against a revision is therefore an `addComment` whose anchor is that revision's resolved range, and the surface threads the comment under the change because their ranges overlap. This is the only faithful reading. Storing reply text on the revision itself would require inventing markup, which would either be dropped by Word or make the file invalid.

It follows that reply is a comment write, with comment id allocation, `w14:paraId` on the comment paragraph, and `commentsExtended.xml`. A build that ships revision rendering without comment writes cannot offer reply at all, and should not render the affordance.

### R7: Threads live in the sibling parts, and prose is not evidence

`comments.xml` has no parent pointer and no resolved flag. Threading is `w15:commentEx/@w15:paraIdParent` in `commentsExtended.xml`; resolution is `@w15:done`.

The comprehensive fixture has none of the three sibling parts, and comment `w:id="3"` opens with the word "Reply:". Inferring a thread from that text would work on this file and fail on every file whose replies do not announce themselves — and would produce false threads on files where a comment merely quotes the word.

So: no sibling part, no thread. The surface says the file has no thread data rather than pretending or guessing.

### R8: Comment `w14:paraId` is allocated on write, never on load

Thread state is keyed by `w14:paraId` on **comment** paragraphs, and the comprehensive fixture has zero across the whole package. Allocating them on load would rewrite a document nobody edited, which breaks canonical-fingerprint equality on an untouched round trip.

Allocating on the first thread write is the smallest change that keeps both properties: an untouched document is untouched, and a replied-to document gains exactly the ids the reply needs.

**Scope correction.** An earlier draft stated this for every paragraph in the package. That contradicts shipped behaviour: `normalizeParagraphIdentity` in `packages/core/src/store/package/para-id.ts` mints paraIds for the **main part** at session open, called from `binding/tree-session.ts`, because `DocAnchor.paraId` addresses paragraphs by that value and an unidentified paragraph is unaddressable.

The two are reconciled by scope, not by reverting either:

- **Main part**: normalized at load, as shipped. Its byte-stability early return returns the input part unchanged when every paragraph already has a valid unique id, so any document Word saved round-trips identically. Documents that lack ids gain them, and that is the accepted cost of addressability.
- **`comments.xml`**: never normalized at load. Comment paraIds are minted only when a comment or reply is written, so a document that is opened and saved without a comment write gains none.

The requirement in `comment-thread-model` is therefore about comment paragraphs specifically, and the "no allocation without a write" scenario is asserted against the comment part.

### R9: Comment bodies are stories

A comment body is block content — `CT_Comment` extends `CT_TrackChange` with `EG_BlockLevelElts`. Making it a story reuses `storyBlocks` and gives the sidebar measured, styled text instead of a concatenated string. It is the same move `typed-notes-footnotes-endnotes` makes for note bodies, and the two changes should land the story-root extension once, not twice.

### R10: Comment text is attacker-controlled

Author names, initials, and body text come from a file. `.docx` is a zip of XML an attacker fully controls. The requirement that comment text is set as text content and never assigned as markup is a security requirement, not a style preference, and it belongs in the spec so a reviewer can check it.

## Open questions

1. **What happens to replies when their parent is deleted?** Word promotes them in some versions and deletes them in others. The requirement demands one declared policy; which one needs a Word comparison. Task 6.5.

2. **Orphaned-comment policy: retain or delete?** `citations-and-annotations` in the previous engine's spec set required "collapse, detach, tombstone, or delete according to that rule" without choosing. Retaining an orphan is friendlier to a reviewer; deleting matches Word. Task 5.6 requires the choice be made and written down, not left to the implementation.

3. **Interaction with the other four changes.** Tracked insertion of a footnote reference, tracked value change in a content control, tracked deletion of a floating image, and comments anchored in a header all cross change boundaries. Each of the other proposals defers to this one; this one must not invent a second revision model when it gets there. Whichever pair lands second reconciles, and task 6.6 requires an explicit check rather than an assumption.

4. **`w:rsid` values.** Preserved and not interpreted. They are session-tracking noise that Word writes and that no reader needs, and generating them would add churn to every save.

5. **Collaboration stays deferred.** `deferred-features.md` keeps replication in its own lane. Durable anchors are a prerequisite for it, so this change moves toward it; it must not start it.

6. **Vue parity.** Out of scope by request; no production support claim follows from this change alone.

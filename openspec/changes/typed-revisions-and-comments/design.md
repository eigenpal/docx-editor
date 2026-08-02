# Design — typed revisions and comments

## Context

`typed-ooxml-paragraph-editor` is the production authority. This change closes two of its deferred lanes together — tracked changes and comments — because they share anchor infrastructure, a review surface, and one chrome group.

The current failure is not "the feature is missing". `piecesOf` in `packages/core/src/layout/paragraph-flow.ts` walks only direct children of kind `run` and `continue`s on everything else. `w:ins` and `w:del` are `generic`, so their nested runs are never reached and **tracked content is dropped from layout entirely** — the insertion does not appear, and neither does the deletion.

A reviewer therefore sees a third text: not the original, not the proposal, and not a merge. The markup survives the save, so nothing signals the loss until the file is compared in Word.

This corrects an earlier draft of this design, which claimed tracked content rendered *as ordinary text*. It does not, and the difference matters: the requirement that follows is not only "`w:delText` is never laid out as ordinary text" but "tracked content reaches layout at all, under a presentation the display mode selects". Any implementation that merely styles what already flows would fix nothing, because nothing flows.

The same root cause hits inline content controls, whose runs are also nested inside a `generic` wrapper — `typed-content-controls` owns that half.

Comments fail quietly instead: the anchors are generic and invisible and `comments.xml` is not a story, so the review thread does not exist in the editor at all.

## Decisions

### R1: Provenance is required at the API, because the schema requires it

`CT_TrackChange` makes `@w:author` required. An API that lets a caller create a revision without one either writes invalid XML or invents an author. Requiring it — and refusing suggesting mode with no author — makes the invalid state unrepresentable rather than repaired later.

`@w:date` is optional in the schema and stays optional here. Fabricating a date on a file that omits one is a silent content change.

### R2: Revision ids are part-scoped

`@w:id` is unique within a part. A body revision and a footnote revision can both be `4`. Addressing by id alone resolves to whichever part is searched first, which is a correctness bug that only shows up on documents with tracked notes — exactly the documents most likely to be under review.

Refusing an id-without-part address is better than defaulting to the body, because the default is right often enough to hide the bug.

### R3: Deleted content leaves the caret space

Excluding `w:delText` from layout is not enough. If the caret can enter deleted content, a user types inside text that does not exist in either the original or the proposal, and there is no valid tree for the result. Stepping over a deletion is the same treatment a note reference gets.

### R4: Display modes are layout inputs, not document mutations

"Show final" must not be implemented as accept-all. A user who switches to final view, saves, and sends the file would ship a document with every proposal silently accepted.

Specifying the modes as equal to accept-all and reject-all *output* gives a strong differential test — layout in proposed-result mode must equal layout after accept-all — without either mutating anything.

### R5: A move is one decision

`w:moveFrom` and `w:moveTo` are two halves of one intent. Accepting the `moveTo` without the `moveFrom` duplicates the content; rejecting the `moveFrom` without the `moveTo` does the same. Making the pair the unit removes an entire class of corruption, and the surface must not offer the half.

An orphaned half is a real file condition — Word produces one when the other half is deleted — so it degrades to insertion or deletion semantics with a diagnostic, rather than refusing the document.

### R6: Nested revisions need a declared order, not a traversal artifact

An insertion by author A inside a deletion by author B is ordinary in a two-round review. Accepting the outer deletion has to decide what happens to the inner insertion. Whatever the answer, it must be the same regardless of whether the tree is walked depth-first or breadth-first, and it must be written down. Leaving it to traversal order produces a result that changes when an unrelated part of the walker is refactored.

### R7: Threads live in the sibling parts, and prose is not evidence

`comments.xml` has no parent pointer and no resolved flag. Threading is `w15:commentEx/@w15:paraIdParent` in `commentsExtended.xml`; resolution is `@w15:done`.

The comprehensive fixture has none of the three sibling parts, and comment `w:id="3"` opens with the word "Reply:". Inferring a thread from that text would work on this file and fail on every file whose replies do not announce themselves — and would produce false threads on files where a comment merely quotes the word.

So: no sibling part, no thread. The surface says the file has no thread data rather than pretending or guessing.

### R8: `w14:paraId` is allocated on write, never on load

Thread state is keyed by `w14:paraId`, and the fixture has **zero** across the whole package. Allocating them on load would rewrite a document nobody edited, which breaks canonical-fingerprint equality on an untouched round trip.

Allocating on the first thread write is the smallest change that keeps both properties: an untouched document is untouched, and a replied-to document gains exactly the ids the reply needs.

### R9: Comment bodies are stories

A comment body is block content — `CT_Comment` extends `CT_TrackChange` with `EG_BlockLevelElts`. Making it a story reuses `storyBlocks` and gives the sidebar measured, styled text instead of a concatenated string. It is the same move `typed-notes-footnotes-endnotes` makes for note bodies, and the two changes should land the story-root extension once, not twice.

### R10: Comment text is attacker-controlled

Author names, initials, and body text come from a file. `.docx` is a zip of XML an attacker fully controls. The requirement that comment text is set as text content and never assigned as markup is a security requirement, not a style preference, and it belongs in the spec so a reviewer can check it.

### R11: `core-comment-ops` is superseded in part, not deleted

`openspec/specs/core-comment-ops/spec.md` specifies ProseMirror transaction builders (`createCommentTr`, `replyTr`, `proposeChangeTr`) — the previous architecture, where PM transactions were the write path. They are gone.

Its second requirement is not architecture-specific: instance-scoped, monotonic, no-reuse id allocation, so two editors on one page do not share a counter. That survives verbatim and is re-stated against the store's allocator. Deleting the whole spec would lose a requirement that was learned from a real bug.

## Open questions

1. **What happens to replies when their parent is deleted?** Word promotes them in some versions and deletes them in others. The requirement demands one declared policy; which one needs a Word comparison. Task 6.5.

2. **Orphaned-comment policy: retain or delete?** `citations-and-annotations` in the previous engine's spec set required "collapse, detach, tombstone, or delete according to that rule" without choosing. Retaining an orphan is friendlier to a reviewer; deleting matches Word. Task 5.6 requires the choice be made and written down, not left to the implementation.

3. **Interaction with the other four changes.** Tracked insertion of a footnote reference, tracked value change in a content control, tracked deletion of a floating image, and comments anchored in a header all cross change boundaries. Each of the other proposals defers to this one; this one must not invent a second revision model when it gets there. Whichever pair lands second reconciles, and task 6.6 requires an explicit check rather than an assumption.

4. **`w:rsid` values.** Preserved and not interpreted. They are session-tracking noise that Word writes and that no reader needs, and generating them would add churn to every save.

5. **Collaboration stays deferred.** `deferred-features.md` keeps replication in its own lane. Durable anchors are a prerequisite for it, so this change moves toward it; it must not start it.

6. **Vue parity.** Out of scope by request; no production support claim follows from this change alone.

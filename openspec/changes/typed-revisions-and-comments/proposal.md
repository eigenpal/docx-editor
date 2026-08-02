## Why

`deferred-features.md` carries two entries this change closes together, because they share anchor infrastructure and a review surface:

- **Tracked changes**: parse `generic preserved`; model `untyped revision wrappers`; layout `deferred`; edit `deferred, including accept/reject`. Gate: "typed revisions and provenance, review projection, accept/reject `DocOp`s, layout, save/reopen conformance, and paired acceptance."
- **Comments and annotations**: parse `generic preserved with relationships and anchor markup`; model `untyped anchors and bodies`; layout `deferred`; edit `deferred`. Gate: "durable typed anchors, comment operations, presentation, orphan/overlap policy, save/reopen conformance, and paired acceptance."

The failure mode is specific and bad. A `w:ins` wrapper is a generic node holding typed runs; those runs flow, so **inserted text renders as ordinary text and deleted text inside `w:del` renders as ordinary text too** — because `w:delText` is preserved and, being text, is laid out. A reviewer opening a tracked document sees a merged document that is neither the original nor the proposal, with no indication that any of it is proposed. Nothing warns them.

Comments fail the other way: `w:commentRangeStart` / `w:commentRangeEnd` / `w:commentReference` are generic and invisible, and `word/comments.xml` is never a story, so a document's entire review thread silently does not exist in the editor.

Two chrome slots already declare the intent — `review.comments` and `review.editingMode` are in `CHROME_GROUPS` — and neither is in `SLOT_COMMANDS`, so both render disabled with "not wired to an editor command". This change wires them.

## What Changes

**Typed revisions**

- Add typed kinds for the revision family to `packages/core/src/store/package/ooxml-tree.ts`: `w:ins`, `w:del`, `w:delText`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`/`End`, `w:moveToRangeStart`/`End`, and the property-change wrappers `w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`, plus `w:cellIns`, `w:cellDel`, `w:cellMerge`.
- Every one extends `CT_TrackChange`, which extends `CT_Markup`: `@w:id` (required), `@w:author` (required), `@w:date` (optional). Provenance is required by the schema and SHALL be required by any operation that creates a revision — `author` is not optional at the API.
- Revision ids are unique **within a part**, not across the package. A revision is addressed by (part, id), never by id alone.

**Revision layout and rendering**

- Insertions render with the document's insertion presentation, deletions render as struck-through, and **`w:delText` is never laid out as ordinary text**. Move-from and move-to render distinguishably from a delete/insert pair.
- A display mode selects what layout produces: all markup, the proposed result (all accepted), or the original (all rejected). Changing mode re-lays out; it never mutates the tree.
- Property changes render as a change indicator on the affected paragraph or table, not as inline text.

**Accept and reject**

- `TreeDocOp` gains accept-revision, reject-revision, accept-all, reject-all, addressed by (part, id) or by a range.
- Accepting an insertion unwraps it; rejecting removes its content. Accepting a deletion removes the content and converts `w:delText` back to nothing; rejecting unwraps it and converts `w:delText` to `w:t`. A move is accepted or rejected as a **pair** — accepting the `moveTo` without the `moveFrom` duplicates content.
- Nested revisions — an insertion by one author inside a deletion by another — have a defined resolution order, and it is stated rather than left to traversal order.

**Typed comments**

- Type `w:commentRangeStart`, `w:commentRangeEnd`, `w:commentReference`, and `word/comments.xml`'s `CT_Comment` (`CT_TrackChange` plus `@w:initials`, with block content).
- Read the sibling parts that carry thread state: `commentsExtended.xml` (`w15:commentEx` — `@w15:paraIdParent`, `@w15:done`), `commentsIds.xml` (`w16cid` durable ids), `commentsExtensible.xml` (`w16cex` UTC dates). Threading and resolved state live there, not in `comments.xml`.
- Thread and resolved state require `w14:paraId` on comment paragraphs. Where absent, allocate on first write and record the allocation, rather than silently linking by position.

**Comment anchors and policy**

- Anchors are ranges over stable node identities plus offsets, surviving edits inside and around them, with declared affinity at each boundary.
- Orphan policy is explicit: what happens when the anchored range is entirely deleted, partially deleted, split, or joined. A comment SHALL NOT silently reattach to unrelated text.
- Overlapping and nested comment ranges are supported, since Word produces them.
- Comments anchored in a header, footer, or note body are addressable in that story, not only in the body.

**Suggesting mode**

- An editing mode in which every accepted user intent commits as a tracked revision carrying the configured author. It is a store-level mode, so an agent command and a keystroke both produce tracked results.

**React adapter**

- Wire `review.comments` and `review.editingMode` in `SLOT_COMMANDS`; add `review.accept`, `review.reject`, `review.acceptAll`, `review.rejectAll`, and `review.displayMode`.
- A review sidebar listing comment threads and revisions, anchored to their positions, with reply, resolve, accept, and reject.

## Capabilities

### New Capabilities

- `revision-model`: typed revision family, required provenance, part-scoped ids, accept/reject semantics, display modes, and rendering rules.
- `comment-thread-model`: typed comment markup, the sibling thread parts, `w14:paraId` allocation, durable anchors, and orphan/overlap policy.
- `review-surface`: chrome slots, suggesting mode, the sidebar, and navigation.

### Modified Capabilities

- `core-comment-ops` (`openspec/specs/core-comment-ops/spec.md`) specifies `createCommentTr` / `replyTr` / `proposeChangeTr` as ProseMirror transaction builders and a `createCommentIdAllocator()` with monotonic-no-reuse semantics. Those are from the previous architecture, where ProseMirror transactions were the write path. The write path is now `TreeDocumentStore.transact` over `TreeDocOp`s. The **id-allocation requirements survive and are re-stated against the store**; the transaction-builder requirements are superseded. `tasks.md` §8 requires that spec be archived or rewritten rather than left standing.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx`.

Comments — exercised:

| Feature | Evidence |
| --- | --- |
| Comment part | `word/comments.xml`, 4 `w:comment` (ids 0–3), related as `rId5` |
| Anchor markup | 4 `w:commentRangeStart`, 4 `w:commentRangeEnd`, 4 `w:commentReference` |
| Authors and dates | "QA Reviewer", "Legal Team", "Dev Lead", ISO-8601 dates |

Comments — **not** exercised:

- `commentsExtended.xml`, `commentsIds.xml`, and `commentsExtensible.xml` are all absent. **Threading and resolved state are not representable in this file.**
- `w14:paraId` — **zero occurrences in the entire package**. Even adding `commentsExtended.xml` would require allocating them first.
- `@w:initials` on any comment.
- Comment `w:id="3"` reads "Reply: I've added CJK and RTL examples." It is written as prose to look like a reply and is structurally a fourth independent top-level comment with its own anchor range. Treating it as a reply would mean inferring threads from text, which this change refuses to do.
- Comments anchored in a header, footer, or note.
- Overlapping or nested comment ranges.

Tracked changes — **entirely absent**:

- Zero `w:ins`, zero `w:del`, zero `w:delText`, zero `w:moveFrom` / `w:moveTo`, zero `w:rPrChange` / `w:pPrChange` / `w:tblPrChange`, zero `w:rsid`, and no `<w:trackChanges/>` in `word/settings.xml`.

**No fixture in this repository exercises tracked changes.** Every requirement in `revision-model` is unverifiable until the fixtures in `tasks.md` §7 exist. This is the single largest evidence gap across the five changes and is stated here rather than discovered during implementation.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — the revision family and comment markup as typed kinds.
- `packages/core/src/store/package/` — loading `commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml` with the existing bounded-parse and safe-relationship rules.
- `packages/core/src/store/store/tree-ops.ts` and siblings — accept/reject, comment CRUD, `w14:paraId` allocation, suggesting mode.
- `packages/core/src/layout/story-roots.ts` — comment bodies as stories.
- `packages/core/src/layout/semantic-layout.ts`, `semantic-records.ts` — revision presentation, display modes, comment anchor geometry.
- `packages/core/src/layout/semantic-interaction.ts` — `w:delText` excluded from ordinary caret space.
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — wire two declared slots, add five.
- `packages/react/src` — review sidebar, navigation, i18n.
- **Vue**: out of scope by request; no production support claim follows from this change alone.
- **Not included**: `w:permStart` / `w:permEnd` editing permissions, `w:rsid` session tracking (preserved, not interpreted), and collaboration — which `deferred-features.md` keeps in its own lane and which this change must not accidentally begin.

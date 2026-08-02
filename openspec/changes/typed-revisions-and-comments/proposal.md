## Why

`deferred-features.md` carries two entries this change closes together, because they share anchor infrastructure and a review surface:

- **Tracked changes**: parse `generic preserved`; model `untyped revision wrappers`; layout `deferred`; edit `deferred, including accept/reject`. Gate: "typed revisions and provenance, review projection, accept/reject `DocOp`s, layout, save/reopen conformance, and paired acceptance."
- **Comments and annotations**: parse `generic preserved with relationships and anchor markup`; model `untyped anchors and bodies`; layout `deferred`; edit `deferred`. Gate: "durable typed anchors, comment operations, presentation, orphan/overlap policy, save/reopen conformance, and paired acceptance."

The failure mode is worse than "unsupported". `packages/core/src/layout/paragraph-flow.ts` flattens a paragraph in `piecesOf`, which walks only **direct** children of kind `run`:

```ts
for (const child of paragraph.children) {
  if (child.kind !== 'run') continue;
```

`w:ins` and `w:del` are `generic`, so the runs nested inside them are never reached. **Tracked content is not laid out at all — it is silently dropped.** An insertion vanishes and a deletion vanishes, so a reviewer opening a tracked document sees neither the original nor the proposal but a third text that exists nowhere, with no warning. Saving it back preserves the markup, so the loss is invisible until someone compares in Word.

Comments fail the same way for a different reason: `w:commentRangeStart` / `w:commentRangeEnd` / `w:commentReference` are generic and invisible, and `word/comments.xml` is never a story, so a document's entire review thread does not exist in the editor.

Two chrome slots already name the intent — `review.comments` and `review.editingMode` are in `CHROME_GROUPS` — but both carry `state: { kind: 'parityOnly' }`, so the adapters short-circuit and render the localized `formattingBar.unavailableInPreview` rather than a disabled command. Enabling them needs **two** changes, not one: the `state` becomes `{ kind: 'command' }` **and** a row is added to `SLOT_COMMANDS`. A `SLOT_COMMANDS` row alone does nothing.

## What Changes

**Typed revisions**

- Add typed kinds for the revision family to `packages/core/src/store/package/ooxml-tree.ts`: `w:ins`, `w:del`, `w:delText`, `w:delInstrText`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`/`End`, `w:moveToRangeStart`/`End`, the four `w:customXml*RangeStart`/`End` pairs, and the property-change wrappers `w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`, plus `w:cellIns`, `w:cellDel`, `w:cellMerge`.
- **Three different base types, and they do not agree.** `w:ins` / `w:del` / `w:moveFrom` / `w:moveTo` and the property-change wrappers extend `CT_TrackChange` → `CT_Markup`: `@w:id` required, `@w:author` required, `@w:date` optional. The move **range starts** (`w:moveFromRangeStart`, `w:moveToRangeStart`) are `CT_MoveBookmark` → `CT_Bookmark`: `@w:name` **required**, `@w:author` required, and `@w:date` **required**, plus `@w:colFirst` / `@w:colLast`. The move **range ends** are `CT_MarkupRange` → `CT_Markup`: **no author and no date at all**. Requiring an author on a range end refuses valid files; writing one emits invalid XML.
- `@w:name` on the move range markers is the **join key** that pairs a `moveFrom` with its `moveTo`. Pairing is by name, not by proximity or id.
- **Paragraph-mark revisions.** `w:pPr/w:rPr` is `CT_ParaRPr`, which opens with the `EG_ParaRPrTrackChanges` group: `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`. These mark *the paragraph mark itself*, and they are how Word records a paragraph split or merge. Accepting a deleted paragraph mark merges the paragraph with the following one.
- **Row and cell revisions carry their own semantics.** `CT_TrPr` holds `w:ins` / `w:del` / `w:trPrChange`; `CT_TcPr` holds `w:cellIns` / `w:cellDel` / `w:cellMerge`. Accepting a tracked row deletion removes the row, not merely the `w:del` element inside its `w:trPr`.
- **Revision identity is the `(id, author, date)` triple, within a named part.** `@w:id` is `ST_DecimalNumber` with no uniqueness constraint and no author scoping: two authors' revisions may share an id in one part, and one logical revision deliberately spans many elements sharing an id — a tracked row insertion is `w:trPr/w:ins` on the row plus `w:cellIns` on every cell. Addressing by `(part, id)` merges the first case and cannot express the second.

**Revision layout and rendering**

- Insertions render with the document's insertion presentation, deletions render as struck-through, and **`w:delText` is never laid out as ordinary text**. Move-from and move-to render distinguishably from a delete/insert pair.
- A display mode selects what layout produces: all markup, the proposed result (all accepted), or the original (all rejected). Changing mode re-lays out; it never mutates the tree.
- Property changes render as a change indicator on the affected paragraph or table, not as inline text.

**Accept and reject**

- `TreeDocOp` gains accept-revision, reject-revision, accept-all, reject-all, addressed by the triple within a part or by a range, resolving every site that shares the triple in one transaction.
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

- `revision-model`: typed revision family, required provenance, `(id, author, date)` identity and safe id allocation, accept/reject semantics, display modes, and rendering rules.
- `comment-thread-model`: typed comment markup, the sibling thread parts, `w14:paraId` allocation, durable anchors, and orphan/overlap policy.
- `review-surface`: chrome slots, suggesting mode, the sidebar, and navigation.

### Modified Capabilities

None.

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

Tracked changes — **entirely absent from this fixture**:

- Zero `w:ins`, zero `w:del`, zero `w:delText`, zero `w:moveFrom` / `w:moveTo`, zero `w:rPrChange` / `w:pPrChange` / `w:tblPrChange`, zero `w:rsid`, and no `w:trackRevisions` in `word/settings.xml`.

**The repository is not short of tracked-change fixtures.** Existing coverage in `e2e/fixtures/`:

| Fixture | Coverage |
| --- | --- |
| `list-pagination-break.docx` | 1114 `w:ins`, 1396 `w:del`, 1761 `w:delText`, 14 `w:moveFrom` / `w:moveTo`, plus `w:rPrChange` and `w:pPrChange` at scale |
| `issue-68-large-comments-suggestions.docx` | 212 `w:ins`, 105 `w:del`, **and `word/commentsExtended.xml`** |
| `issue-319-sections.docx` | insertions, deletions, `w:rPrChange`, `w:pPrChange` |
| `endnotes-tracked-changes.docx` | revisions inside a note part |

Roughly 20 fixtures carry `w14:paraId` and two carry `commentsExtended.xml`, so threading and durable-id work has real input too. Task §7 is therefore an inventory-then-fill exercise, not a from-scratch authoring block. What remains genuinely uncovered is narrower: the move **range markers** with `@w:name` pairing, row and cell revisions (`w:cellIns` / `w:cellDel` / `w:cellMerge`, `w:trPr/w:ins`), `w:sectPrChange`, and a deliberately nested two-author case.

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

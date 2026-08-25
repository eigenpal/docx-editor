# Mutation-boundary audit (tasks 3.1–3.4)

Read-only inventory of production canonical writes. Tests and DOM `Element.replaceChildren` are excluded from counts. This file does not change production code.

## Counts

| Item                                    | Count  | Source                                                                  |
| --------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `TreeDocOp` kinds                       | **69** | `TREE_DOC_OP_KINDS` in `packages/core/src/store/store/tree-op-types.ts` |
| Kinds `applyTreeOp` applies on one part | **57** | `packages/core/src/store/store/tree-op-apply.ts`                        |
| Kinds refused as package-lifecycle      | **10** | same file, `package-lifecycle-op`                                       |
| Kinds refused as unsupported            | **2**  | repeating-section items                                                 |
| Named tree primitives                   | **5**  | `packages/core/src/store/package/ooxml-edit.ts`                         |
| `replaceChildRange`                     | **0**  | named only in `tasks.md` 3.2; not implemented                           |
| Named package-shell hooks               | **7**  | `package-edit.ts`, `ooxml-package.ts`, `drawing-package-edit.ts`        |
| Duplicate `withContentTypeOverride`     | **2**  | `package-edit.ts` (tree) and `hf-lifecycle-shell.ts` (string patch)     |
| Unresolved production bypass classes    | **9**  | see [Unresolved bypasses](#unresolved-bypasses)                         |

## 3.1 Production write-path inventory

### Canonical tree primitives

File: `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/package/ooxml-edit.ts`

Internal helper `withChildren` (line 176) rebuilds one element. All four structural exports call `rebuild`, then `finish`.

| Export            | Role                                             | Production call sites (approx.)                  |
| ----------------- | ------------------------------------------------ | ------------------------------------------------ |
| `replaceChildren` | Replace one element's whole child list           | 51 calls / 16 canonical files (plus 4 DOM files) |
| `insertChildren`  | Insert a slice at an index                       | 52 calls / 18 files                              |
| `replaceNode`     | Replace one node, keep sibling index             | 40 calls / 13 files                              |
| `removeNode`      | Drop one node and its subtree                    | 22 calls / 12 files                              |
| `applyEdits`      | Compose the four as one deferred-validation step | 8 calls / 2 apply files + definition             |

`replaceChildRange` does not exist. Callers emulate a range splice by allocating a full next child array and calling `replaceChildren`.

Canonical callers (not tests, not DOM):

- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-apply.ts` (37 primitive calls; text, split/join, hyperlink, content-control, properties)
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-section.ts` (17)
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-tables.ts` (23, including `applyEdits`)
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-table-cell-properties.ts` (9, `applyEdits`)
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-drawings.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-toc.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-insert-table.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-insert-offset.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-comments.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-content-controls.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-content-control-insert.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-tracked.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-op-revisions.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/comment-writes.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/comment-resolution-rewrites.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/store/store/tree-package-images.ts`
- `/Users/timurkramar/GitHub/docx-editor/packages/core/src/collaboration/document-port.ts`
- Package orchestrators listed below (`hf-lifecycle.ts`, `note-lifecycle.ts`, `comment-lifecycle.ts`, `hyperlink-part.ts`, `numbering-part.ts`, `package-edit.ts`, `custom-xml-nodes.ts`, `custom-node-export.ts`, `package-shell-persistence.ts`, `drawing-package-edit.ts`, `note-lifecycle-props.ts`, `hf-lifecycle-shell.ts`, `note-lifecycle-shell.ts`)

Payload construction (`children: [...]` on a new node) is not a write. The write is the later primitive call. Layout `story-roots.ts` builds a projection and does not publish a package.

### Package, relationship, content-type, and binary hooks

| Hook                           | File                                                      | Role                                                                     |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `withPart`                     | `packages/core/src/store/package/ooxml-package.ts`        | Replace one XML part tree in the package map                             |
| `withNewPart`                  | `packages/core/src/store/package/package-edit.ts`         | Create XML part + content-type override                                  |
| `withoutPart`                  | same                                                      | Delete part, `.rels`, override, and inbound relationships                |
| `withRelationshipsPartFor`     | same                                                      | Create empty owner `.rels` tree                                          |
| `withRelationship`             | same                                                      | Append one `Relationship` child and update the relationship index        |
| `withContentTypeOverride`      | same                                                      | Parse `[Content_Types].xml` as a tree, splice Override, write bytes back |
| `withBinaryPart`               | `packages/core/src/store/package/drawing-package-edit.ts` | Copy bytes into `partBytes` and force an Override                        |
| `withEmbeddedImage`            | same                                                      | `withBinaryPart` + media name + relationship + `docPr` id                |
| `withoutUnreferencedImagePart` | same                                                      | Drop orphan media bytes and Override                                     |

`writeOoxmlPackage` in `ooxml-package.ts` serializes trees over `partBytes`. It is save output, not an editor mutation.

Orchestrators that compose those hooks:

| Orchestrator            | File                                                                                          | What it writes                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Header/footer lifecycle | `hf-lifecycle.ts` + `hf-lifecycle-shell.ts`                                                   | New/cloned/deleted header/footer parts, section refs, settings `evenAndOddHeaders`, content types, `.rels` |
| Note lifecycle          | `note-lifecycle.ts` + `note-lifecycle-shell.ts` + `note-lifecycle-props.ts`                   | Footnotes/endnotes parts, references, settings props                                                       |
| Comments                | `comment-writes.ts`, `comment-lifecycle.ts`, `comment-resolution-rewrites.ts`                 | `comments.xml`, `commentsExtended.xml`, markers, relationships                                             |
| Hyperlinks              | `hyperlink-part.ts`                                                                           | External relationship + `.rels` tree + `externalTargets` sidecar                                           |
| Images                  | `drawing-package-edit.ts`, `tree-package-images.ts`                                           | Media bytes, Override, owner relationship, drawing node                                                    |
| Numbering               | `numbering-part.ts`                                                                           | `numbering.xml` children + content-type byte patch                                                         |
| Custom XML              | `custom-xml-part.ts`, `custom-xml-nodes.ts`, `custom-node-export.ts`, `custom-node-writes.ts` | Item + props parts, relationships, node payloads                                                           |
| Shell persistence       | `package-shell-persistence.ts`                                                                | Restore numbering/hyperlink shell across undo; drop parked `.rels`                                         |
| Story store             | `tree-store.ts`, `tree-package-store.ts`                                                      | `withPart` after story ops; `replacePackageShell`; `applyLifecycleOp`                                      |
| Binding / automation    | `binding/tree-session.ts`, `automation/server-host.ts`                                        | `replacePackageShell` after hyperlink/comment/image/lifecycle grafts                                       |

## 3.2 `TreeDocOp` → mutation hooks

`applyTreeOp` never calls package hooks. Package-lifecycle kinds are refused there and applied in `TreePackageStore.applyLifecycleOp`.

### Refused on the single-part path (12)

| Kind                         | Hook                           | Notes                                                                                    |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `createHeaderFooter`         | `applyHeaderFooterLifecycleOp` | `withPart` + `withContentTypeOverride` + relationship splice + section `replaceChildren` |
| `deleteHeaderFooter`         | same                           | `withoutPart`-like GC via `partBytes.delete` (bypass) + ref `replaceChildren`            |
| `linkToPrevious`             | same                           | Drop declared ref; may GC orphan part                                                    |
| `unlinkFromPrevious`         | same                           | Clone part + clone `.rels` bytes + new Override + new relationship                       |
| `setSectionFurnitureOptions` | same                           | Section attrs + optional settings part                                                   |
| `insertNote`                 | `applyNoteLifecycleOp`         | Create notes part if missing; `insertChildren` on notes root and story                   |
| `deleteNote`                 | same                           | `removeNode` on note + every reference across stories                                    |
| `convertNote`                | same                           | Move note between parts (`removeNode` + `insertChildren`)                                |
| `convertAllNotes`            | same                           | Same, bounded loop                                                                       |
| `setNoteProperties`          | `note-lifecycle-props.ts`      | Settings and/or `sectPr` children                                                        |
| `addRepeatingSectionItem`    | none                           | `unsupported`                                                                            |
| `removeRepeatingSectionItem` | none                           | `unsupported`                                                                            |

### Applied on one part (57)

Text, tabs, breaks, and page fields share `applyInsertContent` / `applyDeleteText`:

| Kinds                                                                                                                                                      | Concrete hooks                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertText`, `insertTab`, `insertHardBreak`, `insertPageBreak`, `insertPageField`                                                                         | `replaceChildren` (split a `w:t`) or `insertChildren` (boundary / new run). Tracked `insertText` uses `tree-op-tracked.ts` then the same hooks. **No text-splice primitive.** |
| `deleteText`                                                                                                                                               | `removeNode` of atoms/runs; `replaceNode` of a shortened `w:t`; `replaceChildren` to unwrap empty hyperlink/revision wrappers                                                 |
| `setParagraphMarkRevision`, `proposeParagraphMerge`                                                                                                        | Tracked wrappers via `replaceChildren` / `insertChildren`, or `joinParagraphs` path                                                                                           |
| `insertCommentMarker`                                                                                                                                      | `insertChildren` at a split site (`tree-op-comments.ts`)                                                                                                                      |
| `acceptRevision`, `rejectRevision`, `acceptAllRevisions`, `rejectAllRevisions`                                                                             | `resolveRevisions` → `replaceChildren` on the part root (`tree-op-revisions.ts`)                                                                                              |
| `setListLevel`, `setListNumbering`, `setParagraphTabStops`, `setParagraphMarkProperties`                                                                   | `insertChildren` / `replaceNode` / `removeNode` under `w:pPr`                                                                                                                 |
| `splitParagraph`, `splitParagraphMany`                                                                                                                     | `replaceChildren` on the parent; new paragraph nodes minted                                                                                                                   |
| `joinParagraphs`                                                                                                                                           | `replaceChildren` on the survivor and parent (identity of moved runs is preserved only because the same node objects are spliced)                                             |
| `setRunProperties`                                                                                                                                         | Split runs then `replaceChildren` / `insertChildren` of `w:rPr`                                                                                                               |
| `setParagraphProperties`                                                                                                                                   | `replaceChildren` or `removeNode` of `w:pPr`, or `insertChildren` at index 0                                                                                                  |
| `setSectionProperties`, `setSectionMark`                                                                                                                   | Root or `w:pPr` child splice (`tree-op-section.ts`)                                                                                                                           |
| `insertHyperlink`                                                                                                                                          | Story: wrap via `replaceChildren`. Package: `ensureHyperlinkRelationship` **does not** call `withRelationship`                                                                |
| `setHyperlinkTarget`                                                                                                                                       | `replaceNode` with new attributes / namespace bindings                                                                                                                        |
| `removeHyperlink`                                                                                                                                          | `replaceChildren` splice of the link's children (identity-preserving unwrap)                                                                                                  |
| `setContentControlValue`, `setContentControlProperties`, `removeContentControl`, `insertInlineContentControl`, `insertContentControl`                      | `replaceNode` / `replaceChildren` (`tree-op-content-controls.ts`, `tree-op-content-control-insert.ts`)                                                                        |
| `deleteBlock`                                                                                                                                              | `removeNode` plus possible `insertChildren` of a required empty paragraph                                                                                                     |
| `insertTable`                                                                                                                                              | `insertChildren` of a minted table (`tree-op-insert-table.ts`)                                                                                                                |
| `insertTableRow`, `deleteTableRow`                                                                                                                         | `insertChildren` / `removeNode` / `replaceNode` (tracked row)                                                                                                                 |
| `insertTableColumn`, `deleteTableColumn`, `setTableColumnWidths`, `setTableRightEdgeWidth`, `setTableRowHeight`                                            | `applyEdits` of `replaceNode` + `insertChildren` + `removeNode`                                                                                                               |
| `setTableCellBorders`, `setTableCellFill`, `setTableCellVerticalAlignment`                                                                                 | `applyEdits` of `replaceNode`                                                                                                                                                 |
| `insertDrawing`                                                                                                                                            | `insertChildren` of a drawing node; resource is a separate package write                                                                                                      |
| `replaceDrawingResource`, `resizeDrawing`, `cropDrawing`, `positionDrawing`, `setDrawingWrap`, `setDrawingMetadata`, `setDrawingLocks`, `transformDrawing` | `replaceNode` of the drawing                                                                                                                                                  |
| `deleteDrawing`                                                                                                                                            | `removeNode`                                                                                                                                                                  |
| `insertToc`                                                                                                                                                | `insertChildren` of an SDT                                                                                                                                                    |
| `replaceTocResult`, `rewriteTocPageNumbers`                                                                                                                | `replaceChildren` of the TOC container / page-number runs                                                                                                                     |

Attribute and namespace changes always mint a new element object (`{ ...node, attributes, namespaceBindings }`) and pass it to `replaceNode` or include it in a child splice. There is no `setAttribute` / `setNamespace` primitive.

Move is not a primitive. `joinParagraphs`, hyperlink unwrap, content-control unwrap, and table cell rebuilds keep identity only when they put the **same object** into a new child array.

## 3.3 Package mutations child splices cannot represent

These cannot be expressed as `spliceChildren` on an existing story tree:

1. **XML part create** (`withNewPart`, header/footer/note/comment/customXml/numbering/settings mint).
2. **XML part delete** (`withoutPart`, header GC, image GC, custom XML removal).
3. **XML part rename** — no dedicated API. Would be create + delete + rewrite every relationship and Override.
4. **Binary put/replace** (`withBinaryPart` writes `partBytes`; trees never hold image/font bytes).
5. **Binary delete** (`withoutUnreferencedImagePart`, header clone cleanup).
6. **Content-type Override** while `[Content_Types].xml` is stored only as bytes, not as `pkg.parts`.
7. **Relationship index + `externalTargets` sidecar** — even when the `.rels` tree is spliced, `hyperlink-part.ts` also freezes a new `externalTargets` array. Readers resolve hyperlinks from that sidecar.
8. **Clone of a part plus its `.rels` bytes** (`cloneOwnedRelationships` copies `partBytes` for the dest `.rels`).
9. **`replacePackageShell`** — installs an arbitrary package snapshot (history restore, hyperlink mint, comment graft, numbering shell).

Child splices **can** represent relationship _markup_ once a `.rels` tree exists (`insertChildren` / `removeNode` on that part). They cannot create the part, the Override, or the sidecar in one compositional step today.

## 3.4 Smallest complete primitive journal

### Tree layer (intercept `ooxml-edit.ts`)

`applyEdits` is a transaction composer, not a replicated effect.

| Proposed primitive                                             | Replaces                                                                                          | Why it is required                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `spliceChildren(parentId, start, deleteCount, nodes)`          | `insertChildren`, `replaceChildren`, `removeNode` of a child, and the missing `replaceChildRange` | One CRDT list op. Today's `replaceChildren` is `splice(0, length, next)`.                                                              |
| `replaceNode(nodeId, next)`                                    | existing `replaceNode`                                                                            | Needed for whole-element rebuilds (drawing, hyperlink attrs) until attribute/namespace primitives exist. Root replace stays forbidden. |
| `spliceText(textNodeId, utf16Start, utf16DeleteCount, insert)` | split/`replaceNode` of `w:t`                                                                      | Concurrent typing cannot share a whole-node replace.                                                                                   |
| `setAttribute(nodeId, qname, value \| null)`                   | `{ ...el, attributes }` + `replaceNode`                                                           | Concurrent child edits must not collide with an attribute write.                                                                       |
| `setNamespaceBinding(nodeId, prefix, uri \| null)`             | `{ ...el, namespaceBindings }` + `replaceNode`                                                    | Same, for `r:id` on hyperlinks and minted `xmlns`.                                                                                     |
| `moveNode(nodeId, destParentId, destIndex)`                    | identity-preserving `replaceChildren` pairs                                                       | D2 kill gate: delete+insert mints a new logical id and drops concurrent descendant edits.                                              |

Do **not** journal `withChildren` (internal). Journal the exported functions.

### Package layer (intercept shell hooks, not `Object.freeze({ ...pkg })`)

If `[Content_Types].xml` and `.rels` become first-class canonical trees, relationship and content-type rows collapse to `spliceChildren` + `setAttribute` on those parts, plus `putXmlPart` for a missing `.rels`. They are **not** that today.

| Proposed primitive                                                               | Replaces                                                                | Why spliceChildren is not enough                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `putXmlPart(name, root)`                                                         | `withNewPart` / first `withPart` of a new name                          | Part directory entry + default identity allocation                         |
| `updateXmlPart(name, journal)`                                                   | `withPart` after tree primitives                                        | Same part, new tree revision                                               |
| `deleteXmlPart(name)`                                                            | `withoutPart`                                                           | Drops tree, bytes, inbound rels, Override                                  |
| `renameXmlPart(from, to)`                                                        | none today                                                              | Must rewrite every relationship Target and Override atomically             |
| `putRelationship(owner, record)` / `deleteRelationship(owner, id)`               | `withRelationship`, `ensureHyperlinkRelationship`, `removeRelationship` | Must keep `.rels` tree, `pkg.relationships`, and `externalTargets` aligned |
| `putContentTypeOverride(partName, mime)` / `deleteContentTypeOverride(partName)` | both `withContentTypeOverride` impls + numbering/shell string patches   | `[Content_Types].xml` is bytes                                             |
| `putBinary({ key, digest, size, mime })` / `deleteBinary(key)`                   | `withBinaryPart` / `withoutUnreferencedImagePart`                       | Bytes stay out of Yjs (design D5)                                          |

A local editor transaction becomes: plan `TreeDocOp` → emit this journal → apply one Yjs transaction → materialize one canonical package.

## Unresolved bypasses

These writes will miss a journal that only wraps the five `ooxml-edit.ts` exports and the seven named package hooks.

1. **Second `withContentTypeOverride`** — `hf-lifecycle-shell.ts` string-patches `[Content_Types].xml`. Same for `withNumberingContentType` in `numbering-part.ts` and `withNumberingContentTypeOverride` in `package-shell-persistence.ts`. `package-edit.ts` already parses that part as a tree. Three extra writers.

2. **`ensureHyperlinkRelationship`** — `hyperlink-part.ts` does `Object.freeze({ ...pkg, parts, externalTargets })` and does not call `withRelationship` / `withRelationshipsPartFor`.

3. **Header/footer `.rels` clone/delete** — `cloneOwnedRelationships` / `withoutOwnedRelationships` copy or delete `partBytes` and rebuild relationship maps.

4. **Header/footer part GC** — `hf-lifecycle.ts` ~line 800 does `partBytes.delete` instead of `withoutPart`.

5. **`replacePackageShell`** — `tree-package-store.ts`, `binding/tree-session.ts`, `automation/server-host.ts`. Can publish any package without a journal.

6. **`normalizeCollaborationTextPackage`** — extra `replaceNode` + `withPart` after `TreeDocOp` apply (`collaboration/document-port.ts`). Same primitives, second transaction unless folded into the journal.

7. **Comment package transaction** — `comment-writes.ts` uses `withNewPart` / `withRelationship` / `withPart` / `insertChildren` then `publishStoryWrite`. Outside `applyTreeOp`. Must still emit the journal.

8. **Numbering as mixed tree+bytes** — `numbering-part.ts` comments that `readOoxmlPackage` may keep numbering as bytes; the content-type patch is stringly. Decide tree vs bytes before journaling.

9. **Direct `Object.freeze({ ...pkg })` package maps** — `drawing-package-edit.ts` (`withBinaryPart` is the intended binary hook), `note-lifecycle-shell.ts`, `hf-lifecycle-shell.ts`, `package-edit.ts` internals. Lane guards in 3.7 must ban new copies.

False positives (not canonical writes): `editor/paginated-surface.ts`, `output/semantic-paint-drawings.ts`, `output/semantic-selection-overlay.ts`, `editor/surface-table-interaction.ts` call DOM `replaceChildren`.

## Design decisions required before 3.5

1. **Content types:** promote `[Content_Types].xml` to a canonical tree and delete the three string patchers, or keep a dedicated content-type primitive and route all writers through `package-edit.ts` only.

2. **Relationships:** treat `.rels` as ordinary XML parts and derive `pkg.relationships` / `externalTargets` on materialize, or journal `putRelationship` as a first-class package primitive. `ensureHyperlinkRelationship` must not stay a third path.

3. **Move:** first-class `moveNode` (needed for the D2 kill gate) versus delete+insert with a replicated logical id. The spike in section 2 still owns the empirical answer.

4. **Text / attributes / namespaces:** first-class splices versus whole-node `replaceNode`. Whole-node replace loses concurrent descendant or sibling-attribute edits.

5. **`replaceChildRange`:** implement as `spliceChildren` and make `replaceChildren` / `insertChildren` / child `removeNode` wrappers, or keep four exports and lower them all to one journal op.

6. **Part rename:** add `renameXmlPart` now, or forbid rename until a later milestone (header clone allocates a new name rather than renaming).

7. **`replacePackageShell`:** forbidden under collaboration except as materialize output, or itself a journaled snapshot primitive (conflicts with D3 “no command twin”).

8. **Binary descriptor:** digest, size, mime, storage key, and who calls blob put/get/retain (task 4.6–4.7). `withBinaryPart` is the production put path to wrap.

9. **Lifecycle ops:** one package transaction journal for the 10 lifecycle kinds (and comments, images, custom XML, numbering), not 10 command-specific Yjs handlers.

10. **Unsupported repeating-section kinds:** remain refused (no journal) until a later mutation class.

11. **Identity of minted nodes:** actor-scoped logical ids (D4) versus today's `createNodeIdAllocator` part-local ids. Journal capture in 3.5 can record current ids; collaborative minting waits for 4.3.

12. **`applyEdits` boundary:** one journal transaction per `applyEdits` / per `applyTreeOp` / per package `applyLifecycleOp`. Recommend: one journal per store transaction (already one undo unit).

## Mapping completeness vs design D3

Design D3 listed four structural functions plus `applyEdits`, and said text/attribute/namespace rebuilds pass through them. That is true for the 57 single-part kinds.

D3 also listed package hooks `withPart`, `withNewPart`, `withoutPart`, `withRelationship`, `withContentTypeOverride`, `withRelationshipsPartFor`, `withBinaryPart`. Those exist, but they are **not** the only package writers. The string-patch content-type paths, `ensureHyperlinkRelationship`, `.rels` byte clones, `partBytes.delete`, and `replacePackageShell` are the gaps 3.6–3.7 must close or classify as extra primitives.

## Recommended intercept points for 3.5 (no code in this audit)

1. `finish` in `ooxml-edit.ts` — every tree primitive already returns here.
2. `withPart` / `withNewPart` / `withoutPart` / `withRelationship` / `withContentTypeOverride` / `withBinaryPart` — package effects.
3. Ban additional `Object.freeze({ ...pkg, partBytes })` in store/package except inside those hooks (task 3.7).
4. Route `ensureHyperlinkRelationship` and both content-type duplicates through (2).
5. Emit the journal from `TreePackageStore` commit (`applyTreeOps`, `applyLifecycleOp`, comment/image/custom-xml grafts), not from each `TreeDocOp` kind.

## Decision resolution

The architecture review resolved the twelve questions before task 3.5:

1. Keep dedicated content-type effects and route every string patcher through one implementation.
2. Keep dedicated relationship effects and derive relationship plus external-target sidecars atomically.
3. Use first-class `moveNode` with stable logical identity.
4. Use first-class text, attribute, and namespace effects.
5. Lower existing structural exports to one journal-level `spliceChildren`; do not add a production `replaceChildRange`.
6. Keep XML part rename unsupported until the authorable manifest adds it.
7. Forbid `replacePackageShell` during active collaboration except validated bootstrap, materialization, or generation replacement.
8. Use the content-addressed blob lease and descriptor contract in design D18.
9. Emit one package journal for every lifecycle and composite store transaction.
10. Keep repeating-section operations refused.
11. Use a random 128-bit replica identity plus a monotonic counter for new logical IDs.
12. Emit one journal per `TreePackageStore` transaction.

These decisions unblock task 3.5. The nine bypass classes remain implementation work
for tasks 3.5 through 3.7.

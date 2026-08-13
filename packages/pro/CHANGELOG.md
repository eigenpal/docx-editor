# @docx-editor.dev/pro

## 2.3.0

## 2.2.1

### Patch Changes

- dd78558: Allow custom Add Comment controls, review lists, card templates, and empty states to compose without replacing one another.

## 2.2.0

## 2.1.3

## 2.1.2

## 2.1.1

## 2.1.0

### Minor Changes

- 3310029: Defining a custom node is an identity, a shape and what the document shows: `defineCustomNode({ name, tagPrefix, schema, text })`. `text` replaces the `toDocx` hook that returned an attrs-and-text pair, and `tagAttrs` covers the rarer case of putting identity in the `w:tag` as well. `defineCustomNode` returns a `CustomNode` carrying `dataOf`, which narrows a node to that definition and validates its payload against that definition's schema — so a host reads a typed value from the chip, the review rail or its own state without writing a parse at the call site.
- 3310029: `defineCustomNode` takes `schema`, declaring a node's payload shape as a zod (or any Standard Schema) schema, and `preserveOnExport`, declaring whether the node survives a document leaving the system that made it.
- 3310029: A custom node can now be written with a payload: `insertCustomNode` and `updateCustomNode` take `data`, typed by the definition's `schema` and stored in a customXml data part the control binds to, so a node is no longer limited to the 64 characters `w:tag` holds. Recognition hands that payload back typed, `prepareForExport` applies `preserveOnExport`, and `customNodeXml` answers the store parts a server-side splice has to add.
- 3310029: `customNodesOf(editor)` answers every recognized custom node in the document with its payload, so reading them no longer means reaching for three engine internals. Diagnostics are now scoped to the editor whose module registered them: two editors on one page hear only their own documents, and a listener goes when its editor does.
- 7a72c42: Custom-node writes now target the story the reader is in, so a chip inside a header can be removed and updated rather than reporting that no node has that id, and all of them refuse a document open for viewing instead of editing it. The context menu reports a refused Remove through the new `onRemoveRefused` prop instead of closing with the node still there. `useStackedReviewPositions` now places an entry whose anchor has not resolved yet, matching the packaged rail. Previously such an entry was dropped and took no room; cards after it now shift down by whatever the entry reserves (its measured height, or `defaultHeight`, plus the gap).
- 3310029: Custom node writes now return the id of the control they authored, so a host can follow a node across a rewrite. Clicking a chip also activates reliably: activation is driven by the press and release rather than `click`, which the browser does not fire at all when the press repaints the control.
- 3310029: `insertCustomNode` and `updateCustomNode` now take a single input object, and a definition can declare `toDocx` to derive its tag attrs and document text from its payload — so `insertCustomNode(editor, Citation, { data })` is the whole call and the three representations of a node cannot disagree. A payload the schema rejects returns `issues` carrying each failing field's path, and `prepareForExport` takes a `destination` so one call site covers both the copy you keep and the copy that leaves.
- dbf5501: Every remaining `ep-` prefixed CSS class and keyframe is renamed to `docx-editor-`, so the whole stylesheet shares one namespace with the `.docx-editor` root class. If your own CSS targets an `.ep-*` class or the `ep-caret-blink` keyframe, switch it to the same name under `docx-editor-` (`.ep-one-surface__caret` becomes `.docx-editor-one-surface__caret`).
- 8b4830e: `useReview().accept` and `.reject` now report whether the resolution landed, like `remove` and `reply` already did. `readOnly` is not the only way the engine refuses one — a document open for viewing refuses every one — and swallowing the result left hosts rendering live buttons that did nothing when clicked.
- 21e9b30: `saveForExport(editor)` produces the copy of a document that leaves your system, applying each definition's `preserveOnExport` to every node type registered on the editor; `editor.save()` is unchanged and still keeps every node. The bytes-level entry point, for a server with no editor, is now `prepareForExport`.

### Patch Changes

- 3310029: Fixes three ways a custom node's payload could be lost: exporting a node with `preserveOnExport: false` no longer leaves its payload in a store a surviving node keeps alive, the open-time orphan sweep no longer collects a payload a header or footer still binds, and `updateCustomNode` without `data` now carries the existing payload forward instead of dropping it (pass `data: null` to remove one). A definition no longer needs a `reviewCard` for its nodes to carry `data`, and a binding naming a payload the document does not hold is reported through `onDiagnostic` rather than arriving as silence.
- 3310029: `prepareForExport` now strips every payload store for a namespace rather than the first, so a document whose nodes were authored server-side with `customNodeXml` — which writes one store per call — no longer ships the payloads of nodes it removed.
- d116599: Custom nodes can be inserted, updated and removed inside a header, footer or note, including a node carrying a payload: the control lands in that story while its customXml store stays on the main document part, where Word looks for it. Which story a write targets now comes from the node or paragraph id rather than from wherever the reader happens to be, so a caller can address a node in a story it has left. Inserting, updating and removing all refuse a document open for viewing instead of editing it — these writes go through the store, below the editing-mode gate — and report the same `locked` code the engine's own refusal uses.
- 3310029: Fixes four ways a write could lose data. `text` and `tagAttrs` now derive from the schema's output rather than the caller's argument, so a `.default()` or `.transform()` no longer writes a document describing a value it does not hold; a hook that throws is a typed refusal instead of an exception; `updateCustomNode` carries the tag attrs, the alias and the lock forward when they are not mentioned, and refuses a node belonging to another definition rather than converting it; and `prepareForExport` unwraps every story before cleaning up stores, so a chip in a header no longer ships the payload it was asked to strip.
- 8b4830e: The review rail's `structural` and `formatting` filters now also govern which changes a click in the document can activate, so clicking tracked text always opens a card the rail actually shows.
- 03f57f3: Chrome that describes the document no longer renders before one is present. The review rail keeps its empty state and host furniture off screen until a document opens instead of floating them over the loading screen, the ruler parts render nothing rather than default Letter-size ticks for a page that does not exist, and the navigation pane and document outline no longer report "no headings" about an absent document. The same applies after a parse failure or a detach, not only while loading. `useReview().ready` reports false until a document is present and the hook now re-derives when a load fails.

## 2.0.1

### Patch Changes

- Updated dependencies [51f14f5]
  - @docx-editor.dev/core@2.0.1
  - @docx-editor.dev/react@2.0.1

## 2.0.0

### Minor Changes

- 26095c6: Deleting text that carried comments or tracked changes now clears them from the review rail instead of leaving empty cards behind, matching Word: the comment record goes with the words it covered, and an untracked delete drops the `w:ins`/`w:del` it emptied. A reply to a tracked change renders inside that change's card rather than as a separate card beside it, replies included. Every card carries a delete control on the open card — it removes a comment thread, a single reply, or discards a suggestion — through the new `Editor.deleteReviewItem`, `DocxEditor.Review.Delete` and `useReview().remove`. Also fixes a card dismissed from its reply box refusing to reopen.

### Patch Changes

- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
  - @docx-editor.dev/react@2.0.0
  - @docx-editor.dev/core@2.0.0

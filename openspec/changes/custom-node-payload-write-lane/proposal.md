# Custom-node payloads: the write lane

## Why

`w:tag` caps at 64 characters, so a custom node can carry an identity and nothing else. A citation needs authors, a year, a locator and a link; a chip for anything real needs more than a query string. `encodeCustomNodeTag` refuses the overflow rather than truncating, which is correct and leaves integrators with no way to author the node they actually want.

The storage half exists (PR #178): a customXml data part is authored, located, filled, swept and stripped, and payloads validate against a Standard Schema. Nothing writes to it. `defineCustomNode` accepts `schema` and `preserveOnExport` and both say NOT YET READ in their own docs, because a field that quietly does nothing is worse than one that says so.

Word's behavior is no longer assumed. Three round trips through Word established it, with the returned file checked in as `e2e/fixtures/sdt-custom-node-databinding-word-roundtrip.docx`:

- `w:dataBinding` survives with `prefixMappings`, `storeItemID` and `xpath` intact;
- the payload in the store survives unchanged, and `ds:itemID` still matches `w:storeItemID`;
- the `sdtPr` child order this authors is accepted, which Word demonstrates by opening the file rather than refusing it;
- **a bound control with no type child is read-only in Word.** The text is painted from the xpath and cannot be typed into.

That last point removes the hardest problem this design could have had. The page and the payload cannot drift, because Word will not let a user edit one out from under the other. The store is the source of truth by construction rather than by convention, so there is no reconciliation to build.

## What Changes

- **`insertCustomNode` becomes an automation operation** in `core/automation`, not an editor-session write. One transaction authors the store if absent, upserts the node with the serialized payload, and stamps `w:dataBinding` into the `sdtPr`. Both hosts then answer it identically: the headless `DocxEditor.createServer` path and the browser one, rather than the server reimplementing a browser-only write.
- **Pro's `insertCustomNode` and `updateCustomNode` become thin calls into it**, gaining a `data` option validated through the definition's `schema` on the way in. `customNodeXml` stays what it is, the template-splicing helper for callers with no runtime at all, and gains the same payload support for the store it cannot author.
- **The read path resolves a bound node** and hands typed `data` to `fromDocx` and `reviewCard`. A payload that fails its schema is reported, never half-applied.
- **`preserveOnExport` is honoured on save.** `'text'` unwraps the control, keeping the words and dropping the tag, the binding and the payload. `false` removes the node with its content. `true` is untouched. Today only the payload half is implemented; the body half is not.
- **The orphan sweep runs on open**, which is the only way to collect a payload whose control was deleted in Word.
- **Both demos carry a real schema.** The vite citation dialog gains Authors, Year and URL with `sourceId` left in the tag as identity; igloo's iceberg moves `depth` out of the tag into the payload.

## Capabilities

### New Capabilities

- `custom-node-payloads` — authoring, reading, sweeping and export-stripping a custom node's payload, and the binding that ties a control to it.

### Modified Capabilities

- `pro-custom-nodes` — `defineCustomNode`'s `schema` and `preserveOnExport` stop being declarations and start being read.

## Non-Goals

- **In-Word editing of a chip.** Word's read-only behavior for an untyped bound control is the guarantee this design rests on. Making one editable means adding `<w:text/>` for a two-way binding, which is a per-definition opt-in and a separate change.
- **A general document scrub.** `preserveOnExport` removes this library's own markup. It does not touch `docProps/app.xml`, `docProps/core.xml`, comment authors or rsids, and must not be described as making a document anonymous.
- **Clipboard payload transfer.** Cutting a chip and pasting it elsewhere carries the control; whether the payload travels with it is deferred, and the sweep's on-open-only timing exists so a cut chip is not collected mid-flight.

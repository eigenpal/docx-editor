## Why

`deferred-features.md` records content controls as: parse `generic preserved with bounded nesting`; model `untyped generic nodes`; layout `deferred`; edit `deferred`. Its named future gate is "typed SDT properties/content, lock and nesting semantics, projection/layout behavior, operations, and paired acceptance".

The code says the same thing in its own words. `packages/core/src/layout/story-roots.ts`:

> SDT content flattens TRANSPARENTLY: the paragraphs and tables inside `w:sdtContent` join the flow in reading order (Word renders them in place), while the `w:sdt` wrapper itself stays a generic node the serializer round-trips. SDT chrome — placeholder text, locks, dropdown behaviour — is not modelled.

Flattening is the right default and it is not enough. Three consequences:

1. **A lock is not a lock.** `w:sdtPr/w:lock` admits `sdtLocked`, `contentLocked`, `sdtContentLocked`, and `unlocked` (`ST_Lock`). None is enforced, so a document that says its content cannot be edited can be edited, and the file saves back claiming a constraint it did not keep.
2. **Placeholder text is real content.** Twelve of the fixture's seventeen controls set `w:showingPlcHdr`. Their visible text is a grey italic prompt like "Enter project name". Flattened, that prompt is indistinguishable from authored text: typing next to it appends to the prompt instead of replacing it, and the saved file keeps `showingPlcHdr` set over text the user wrote.
3. **Inline controls are not flattened at all.** `storyBlocks` only unwraps a `w:sdt` in block position. The fixture's four checkbox-style controls are inline `w:sdt` wrapping a run — they are generic nodes inside a paragraph, with no defined contribution to the paragraph's UTF-16 offsets that `TreeDocOp` addresses by.

A template-driven document — which is most of what content controls are for — therefore loads, renders, and saves while its structure is unenforceable and its prompts are indistinguishable from data.

## What Changes

**Typed SDT nodes**

- Add `contentControl` and `contentControlContent` to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`, at block, inline, row, and cell level. The wrapper stops being generic.
- Type `CT_SdtPr` in the order the schema declares it: `rPr`, `alias`, `tag`, `id`, `lock`, `placeholder`, `temporary`, `showingPlcHdr`, `dataBinding`, `label`, `tabIndex`, then exactly one type element from `equation | comboBox | date | docPartObj | docPartList | dropDownList | picture | richText | text | citation | group | bibliography`. `w14:checkbox` is the Microsoft extension, not an ECMA-376 type, and is typed as such.
- Type `w:sdtEndPr` at every SDT level (`CT_SdtBlock`, `CT_SdtRun`, `CT_SdtCell`, `CT_SdtRow`) in schema position; unmodelled children stay generic.
- Type the type-specific payloads that carry data: `CT_SdtDropDownList` (`w:listItem`, `@w:lastValue`), `CT_SdtComboBox`, `CT_SdtDate` (`w:dateFormat`, `w:lid`, `w:storeMappedDataAs`, `w:calendar`, `@w:fullDate`), `CT_SdtText` (`@w:multiLine`).
- `CT_DataBinding` (`@w:xpath`, `@w:storeItemID`, `@w:prefixMappings`) is typed and **preserved but not resolved** — see below.
- Everything in `w:sdtPr` outside this vocabulary stays generic and round-trips, per D1.

**Layout keeps flattening, and gains boundaries**

- `storyBlocks` continues to flatten block-level content into the flow, because that is what Word renders. It gains inline-SDT handling so an inline control's runs contribute to the paragraph's text and offsets.
- Layout emits a boundary record per control — identity, tag, alias, type, lock state, placeholder state — so the surface can draw chrome and enforce locks without the wrapper becoming a layout container.
- Nesting stays bounded. The existing `MAX_SDT_NESTING = 32` guard is kept and extended to the inline path; a deeper nest preserves content and stops flattening rather than recursing.

**Locks are enforced at the store**

- `TreeDocOp` validation refuses an operation whose target violates the resolved lock, returning `locked`, matching the taxonomy `ExecResult` already uses.
- `sdtLocked` forbids removing the control; `contentLocked` forbids editing its content; `sdtContentLocked` forbids both. Nested controls use a **lock union**: the strictest ancestor on each axis wins — content edit is forbidden when any ancestor or self declares `contentLocked` or `sdtContentLocked`; removal is forbidden when any ancestor or self declares `sdtLocked` or `sdtContentLocked`. Enforcement lives in `tree-op-validate.ts`, so an agent, a command, and a keystroke are all refused identically. `w:documentProtection/@w:edit="forms"` and section `w:formProt` are **deferred** — not read or enforced here.

**Placeholder text becomes a state, not a string**

- A control with `w:showingPlcHdr` is rendered as placeholder: visually distinguished via `w:sdtPr/w:rPr`, not selectable as ordinary text, and replaced wholesale on first input rather than appended to.
- First input replaces the literal prompt and clears `w:showingPlcHdr`. Undo through history may restore the prior state; emptying content after a replace leaves the control empty and does not reassert the flag (no durable prompt source without glossary resolution).
- A control with `w:temporary` removes itself — unwraps while keeping content — in the same transaction as the first successful content edit.
- `w:placeholder/w:docPart` names a glossary entry. The fixture has none — its prompt text is literal content inside `w:sdtContent`. The reference is preserved; glossary resolution and restore-from-glossary remain deferred.

**Typed value operations**

- `TreeDocOp` gains set-content-control-value, addressed by control identity, with per-type validation internally. The shipped public `DocEdits.setContentControlValue: { value: string }` is unchanged — the engine maps the string by control type (list-item value, ISO date, checkbox boolean string, plain text).
- A value that is not among a dropdown's `w:listItem` values is refused with `invalidArgs`. A combo box accepts a free value, because that is what distinguishes it from a dropdown.
- Dropdown and combo `w:listItem` children are bounded by `MAX_SDT_LIST_ITEMS` (256) at read time; excess items preserve as generic children in position.
- `w:dataBinding` controls refuse content and value edits with `bound`.
- Shipped `addRepeatingSectionItem` / `removeRepeatingSectionItem` remain in the public vocabulary but refuse with `unsupported` until a dedicated repeating-section change lands.

**React adapter**

- Interactive widgets on the painted surface: a dropdown menu from `w:listItem`, a date picker, a checkbox toggle.
- A form-fill navigation mode: Tab moves between unlocked controls in `w:tabIndex` order, then document order.
- A control inspector showing tag, alias, type, and lock, and a context menu to remove a control while keeping its content.
- Chrome slots: `contentControl.showAll`, `contentControl.formFill`, `contentControl.inspector`, `contentControl.remove`.

**Vue** is explicitly deferred. No paired support claim follows from this change alone.

## Capabilities

### New Capabilities

- `content-control-model`: typed nodes, `CT_SdtPr` in schema order, type payloads, identity, and the two D9 oracles applied to controls.
- `content-control-layout-and-lock`: flattening at block and inline level, boundary records, bounded nesting, placeholder state, and store-enforced locks.
- `content-control-authoring-surface`: widgets, form-fill navigation, the inspector, and value commands.

### Modified Capabilities

None. The content-controls entry in `deferred-features.md` is rewritten to its post-change status.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx`. Seventeen `w:sdt` elements.

| Control type | Count | Notes |
| --- | --- | --- |
| `w:text` | 2 | "Full Name", "Project Name" |
| `w:dropDownList` | 3 | "Department", "Status", "Risk Level"; 32 `w:listItem` total across dropdowns and combos |
| `w:comboBox` | 2 | "Priority Level", "Team Lead" |
| `w:date` | 3 | with `w:dateFormat`, `w:lid`, `w:storeMappedDataAs`, `w:calendar` |
| `w14:checkbox` | 4 | inline, with `w14:checked`, `w14:checkedState val="2612"`, `w14:uncheckedState val="2610"`, font MS Gothic |
| no type element | 3 | one TOC wrapper and two rich-text form fields |

Other measurements:

- 13 carry `w:alias`, 12 carry `w:tag`, 12 carry `w:showingPlcHdr`, 12 carry `w:id`.
- 5 controls are block-level **inside a table cell** — a `w:sdt` whose content is a paragraph inside `w:tc`.
- The TOC control wraps a `TOC` field with `w:fldChar` and `@w:dirty="true"`.

Not present, so not claimable from this file:

- `w:lock` — no control in **this** fixture declares one. Other fixtures do: `block-sdt-comprehensive.docx`, `block-sdt-widgets.docx`, `block-sdt-showcase.docx`, and `inline-checkbox-controls.docx` each declare `w:lock w:val="sdtContentLocked"` **and** `w:dataBinding`. Lock enforcement is therefore testable today.
- `w:dataBinding` — none in this fixture; present in the four listed above.
- `w:placeholder/w:docPart` — every prompt here is literal content, never a glossary reference. There is no glossary part in the package.
- `w:docPartObj`, `w:docPartList`, `w:group`, `w:citation`, `w:bibliography`, `w:equation`, `w:picture`, repeating sections, `w:temporary`, `w:tabIndex`, `w:sdtEndPr`.
- Row-level and cell-level `w:sdt` (`w:sdtContent` containing `w:tr` or `w:tc`). All five in-table controls wrap block content *inside* a cell.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — typed control kinds and `CT_SdtPr`.
- `packages/core/src/layout/story-roots.ts` — inline flattening; block flattening and `MAX_SDT_NESTING` retained.
- `packages/core/src/layout/semantic-records.ts`, `semantic-layout.ts` — boundary records.
- `packages/core/src/store/store/tree-op-validate.ts` — lock enforcement, refusing with `locked`.
- `packages/core/src/store/store/tree-ops.ts`, `tree-op-apply.ts` — value and removal operations.
- `packages/core/src/output/semantic-paint.ts` — boundary chrome and placeholder styling.
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — `contentControl` chrome group and inspector slots.
- `packages/react/src` — widgets, form-fill navigation, inspector, i18n.
- **Vue**: explicitly deferred; no paired support claim.
- **Not included**: `w:dataBinding` resolution against a custom XML part, the glossary document for `w:placeholder`, repeating-section add/remove operations, `w:documentProtection`/`w:formProt` form mode, and `w:docPartObj` gallery behaviour. All are preserved and none is resolved.

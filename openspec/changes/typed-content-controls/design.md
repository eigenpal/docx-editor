# Design — typed content controls

## Context

`typed-ooxml-paragraph-editor` is the production authority; this change is the named future gate for its content-controls lane.

`story-roots.ts` states the current position exactly: block SDT content flattens transparently, the wrapper stays generic, and "SDT chrome — placeholder text, locks, dropdown behaviour — is not modelled". Flattening is right. What is missing is everything that makes a control a control.

## Decisions

### S1: Keep flattening; type the wrapper

Word renders a block control's content in place, so the flow must too. The `w:sdt` wrapper is not a box, not a fragment boundary, and not a line-break opportunity.

Typing the wrapper is orthogonal to flattening it. Today the wrapper is generic, which means every question about it — is it locked, is this a prompt, what type is it, where does it start — is answered by walking `localName` strings, which D1 exists to prevent.

### S2: Inline controls need typing for a reason that is not cosmetic

`TreeDocOp` addresses by node id and UTF-16 offset. A generic node inside a paragraph has no defined offset contribution, so a delete spanning it cannot be validated. The fixture's four inline controls sit in ordinary paragraphs; today a selection crossing one is addressing a paragraph whose text length the store and the layout disagree about.

Typing them makes the paragraph's offset accounting total. That is a correctness fix for text editing, not a content-control feature.

### S3: Locks are enforced in `tree-op-validate.ts`, not in the surface

A lock enforced in the widget layer is a suggestion. The store is the only write path (D2), so it is the only place where a keystroke, a toolbar command, and an agent call are all refused identically — and `ExecResult` already carries `locked` for exactly this.

The surface still reads the lock, but only to disable controls and explain why. Telling the user before they type is UX; refusing the op is correctness. Both are required, and the second one is what makes the claim true.

The lock vocabulary is `ST_Lock`: `sdtLocked`, `contentLocked`, `sdtContentLocked`, `unlocked`. Collapsing it to a boolean loses the distinction between "you may edit this but not delete the field" and the reverse, which is the entire point of a template.

The comprehensive fixture declares no lock, but `block-sdt-comprehensive.docx`, `block-sdt-widgets.docx`, `block-sdt-showcase.docx`, and `inline-checkbox-controls.docx` each declare `sdtContentLocked`, so enforcement is testable today. `tasks.md` §6 adds only the `ST_Lock` values and the nesting case those files lack.

**Nested lock union.** A control's effective permissions are the union of its own `w:lock` and every ancestor control's lock, evaluated separately on two axes:

- **Content edit** is forbidden when the control or any ancestor declares `contentLocked` or `sdtContentLocked`.
- **Removal** is forbidden when the control or any ancestor declares `sdtLocked` or `sdtContentLocked`.

There is no "inner lock overrides outer" rule. The strictest ancestor on each axis wins. `TreeDocOp` validation and boundary records both use this union. The shipped `ContentControlSummary.locked?: boolean` is **not** widened: it reports only the content-edit axis (`true` when the union forbids editing content; absent or `false` when editing is allowed). A control that is `sdtLocked` only therefore reports `locked: false` while removal stays refused through the separate removal path.

**Document-level form protection is deferred.** `w:documentProtection/@w:edit="forms"` and section `w:formProt` are not read or enforced in this change. Only per-control `w:sdtPr/w:lock` is enforced. A follow-up change owns document-wide forms mode.

### S4: Placeholder is a state with a transition, not a string

Twelve of seventeen controls in the fixture set `w:showingPlcHdr`. Flattened, their grey italic prompts are ordinary text: the user types next to "Enter project name" instead of replacing it, and the file saves with `showingPlcHdr` still set over data. Word's contract for a literal-only prompt is a one-way transition — first input replaces the whole prompt and clears the flag.

**No durable restore without glossary resolution.** For literal-only placeholders (`w:showingPlcHdr` with no resolved `w:placeholder/w:docPart`), the prompt text lives only in `w:sdtContent`. Once replaced, that source is gone; emptying the control later leaves it empty and does **not** reassert `w:showingPlcHdr`. Undo through D10 history may restore the prior tree state including the flag and prompt; that is history, not an automatic empty-content transition. Glossary-referenced placeholders remain preserve-only — `w:placeholder/w:docPart` round-trips, the glossary part is not read, and no restore is invented from the reference.

This is why placeholder cannot be handled by styling alone.

**Placeholder appearance comes from `w:sdtPr/w:rPr`.** When `w:showingPlcHdr` is set, layout and paint apply the control's declared `w:sdtPr/w:rPr` — typically grey italic — to the placeholder content for display. Authored `w:rPr` on runs inside `w:sdtContent` is not the source of placeholder styling; it is ordinary content styling once the placeholder is cleared.

`w:placeholder/w:docPart` points at a glossary entry. The fixture has none, and reading the glossary document is a separate part-loading concern. The reference is preserved on round trip; resolution and any restore-from-glossary behaviour are deferred.

### S4b: `w:temporary` unwraps on first successful content edit

When `w:sdtPr/w:temporary` is present, the control SHALL remove itself — unwrap while keeping its content at the same position — in the same transaction as the first successful content edit. "Successful content edit" means any committed `TreeDocOp` that replaces placeholder state with real content or changes non-placeholder content (text insertion, value operation, paste, or equivalent). Clearing content back to empty after that edit does **not** restore the wrapper. This is distinct from the literal placeholder transition, which clears `w:showingPlcHdr` on first input but does not reassert it on empty without glossary resolution, and leaves the wrapper in place when `w:temporary` is absent.

### S5: The fixture's checkboxes are real `w14:checkbox` controls

The fixture's four checkbox-style controls are Word-authored checkbox content controls. Detecting them requires searching `w:sdtPr` for the `w14:`-prefixed extension as well as the `w:`-prefixed ECMA-376 type elements; a scan for `w:`-prefixed types alone reports them as untyped.

```xml
<w:sdtPr><w14:checkbox>
  <w14:checked w14:val="1"/>
  <w14:checkedState w14:val="2612" w14:font="MS Gothic"/>
  <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>
</w14:checkbox></w:sdtPr>
```

The `w:sym` is their **content**, which is exactly how Word renders a checkbox: the control's state selects between `w14:checkedState` and `w14:uncheckedState`, and the chosen glyph is written into `w:sdtContent`. So the toggle operation is real, and it is not "swap a character" — it sets `w14:checked` and rewrites the content glyph from the control's own declared states.

Two consequences. First, the fixture is a valid checkbox fixture and `inline-checkbox-controls.docx` is a second one, so this path needs no new file. Second, `w14:checkbox` is a Microsoft extension outside `CT_SdtPr`'s type choice, which means a control can carry it *and* declare no ECMA-376 type element — so "untyped" and "checkbox" are not mutually exclusive, and the model must read the extension before concluding a control is untyped. Three controls in the comprehensive fixture are genuinely untyped; the other four are checkboxes.

### S6: Data binding is preserved and refused, not half-supported

`w:dataBinding` means the control's value comes from a custom XML part. Editing the content without writing the binding target produces a file where the two disagree, and Word will overwrite the content from the binding on open — so the user's edit silently disappears.

Refusing with `bound` — a code `ExecResult` already has — is the honest behaviour until binding is implemented. Silently editing is worse than refusing, because the loss is invisible until the file is reopened elsewhere.

### S7: Control identity is not `w:id`

`w:id` is optional in `CT_SdtPr` and five controls in the fixture omit it. It is also not guaranteed unique. Addressing by it would make those five unaddressable and two colliding ones ambiguous. Node identity, which the tree already assigns at the model boundary, addresses all of them.

`w:id` is preserved where present and never fabricated, because adding one changes the file for no user-visible reason and breaks byte-comparison against the input.

### S8: Boundary records, not painted-DOM inspection

Chrome, lock feedback, form-fill navigation, and the inspector all need to know where a control is on the page. Deriving that from painted DOM would make DOM geometry authoritative, which D5 forbids. A boundary record per control in the layout output is the same shape the rest of the pipeline already uses.

### S9: `w:sdtEndPr` is typed at every SDT level

`w:sdtEndPr` is a member of every `CT_SdtBlock`, `CT_SdtRun`, `CT_SdtCell`, and `CT_SdtRow` sequence. It SHALL be typed and serialized in schema position so the canonical fingerprint oracle covers it. Unmodelled children inside `w:sdtEndPr` stay generic in position.

### S10: D12 impact classes

Committed control operations SHALL publish a `ModelChange` impact class no narrower than the narrowest class that is always safe:

| Operation | Impact class |
| --- | --- |
| Checkbox toggle with unchanged paragraph metrics | `text-local` |
| Placeholder first-input replacement, text/value edits inside one paragraph | `paragraph-local` |
| Value or placeholder edits that change block-level flow height (multi-paragraph or block text control content) | `flow-structural` |
| `w:temporary` self-remove and remove-control (unwrap) | `flow-structural` |

Understating impact would let incremental layout reuse a suffix that changed length or block count.

### S11: `MAX_SDT_LIST_ITEMS = 256`

Dropdown and combo `w:listItem` children are bounded at read time by `MAX_SDT_LIST_ITEMS` (256), consistent with other conservative allocation guards such as `MAX_CELL_CONDITION_SETS`. Items within the cap are typed; items beyond the cap are preserved as generic children in position and are not offered in widgets or value validation. Parse and layout SHALL NOT allocate from an unbounded file-supplied count.

### S12: Shipped public contract is reconciled, not widened

The API Extractor surface in `packages/core/src/index.ts` and `packages/core/src/contracts/types.ts` is already snapshotted. This change implements against it without breaking changes:

- **`ContentControlSummary.locked`** means content-edit locked per the nested lock union (S3). It does not encode removal-only `sdtLocked`.
- **`DocEdits.setContentControlValue: { value: string }`** stays `string` at the public layer. The engine maps the string internally by control type: list-item `value` for dropdown/combo, ISO 8601 date for date, `"true"` / `"false"` for checkbox, plain string for text/richText. Per-type validation lives in `TreeDocOp`, not in the public edit shape.
- **`ContentControlType`** is not extended. Controls with no ECMA-376 type element and preserved types without a shipped member (`group`, `docPartObj`, `citation`, `bibliography`, `equation`) report as `richText` in summaries and queries. Widgets are offered only for types this change implements.
- **`addRepeatingSectionItem` / `removeRepeatingSectionItem`** remain in the shipped `DocEdits` vocabulary but are **unsupported** in this change — they refuse with `unsupported` until a dedicated repeating-section change lands. `ContentControlType` may still report `repeatingSection` for read surfaces; no add/remove behaviour is claimed here.

`Editor.contentControlAt` / `query({ type: 'contentControlAt' })` is the honest-empty stub this change fills.

### S13: React authoring surface is in scope; Vue is explicitly deferred

The full interactive authoring surface — widgets, form-fill navigation, boundary chrome, inspector, remove-control, and the chrome slots that wire them — lands in the React adapter only. Vue is not paired in this change and no production support claim follows from it alone (`paragraph-adapter-acceptance` still requires paired adapters). A follow-up change owns Vue parity.

### S14: Chrome slots

`CHROME_GROUPS` gains a `contentControl` group with public `ChromeSlotId` values:

- `contentControl.showAll` — toggle show-all boundary chrome
- `contentControl.formFill` — toggle form-fill navigation mode
- `contentControl.inspector` — control property inspector (contextual)
- `contentControl.remove` — remove control keeping content (contextual)

Insert-authoring controls (Developer-tab parity) are deferred to a follow-up; this change does not claim an `insert.contentControl` slot.

## Open questions

1. **Tab inside a table cell.** Tab already means "next cell" in a table. A control inside a cell — five of them in the fixture — makes the binding ambiguous. The requirement demands a defined, consistent answer; which one is right needs a Word comparison, not a coin toss. Task 5.4.

2. **Repeating sections.** `w15:repeatingSection` is a Microsoft extension, not ECMA-376, and is the feature most template consumers actually want. Deliberately out of scope; it needs its own change because add/remove-item interacts with numbering, bookmarks, and tracked changes.

3. **`w:docPartObj` galleries.** Preserved, not resolved. A TOC control — the fixture has one — is a `docPartObj` in Word's own output when generated from the gallery; here it is an untyped control wrapping a `TOC` field. Field evaluation is owned by `scoped-header-footer-editing`, which keeps every non-page-number instruction inert. The TOC therefore paints its cached result, and this change does not change that.

4. **Interaction with tracked changes.** Setting a control's value in suggesting mode should produce a tracked replacement of its content. Owned by `typed-revisions-and-comments`; whichever lands second reconciles.

5. **Vue parity.** Deferred by decision S13; React only in this change.

6. **`w:customXml` and `w:smartTag`.** Same UTF-16 offset correctness argument as inline SDTs; not owned here. Task 9.7.

7. **`mc:AlternateContent` and `w14:checkbox`.** Checkbox detection may require MC preprocessing owned by `typed-drawings-and-images`. Task 9.9.

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

**No fixture in this repository declares a lock.** The main correctness claim of this change is therefore untestable against existing files, which is why `tasks.md` §6 authors one before §4 implements enforcement.

### S4: Placeholder is a state with a transition, not a string

Twelve of seventeen controls in the fixture set `w:showingPlcHdr`. Flattened, their grey italic prompts are ordinary text: the user types next to "Enter project name" instead of replacing it, and the file saves with `showingPlcHdr` still set over data. Word's contract is a transition — first input replaces the whole prompt and clears the flag; emptying restores both.

This is why placeholder cannot be handled by styling alone.

`w:placeholder/w:docPart` points at a glossary entry. The fixture has none, and reading the glossary document is a separate part-loading concern. Both cases are specified; only the literal one is implemented, and the requirement says so rather than implying the glossary works.

### S5: The fixture's checkboxes are not checkboxes

The four checkbox-style controls are untyped inline `w:sdt` wrapping `w:sym` with `w:char="2612"` / `"2610"` in MS Gothic — ballot-box glyphs. A real Word checkbox control declares `w14:checkbox` in `w:sdtPr`.

Offering a checkbox widget for these would mean toggling a symbol character and calling it a value operation. The requirement refuses that: no declared type, no typed widget. A file authored by Word with real checkboxes gets the widget; this file does not.

This is the same shape of trap as the literal-tab case in `scoped-header-footer-editing`: the fixture rewards an implementation that is wrong on real files.

### S6: Data binding is preserved and refused, not half-supported

`w:dataBinding` means the control's value comes from a custom XML part. Editing the content without writing the binding target produces a file where the two disagree, and Word will overwrite the content from the binding on open — so the user's edit silently disappears.

Refusing with `bound` — a code `ExecResult` already has — is the honest behaviour until binding is implemented. Silently editing is worse than refusing, because the loss is invisible until the file is reopened elsewhere.

### S7: Control identity is not `w:id`

`w:id` is optional in `CT_SdtPr` and five controls in the fixture omit it. It is also not guaranteed unique. Addressing by it would make those five unaddressable and two colliding ones ambiguous. Node identity, which the tree already assigns at the model boundary, addresses all of them.

`w:id` is preserved where present and never fabricated, because adding one changes the file for no user-visible reason and breaks byte-comparison against the input.

### S8: Boundary records, not painted-DOM inspection

Chrome, lock feedback, form-fill navigation, and the inspector all need to know where a control is on the page. Deriving that from painted DOM would make DOM geometry authoritative, which D5 forbids. A boundary record per control in the layout output is the same shape the rest of the pipeline already uses.

## Open questions

1. **Tab inside a table cell.** Tab already means "next cell" in a table. A control inside a cell — five of them in the fixture — makes the binding ambiguous. The requirement demands a defined, consistent answer; which one is right needs a Word comparison, not a coin toss. Task 5.4.

2. **Repeating sections.** `w15:repeatingSection` is a Microsoft extension, not ECMA-376, and is the feature most template consumers actually want. Deliberately out of scope; it needs its own change because add/remove-item interacts with numbering, bookmarks, and tracked changes.

3. **`w:docPartObj` galleries.** Preserved, not resolved. A TOC control — the fixture has one — is a `docPartObj` in Word's own output when generated from the gallery; here it is an untyped control wrapping a `TOC` field. Field evaluation is owned by `scoped-header-footer-editing`, which keeps every non-page-number instruction inert. The TOC therefore paints its cached result, and this change does not change that.

4. **Interaction with tracked changes.** Setting a control's value in suggesting mode should produce a tracked replacement of its content. Owned by `typed-revisions-and-comments`; whichever lands second reconciles.

5. **Vue parity.** Out of scope by request; no production support claim follows from this change alone.

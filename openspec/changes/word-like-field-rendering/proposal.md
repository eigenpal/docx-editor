## Why

A reviewed contract arrived where a deleted party name rendered as ordinary unchanged text. The review sidebar reported the replacement correctly; the page showed the removed words with no strikethrough, no colour, no author. A reviewer reading the page approves a deletion the page never flagged, which is the exact failure the review surface exists to prevent.

The sidebar derives from the STORE and the page derives from LAYOUT. Both were right about their own input; they disagreed because only one of them had been taught about fields.

**A field's result does not reach the page the way a run's does.** A complex field is buffered while it is open and flushed at `fldChar end`, by which point the depth-first walk has left whatever `w:del`/`w:ins` enclosed it. `push` — the single place a piece is attributed — saw an empty revision stack and attached nothing.

Nothing in that path inspects the field kind, so it was never about the form fields the reported file happened to contain. An attribution-coverage sweep over the fixture corpus found **47 unattributed revisions across two fixtures**, none of them form fields:

| Fixture | Revision | Tree says | Page painted |
| --- | --- | --- | --- |
| `list-pagination-break.docx` ×46 | `insert:430` (`REF … \w \h`) | `"3(sed)."` | *(unattributed)* |
| `issue-319-sections.docx` `footer1` | `delete:198` (`PAGE`/`NUMPAGES`) | `"Page 1 of 2"` | `"Page  of "` |

The insert side is the worse half: an inserted cross-reference painted with neither underline nor author colour, so it read as text everyone had already agreed to.

`revision-display-differential.test.ts` could not catch this. It pins the resolved modes against accept-all and reject-all output, and ALL-MARKUP — the default, and the only mode that shows both halves — has no accept/reject counterpart to be pinned against.

Two adjacent gaps surfaced while tracing it:

- A `w:del` around an atomic field produced a deleted range of `{start: -16, end: 1}`. The range was derived from the running offset, valid only on the non-atomic path; the atomic path reserves one unit at `begin` and never advances by the text length. Caret stepping consumes those ranges.
- A `w:ins` wrapping a `w:fldSimple` DEMOTED to a generic element, because `w:fldSimple` was missing from the revision wrapper's allowed children even though `CT_RunTrackChange` admits `EG_ContentRunContent`. The wrapper stopped being a revision at all, so the insertion vanished from the page and the review surface together.

Separately, `w:fldSimple` rendered nothing: layout advanced one model unit past the element and emitted no piece, so a document writing its cross-references as simple fields showed blank space where Word shows text. `semantic-paragraph-layout` lists "body fields (including inert generic `w:fldSimple`)" outside its acceptance, so this was a deliberate deferral rather than a defect — **this change closes it**.

Finally, none of the fields the engine now paints correctly are distinguishable from typed text. Word shades them, which is how a reader tells computed text from authored text and how anyone finds the blanks in a form.

## What Changes

**Attribution survives the field boundary**

- A field's displayed result carries the revision stack and hyperlink enclosing it, captured while the walk is inside the wrapper and replayed at flush.
- Both shapes Word writes are covered: `w:del` around only the RESULT run (begin/end outside it), and a wrapper around the whole `begin`…`end` sequence.
- A field whose result runs carry different stacks collapses to the first. The atom is one model unit and Word treats a field as one decision.

**The deleted-range and typing fixes above**, each pinned by a test that fails without it.

**`w:fldSimple` paints its cached result**, as one projected piece over the same single model unit it already occupied. The offset contract does not move; this supersedes the exclusion in `semantic-paragraph-layout`.

**Word's field shading**, as two independent rules:

- Legacy form fields (`w:fldChar/w:ffData`) follow the document's own `w:doNotShadeFormData`, defaulting to shaded.
- Ordinary fields follow a host option — `never` / `when-selected` / `always` — defaulting to Word's `when-selected`.
- Neither prints.

Layout publishes only the FACT that a span is a field. Whether shading is drawn is settled downstream, and `when-selected` is resolved from the caret in the DOM: putting the caret into layout's cache key would remeasure the document on every arrow press, and into paint's would rebuild every span just as often.

**An attribution-coverage oracle** over the fixture corpus, asserting that every character the tree says is tracked reaches layout inside a piece carrying that revision. It works precisely because the two sides are derived independently — which is why they drifted.

## Impact

- `core/layout`: `field-projection.ts` (attribution capture and replay, simple-field projection), new `field-pieces.ts` and `field-page-furniture.ts` extracted to stay under the file-size cap, `paragraph-flow.ts`, `semantic-records.ts`.
- `core/store`: `ooxml-shared.ts` revision child validity, `field-nodes.ts` (`hasLegacyFormFieldData`), new `view-settings.ts` and shared `settings-onoff.ts`.
- `core/output`: `semantic-paint.ts`, `editor.css`.
- `core/editor`: `paginated-surface.ts`, new `surface-field-shading.ts`.
- Public API additions only: `FieldAtomMarker`, `FieldShadingMode`, `DEFAULT_FIELD_SHADING`, `readViewSettings`, `DocumentViewSettings`, `DEFAULT_VIEW_SETTINGS`, `hasLegacyFormFieldData`, and the `fieldShading` / `shadeFormFields` options.
- No behaviour change for documents with no fields.

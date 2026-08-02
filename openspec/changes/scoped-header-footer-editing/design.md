# Design — scoped header and footer editing

## Context

`typed-ooxml-paragraph-editor` is the production authority. Its D7 inventory lists headers and footers as deferred for editing with layout "read-only page furniture supported"; this change is that lane's named future gate.

Two of the ledger's parse/model claims are stronger than the code:

- `hf-references.ts` resolves from `findBodySectPr`, which finds a `w:sectPr` that is a direct child of `w:body`. Mid-body sections declare theirs inside `w:pPr`. On the comprehensive fixture that means four of five sections are invisible and the last section's pair is applied to the whole document.
- `semantic-layout.ts` selects the variant with `index === 0`, where `index` is the document page index, and reads `titlePage` from the same single `w:sectPr`. `w:titlePg` is a section property.

Neither is exercised by any fixture in the repository, because every reference in the comprehensive fixture is `default` and settings disable odd/even. The `first` and `even` paths are uncovered code.

## Decisions

### H1: Resolution is a function of the section, computed at layout

`section-properties.ts` already exposes `readDocumentSections`; `hf-references.ts` does not use it. Joining the two is the whole fix for per-section resolution.

Resolution stays a function — `(section, kind, variant, precedingSections, settings) → part | inherited-part | none` — rather than a stored map. A stored map would go stale on every re-pagination, every section-property edit, and every `w:pgNumType` change, and there is no cheap way to know which.

### H2: The resolution result reports inheritance

The dangerous case is not rendering the wrong header. It is a user editing an inherited header and silently changing three earlier sections. Word shows "Same as Previous" for exactly this reason. Returning a bare part name makes the warning impossible without a second query, so the result carries `inherited`.

### H3: The first section with no reference renders empty

This is the comprehensive fixture's actual shape and today's actual bug. OOXML models furniture as a chain of overrides; the first link has nothing behind it. Rendering a later section's header invents content that is not in the file, which is what happens today.

### H4: Keep the two rules that are already right

`hf-references.ts` fails open on a dangling `r:id` and honours the first reference of a duplicated type. Both match Word. Neither changes.

Likewise `variantFor`'s comment is correct — "An absent variant shows nothing — Word falls back to blank, not to `default`" — and that rule survives. Only the *scope* of `index === 0` and of `titlePage` is wrong.

### H5: `hf-layout.ts` does not change shape

It already lays a story out once per variant at the section's content width, keeps `flowHeight` as the box size — the rule that an anchored object's extent must never size the box — and namespaces line ids by part so a header change does not move the body's line counter. Per-section resolution changes *which* stories exist and *which page gets which*, not how one is laid out.

### H6: Editing scopes the furniture rather than un-furnishing it

Today furniture is `contenteditable=false` with `[data-docx-hf]` and is excluded from selection. Removing that would let a body drag select header text on every page.

The scope is a mode: while open, one story's fragments join the caret space; while closed, all furniture is inert. This is the smallest change that gives editing without giving up the selection guarantee.

Because it is a mode rather than a separate editor, the editing behaviour inside it is the body's, unchanged. That is the point: a second, reduced editing path for page furniture is how header editing drifts from body editing feature by feature until users notice that lists, tables, or undo behave differently in a header. The parity requirement makes the drift a spec violation rather than an oversight, and task 12.3 proves it by running the body's own editing tests against an open scope.

### H7: Fields evaluate in layout, and everything else is inert

One footer part appears on twenty pages with twenty `PAGE` values. Rewriting the cached result before each paint would make every repaint a document mutation; one story per page would multiply the layouts.

Evaluating at paint time is the obvious shortcut and it is wrong: the line would be measured with the cached result and painted with the real one, so a right-aligned `12` sits where `1` was measured to sit. Tab stops, centring, and the fixture's own right-aligned footers all break at the single-to-double-digit boundary.

So evaluation happens in layout, before measurement, and a story is laid out once per variant **per distinct evaluated-result geometry**. Pages whose numbers measure to the same widths share one layout, which keeps the common case cheap; only a page whose result measures differently costs another. The saved `w:instrText` is untouched either way.

The inert-by-default rule is a security requirement, not a scoping convenience. The fields lane in `deferred-features.md` commits to keeping DDE and external inclusion non-executable, and this change types fields for the first time. Typing them is exactly when an evaluator could accidentally acquire a fetch.

### H8: The literal-tab rule is scheduled, not asserted

Five of the fixture's eight header/footer parts — `header1`, `header4`, `footer1`, `footer2`, `footer3` — declare a right tab stop at 9026 twips and then separate their runs with a literal U+0009 inside `<w:t xml:space="preserve">`. The fixture has **zero** `w:tab` elements in any header or footer.

ECMA-376 does not decide what a renderer does with U+0009 in text. It says only that `CT_Text` is text and that `w:tab` is the declared advance, and Word's behaviour here is contested in practice.

Asserting an answer would pin a possibly wrong rendering into a test — precisely the failure this design works hardest to avoid elsewhere. So task 3.5 settles it against Word and records the evidence, and the rule is then pinned once for all five parts rather than inferred per renderer. The same applies to "the first duplicate reference wins, matching Word", which is also asserted and unsourced.

## Open questions

1. **What renders today for the fixture's first section?** Predicted from the code: the final section's header (`rId12`). Task 0.1 requires observing it in the browser rather than asserting it from a reading. If the prediction is wrong, the diagnosis above is wrong and this design needs revisiting before code.

2. **`w:sectPr/@w:type` other than `nextPage`.** `continuous`, `evenPage`, `oddPage`, and `nextColumn` change which page a section starts on, which changes even/odd resolution. Modelled here, not specified for layout, not covered by any fixture.

3. **Watermarks.** In real documents a watermark is a `w:pict`/VML shape or a floating drawing inside a header. Blocked on `typed-drawings-and-images`; it will land in this area and should not be designed twice.

4. **Notes referenced from a header.** `typed-notes-footnotes-endnotes` round-trips such a reference and does not lay it out. Whichever change lands second confirms the two agree.

5. **Vue parity.** Out of scope by request; `paragraph-adapter-acceptance` gates production support on paired adapters, so this change alone produces no support claim.

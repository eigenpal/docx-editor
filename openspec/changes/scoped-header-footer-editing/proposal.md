## Why

`deferred-features.md` records headers and footers as: parse `related story parts with typed section references`; model `story content resolved by section`; layout `read-only page furniture supported`; edit `deferred`. Its named future gate is "scoped editing, inherited page-furniture interaction, save/reopen fixtures, and paired acceptance".

Reading the code, two of those claims are stronger than what ships.

**Header/footer parts are not resolved by section.** `packages/core/src/store/package/hf-references.ts` resolves references from exactly one place:

```ts
const sectPr = findBodySectPr(main.root);   // a w:sectPr that is a direct child of w:body
if (!sectPr) return EMPTY;
```

A document's mid-body sections declare their `w:sectPr` inside `w:pPr`, not under `w:body`. Those are invisible to this function. `comprehensive-word-element-test.docx` has five sections; four declare their properties mid-body. Only the final section's pair (`rId12` / `rId13`) is ever resolved, and it is applied to every page in the document — including the first section, which in the file declares **no header or footer at all** and should render blank.

**Variant selection is document-global, not section-relative.** `semantic-layout.ts`:

```ts
const variantFor = (index: number): HeaderFooterVariantName =>
  furniture?.titlePage && index === 0 ? 'first'
  : furniture?.evenAndOddHeaders && (index + 1) % 2 === 0 ? 'even'
  : 'default';
```

`index === 0` is the first page of the *document*. `w:titlePg` is a section property: each section's first page takes the `first` variant. And `titlePage` itself is read from one `w:sectPr` — the same document-global one.

Editing is deferred outright: page furniture is `contenteditable=false` and `[data-docx-hf]`, excluded from selection.

This change closes the lane: per-section resolution, correct variant selection, page-number fields, and scoped editing.

## What Changes

**Per-section resolution**

- Replace `resolveHeaderFooterParts(pkg)` — one document-global answer — with a per-section resolution built on `readDocumentSections`, which `section-properties.ts` already provides and which `hf-references.ts` does not use.
- Implement inheritance per ECMA-376: a section declaring no reference for a needed kind and variant uses what the preceding section resolves to. The **first** section has no predecessor; declaring none means the region renders empty.
- Keep the existing fail-open behaviour for a dangling `r:id` and the existing first-reference-wins rule for a duplicated type. Both match Word and both are already right.
- Report whether a resolved part was inherited, so the editing surface can warn before an edit propagates backwards.

**Correct variant selection**

- `w:titlePg` becomes a per-section property; the `first` variant applies to the first page **of its section**.
- `w:evenAndOddHeaders` stays document-scoped, because the setting has no per-section form, and is evaluated against the displayed page number.
- Keep today's correct rule that an absent variant renders blank rather than falling back to `default`.

**Section geometry the model does not carry yet**

- `headerDistanceTwips` / `footerDistanceTwips` from `w:pgMar/@w:header` and `@w:footer`.
- `pageNumbering` from `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`), including the fixture's empty `<w:pgNumType/>`, which must round-trip as an empty element rather than being dropped or populated.
- `separator` on columns from `w:cols/@w:sep`, which the fixture sets.

**Page-number fields**

- Type the field vocabulary: `w:fldChar` (`begin` / `separate` / `end`), `w:instrText`, and the `w:fldSimple` shorthand, preserving `@w:dirty` and `@w:fldLock`.
- Evaluate `PAGE`, `NUMPAGES`, and `SECTIONPAGES` at paint time against the page being painted, so one part renders different text on different pages while remaining one story with one editing scope.
- Every other field instruction stays **inert** — round-tripped, painted from its cached result, never executed. This preserves the `deferred-features.md` fields-lane security posture: DDE and external inclusion are non-executable.

**Scoped editing**

- A header or footer story becomes an editable scope: entering it makes that story's fragments selectable and editable while the body dims; leaving it restores the body scope and selection.
- Page furniture stays furniture when not being edited. `[data-docx-hf]` exclusion is scoped to the non-editing state rather than removed.
- `TreeDocOp` gains create-header-footer, delete-header-footer, link-to-previous, unlink-from-previous, and set-section-furniture-options. Unlink clones the inherited part; link garbage-collects an orphaned part, its relationship, and its content-type override.

**React adapter**

- Chrome slots `insert.pageNumber` and `insert.pageXofY`, wired in the slot→command table.
- Header/footer chrome as UI-only overlay: a separator bar naming the region, section, and variant, showing "Same as previous" when inherited, plus an options menu for different-first-page, different-odd-and-even, link-to-previous, distances, and remove.

## Capabilities

### New Capabilities

- `section-page-furniture`: per-section resolution, inheritance, variant selection, distances, page numbering, and the part/relationship lifecycle.
- `header-footer-fields`: typed field runs, their round-trip, page-keyed evaluation, and the inert-by-default rule.
- `header-footer-authoring-surface`: entering and leaving the scope, chrome, options, and page-number insertion.

### Modified Capabilities

- `header-footer-editing` (`openspec/specs/header-footer-editing/spec.md`) is an archived-era spec describing the previous dual-renderer architecture — a hidden ProseMirror view per `rId` and a painter that renders it. That architecture no longer exists: painted pages **are** the editable surface. This change supersedes it. The old spec is not silently left standing as if it still described the system; `tasks.md` §7 requires it be archived or rewritten as part of this change.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx`.

Exercised:

| Feature | Evidence |
| --- | --- |
| Multiple sections | 5 `w:sectPr`, four of them mid-body, three typed `nextPage` |
| Per-section parts | `header1..4.xml` / `footer1..4.xml` as `rId6`–`rId13` |
| Section with no parts | the first section declares neither `w:headerReference` nor `w:footerReference` |
| Complex page fields | every footer uses `w:fldChar` begin/separate/end with `w:instrText`; two also carry `NUMPAGES` |
| Tab-stop header layout | `header1` and `header4` declare a right `w:tab` stop at 9026 twips |
| Header paragraph border | `header1` sets `w:pBdr/w:bottom` |
| Header/footer distance | `w:pgMar/@w:header="708"` and `@w:footer="708"` on all five sections |
| Landscape section | `w:pgSz w:orient="landscape"` 15840×12240 with its own pair |
| Column separator | `w:cols w:num="2" w:sep="true"` |
| Empty page-number type | `<w:pgNumType/>` on all five sections, no attributes |

Not exercised:

- `w:headerReference w:type="first"` and `"even"`. Every reference here is `default`, and settings carry `<w:evenAndOddHeaders w:val="false"/>`. The `first` and `even` code paths in `variantFor` are **not covered by this fixture at all**.
- `w:titlePg`, absent from every section.
- Images, tables, or content controls inside a header or footer.
- A non-empty `w:pgNumType` — no restarted or roman page numbering.
- `w:sectPr/@w:type` values other than `nextPage`.
- A header taller than its margin.

Fixture defect to tolerate, not to imitate: `header1.xml` and `header4.xml` separate their left and right text with a **literal U+0009 inside `<w:t xml:space="preserve">`** while declaring a right tab stop. Only `<w:tab/>` advances to a tab stop; a literal tab is text. Rendering it as an advance makes this file look correct and real files wrong, so these two headers will not paint as three neat left/tab/right sections — which is the right outcome on an imperfect file.

## Impact

- `packages/core/src/store/package/hf-references.ts` — per-section resolution replacing the body-`sectPr`-only lookup.
- `packages/core/src/layout/section-properties.ts` — distances, `pgNumType`, `cols/@sep`, per-section `titlePg`.
- `packages/core/src/layout/semantic-layout.ts` — section-relative `variantFor`, per-section furniture attachment, push-down when furniture exceeds its margin.
- `packages/core/src/layout/hf-layout.ts` — unchanged in shape; it already lays a story out once per variant at flow height.
- `packages/core/src/store/package/ooxml-tree.ts` — typed field kinds.
- `packages/core/src/store/store/tree-ops.ts` and siblings — furniture lifecycle ops.
- `packages/core/src/output/semantic-paint.ts` and `layout/semantic-interaction.ts` — scoped selectability of furniture.
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — two new slots and rows.
- `packages/react/src` — chrome overlay, options menu, i18n.
- **Vue**: out of scope by request; `paragraph-adapter-acceptance` gates support on paired adapters, so this change alone produces no support claim.
- **Not included**: watermarks (a `w:pict`/VML shape or floating drawing in a header — blocked on `typed-drawings-and-images`), and `w:sectPr/@w:type` values other than `nextPage`, which change which page a section starts on and therefore change even/odd resolution.

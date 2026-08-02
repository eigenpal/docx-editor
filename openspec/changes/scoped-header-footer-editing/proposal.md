## Why

`deferred-features.md` records headers and footers as: parse `related story parts with typed section references`; model `story content resolved by section`; layout `read-only page furniture supported`; edit `deferred`. Its named future gate is "scoped editing, inherited page-furniture interaction, save/reopen fixtures, and paired acceptance".

**Resolution and placement now ship.** `resolveHeaderFooterPartsBySection` resolves every section's references and applies OOXML inheritance through `inheritMaps`, carrying `titlePage` per section; `multi-section-layout.ts` attaches the result per section; and `variantFor` picks the variant correctly — `w:titlePg` against the section-local page index, `w:evenAndOddHeaders` against the document index via `pageIndexStart`. `layoutHeaderFooterStory` sizes the box by story flow height, never by an anchored object's extent. Page-number projection ships too: `field-projection.ts` runs a complex-field machine during `piecesOfParagraph`, so `PAGE` and `NUMPAGES` are evaluated **in layout, before measurement**, with layout reuse keyed by the page count.

So the lane's remaining gate is the part it was always named for: **editing**. Page furniture is `contenteditable=false` and `[data-docx-hf]`, excluded from selection, and there is no way to author a header at all — no create, no delete, no link or unlink from the previous section, and no chrome.

Four smaller gaps sit alongside it. `SECTIONPAGES` is not in the allowlist, which is only `PAGE | NUMPAGES`. `w:pgNumType` is not read, so a section cannot restart or reformat its page numbers and the fixture's `<w:pgNumType/>` must round-trip as empty. `w:cols/@w:sep` is not read, so the fixture's two-column section draws no separator rule. And several `EG_SectPrContents` members that change what a page looks like — `w:pgBorders`, `w:vAlign`, `w:lnNumType`, per-column `w:col` widths — are unmodelled.

This change closes editing and those four gaps.

## What Changes

**Confirm what ships, then build on it**

- Per-section resolution, inheritance, section-relative `w:titlePg`, document-relative odd/even, blank-on-absent-variant, fail-open on a dangling `r:id`, and flow-height box sizing are implemented. This change adds conformance coverage for them against the fixtures that exercise `first` and `even`, and does not re-implement them.
- Resolution already reports enough to tell an inherited part from a declared one; the editing surface consumes that so a user is warned before an edit propagates backwards.

**Section geometry the model does not carry yet**

Header and footer distances already ship on `SectionProperties.margins`. Still missing:

- `pageNumbering` from `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`), including the fixture's empty `<w:pgNumType/>`, which must round-trip as an empty element rather than being dropped or populated.
- `separator` on columns from `w:cols/@w:sep`, which the fixture sets and which currently draws nothing.
- `w:pgBorders`, `w:vAlign`, `w:lnNumType`, and per-column `w:col` widths for unequal columns.

**Page-number fields**

- `PAGE` and `NUMPAGES` already project in layout with reuse keyed by page count. Add **`SECTIONPAGES`**, which is not in the allowlist today, and make its reuse key the section's page count.
- Confirm the projection survives the editing scope: a `PAGE` field shows the edited page's own number while its scope is open.
- Type the field vocabulary as canonical nodes — `w:fldChar`, `w:instrText`, `w:fldSimple` — preserving `@w:dirty` and `@w:fldLock`, so a field is one addressable unit for caret movement and deletion rather than a run sequence the parse machine recognises.
- Every other field instruction stays **inert** — round-tripped, painted from its cached result, never executed. This preserves the `deferred-features.md` fields-lane security posture: DDE and external inclusion are non-executable.

**Scoped editing**

- A header or footer story becomes an editable scope, and inside it editing is **the body editor's behaviour applied to that story** — same keyboard, same commands, same selection, same undo, same IME, with the story boundary as the only difference. There is no reduced editing path for page furniture. Leaving restores the body scope and selection.
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

None.

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

- `w:headerReference w:type="first"` and `"even"`. Every reference here is `default`, and settings carry `<w:evenAndOddHeaders w:val="false"/>`. Other fixtures do cover both — `titlePg-header-footer.docx` (2 `first`, 2 `even`, `w:titlePg`) and `section-inheritance-header-footer.docx` (2 `first`, `w:titlePg`), among nine carrying `first` and five carrying `even`. `section-inheritance-header-footer.docx` is close to the inheritance fixture §8.2 covers.
- `w:titlePg`, absent from every section here.
- Images, tables, or content controls inside a header or footer.
- A non-empty `w:pgNumType` — no restarted or roman page numbering.
- `w:sectPr/@w:type` values other than `nextPage`.
- A header taller than its margin.

Fixture oddity: **five** of the eight header/footer parts — `header1`, `header4`, `footer1`, `footer2`, `footer3` — separate their left and right text with a **literal U+0009 inside `<w:t xml:space="preserve">`** while declaring a right tab stop at 9026 twips. The fixture contains **zero `w:tab` elements in any header or footer**, so a test scoped to `header1` alone misses most of the case.

Whether Word advances on a literal U+0009 in `w:t` is **not settled by ECMA-376** — `CT_Text` is plain text, `w:tab` is the declared advance — and it is contested in practice. This change does not assert the answer; `tasks.md` §3.5 schedules a Word comparison, as the other contested behaviours here get one.

Also non-Word: all seven `w:fldSimple` carry `w:instr="[object Object]"`, a generator bug, and every complex field emits `separate` immediately followed by `end` — so the fixture contains **no cached field result at all** and cannot test cached-result preservation.

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

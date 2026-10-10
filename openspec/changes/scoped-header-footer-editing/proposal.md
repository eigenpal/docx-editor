## Why

`deferred-features.md` records headers and footers as: parse `related story parts with typed section references`; model `story content resolved by section`; layout `read-only page furniture supported`; edit `deferred`. Its named future gate is "scoped editing, inherited page-furniture interaction, save/reopen fixtures, and paired acceptance".

**Read-only furniture now ships on docx-editor-v2 (post PR #76 and later merges).** `resolveHeaderFooterPartsBySection` (`packages/core/src/store/package/hf-references.ts`) resolves every section's references with OOXML inheritance and per-section `titlePage`; `multi-section-layout.ts` attaches the result per section; `variantFor` in `semantic-layout.ts` picks the variant correctly — section-local `w:titlePg` against the section page index, document-relative odd/even via `pageIndexStart`. `layoutHeaderFooterStory` sizes the box by story flow height. Tall furniture push-down ships in `semantic-layout.ts` (worst-case flow height over variants, capped at 40% of the sheet). `field-projection.ts` evaluates `PAGE` and `NUMPAGES` **in layout, before measurement**, with reuse keyed by page count — covered by `field-projection.test.ts` and `paginated-surface-hf.test.ts`.

The lane's remaining gate is **editing**. Page furniture is `contenteditable=false` and `[data-docx-hf]`, excluded from selection, and there is no way to author a header — no create, delete, link or unlink, and no chrome. `Editor.getHeaderFooterState()` still returns a stub (`docx-editor.ts`), and resolution does **not** yet expose inherited-versus-declared metadata to the surface even though merged maps are computed internally.

Four smaller gaps sit alongside editing. `SECTIONPAGES` is not in the allowlist (`PAGE | NUMPAGES` only). `w:pgNumType` is not read (`field-projection.ts` still uses physical page indices). `w:cols/@w:sep` is not read. Several `EG_SectPrContents` members that change what a page looks like — `w:pgBorders`, `w:vAlign`, `w:lnNumType`, per-column `w:col` widths — are unmodelled.

This change closes editing, surfaces inheritance metadata, and closes those four gaps.

## What Changes

**Confirm what ships, then build on it**

- Per-section resolution, inheritance, section-relative `w:titlePg`, document-relative odd/even, blank-on-absent-variant, fail-open on a dangling `r:id`, flow-height box sizing, tall-header push-down, and layout-time `PAGE`/`NUMPAGES` projection are implemented. This change adds conformance coverage (`hf-references.test.ts`, `even-odd-header-parity.test.ts`, `section-properties.test.ts`, `paginated-surface-hf.test.ts`, `field-projection.test.ts`) and does not re-implement them.
- Add a resolution query that reports, per section/kind/variant, the resolved part **and whether it is declared or inherited**. `inheritMaps` merges maps today but nothing on the public surface exposes the distinction the chrome needs for "Same as previous".

**Section geometry the model does not carry yet**

Header and footer distances already ship on `SectionProperties.margins`. Still missing:

- `pageNumbering` from `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`), including the fixture's empty `<w:pgNumType/>`, which must round-trip as an empty element rather than being dropped or populated.
- `separator` on columns from `w:cols/@w:sep`, which the fixture sets and which currently draws nothing.
- `w:pgBorders`, `w:vAlign`, `w:lnNumType`, and per-column `w:col` widths for unequal columns.

**Page-number fields**

- `PAGE` and `NUMPAGES` already project in layout. Add **`SECTIONPAGES`** to the allowlist, with reuse keyed by the section's page count.
- Confirm the projection survives the editing scope: a `PAGE` field shows the edited page's own number while its scope is open.
- Type the field vocabulary as canonical nodes — `w:fldChar`, `w:instrText`, `w:fldSimple` — preserving `@w:dirty` and `@w:fldLock`, so a field is one addressable unit for caret movement and deletion.
- Every other field instruction stays **inert** — round-tripped, painted from its cached result, never executed. `CT_FldChar/w:ffData` legacy form fields (`entryMacro`/`exitMacro`) are explicitly deferred (see design §Ownership).

**Scoped editing**

- A header or footer story becomes an editable scope via the shipped `EditorScope { kind: 'headerFooter'; rId }` / `setActiveScope`, replacing the archived hidden-ProseMirror `header-footer-editing` design.
- Inside the scope, editing is **the body editor's behaviour applied to that story** — same keyboard, commands, selection, undo, IME; the story boundary is the only difference.
- `TreeDocOp` gains create-header-footer, delete-header-footer, link-to-previous, unlink-from-previous, and set-section-furniture-options. Unlink clones the inherited part; link garbage-collects an orphaned part, its relationship, and its content-type override.
- Story-content edits publish `global` impact (flow height changes on every page showing that part).

**React adapter (Vue deferred)**

- Chrome slots `insert.pageNumber` and `insert.pageXofY`, wired in the slot→command table.
- Header/footer chrome as UI-only overlay: region, section, variant, inherited warning, options menu.
- Vue stays out of scope; `paragraph-adapter-acceptance` gates production support on paired adapters.

## Capabilities

### New Capabilities

- `section-page-furniture`: per-section resolution conformance, inheritance surfacing, variant selection, distances, page numbering, column separator, and the part/relationship lifecycle.
- `header-footer-fields`: typed field runs, round-trip, page-keyed evaluation, inert-by-default rule.
- `header-footer-authoring-surface`: entering/leaving scope, chrome, options, page-number insertion.

### Modified Capabilities

- `header-footer-editing`: the archived hidden-ProseMirror + off-screen `EditorView` model is **explicitly replaced** by scoped semantic editing on the painted surface. See `specs/header-footer-editing/spec.md` `## MODIFIED Requirements`.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx`.

Exercised:

| Feature | Evidence |
| --- | --- |
| Multiple sections | 5 `w:sectPr`, four mid-body, three typed `nextPage` |
| Per-section parts | `header1..4.xml` / `footer1..4.xml` as `rId6`–`rId13` |
| Section with no parts | first section declares neither reference |
| Complex page fields | every footer uses `w:fldChar` begin/separate/end with `w:instrText`; two also carry `NUMPAGES` |
| Tab-stop header layout | `header1` and `header4` declare a right `w:tab` stop at 9026 twips |
| Header paragraph border | `header1` sets `w:pBdr/w:bottom` |
| Header/footer distance | `w:pgMar/@w:header="708"` and `@w:footer="708"` on all five sections |
| Landscape section | `w:pgSz w:orient="landscape"` 15840×12240 with its own pair |
| Column separator | `w:cols w:num="2" w:sep="true"` (authored; not yet drawn) |
| Empty page-number type | `<w:pgNumType/>` on all five sections |

**Existing fixtures for variants and inheritance** (there is **no** `titlePg-header-footer.docx` in `e2e/fixtures/`):

| Fixture | What it covers |
| --- | --- |
| `section-inheritance-header-footer.docx` | inheritance chain, `first` variant references, `w:titlePg` on section 1 |
| `footer-page-number.docx` | footer `PAGE` field across pages |
| `header-right-tab.docx` | real `w:tab` nodes in a header |
| `sdt-header-content.docx` | SDT inside a header |
| `issue-856-custom-header.docx` | custom header content |

**Genuinely needed new fixture:** `hf-variants.docx` — `w:titlePg` on a **mid-document** section whose first page is not document page 1 (the section-relative `titlePg` case `section-inheritance-header-footer.docx` does not exercise). Author from `section-inheritance-header-footer.docx` by adding a leading section so the `titlePg` section begins on document page ≥ 2.

Not exercised in the comprehensive fixture:

- `w:headerReference w:type="first"` and `"even"` (covered by `section-inheritance-header-footer.docx` for `first`; even/odd covered by unit tests in `even-odd-header-parity.test.ts`).
- Images, tables, or content controls inside header/footer (partial coverage in other fixtures; full authoring parity is out of lane).
- Non-empty `w:pgNumType` — needs `hf-page-numbering.docx`.
- A header taller than its margin — needs `hf-tall-header.docx` for push-down conformance (behaviour ships; fixture coverage does not).

Fixture oddity: five of eight header/footer parts separate left/right text with a **literal U+0009 inside `<w:t>`** while declaring a right tab stop. Whether Word advances on literal U+0009 is unsettled; task 3.5 schedules a Word comparison.

Also non-Word: all seven `w:fldSimple` carry `w:instr="[object Object]"`; every complex field emits `separate` immediately followed by `end` — no cached field result to test preservation against in this file.

## Impact

- `packages/core/src/store/package/hf-references.ts` — add inherited-vs-declared query; lifecycle ops consume it.
- `packages/core/src/layout/section-properties.ts` — `pgNumType`, `cols/@sep`.
- `packages/core/src/layout/field-projection.ts` — `SECTIONPAGES`, `pgNumType` honouring in `PAGE`.
- `packages/core/src/store/package/ooxml-tree.ts` — typed field kinds.
- `packages/core/src/store/store/tree-ops.ts` — furniture lifecycle ops; `global` impact for story edits.
- `packages/core/src/output/semantic-paint.ts`, `layout/semantic-interaction.ts`, `editor/surface-input.ts` — scoped selectability.
- `packages/core/src/contracts/editor.ts`, `editor/docx-editor.ts` — widen `getHeaderFooterState`, wire `editHeaderFooter`/`exitHeaderFooter`, `setActiveScope` (**minor** public API expansion; see design §Contracts).
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — two new slots.
- `packages/react/src` — chrome overlay, options menu, i18n.
- **Vue**: out of scope; follow-up required before support claim.
- **Watermarks**: owned by `typed-drawings-and-images` (VML/`w:pict`); this change does not type or edit them. `Editor.getWatermark()` remains a stub until that lane lands.
- **Not included**: `w:sectPr/@w:type` values other than `nextPage` for section-start page indexing (see design §Ownership); `CT_FldChar/w:ffData` legacy form fields.

## Observed baseline (2026-08-03)

`bun test` on current `docx-editor-v2`: **2243 pass, 52 fail, 49 errors across 205 files** — **not passing**. Dominant failures: undeclared `fflate`/`yjs` imports in tests, OpenSpec commit-evidence governance, spike-disposability gate. Task 9.6 requires reporting any bypassed gate as failing; do not describe this baseline as green.

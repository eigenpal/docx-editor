## 0. Confirm the shipped baseline

- [x] 0.1 **Shipped:** per-section resolution and inheritance — `resolveHeaderFooterPartsBySection` in `hf-references.ts`; pinned by `hf-references.test.ts`. Load `comprehensive-word-element-test.docx` in the demo to confirm each of the five sections paints its own pair and the first section paints blank (browser evidence still useful for the demo path).
- [x] 0.2 **Shipped:** `first`/`even` variant resolution — `section-inheritance-header-footer.docx` plus `even-odd-header-parity.test.ts` for document-relative odd/even. (`titlePg-header-footer.docx` now exists under `e2e/fixtures/`; mid-document `titlePg` on a `nextPage` section still needs `hf-variants.docx`, §8.1.)
- [x] 0.3 **Recorded baseline (2026-08-03):** `bun test` → **2243 pass, 52 fail, 49 errors across 205 files** — not passing. Dominant: undeclared `fflate`/`yjs` imports, OpenSpec commit-evidence governance, spike-disposability gate. Later "no regression" claims compare against this honest number. Do **not** claim a clean full-suite baseline.
- [ ] 0.4 Confirm with review that the D8 boundary expansion in `design.md` §D8 is accepted before typing any node

## 1. Conformance for what already ships

- [ ] 1.1 Cover per-section resolution and inheritance against `section-inheritance-header-footer.docx` and `comprehensive-word-element-test.docx`; unit coverage exists in `hf-references.test.ts` / scoped HF tests, but dedicated fixture-level acceptance is still thin
- [ ] 1.2 Cover section-relative `w:titlePg` on a **mid-document** section (`hf-variants.docx`, §8.1) and document-relative odd/even (`even-odd-header-parity.test.ts` already pins the latter; `titlePg` on/off across sections pinned in `hf-references.test.ts`)
- [ ] 1.3 Cover the first section declaring no reference — blank, not a later section's part (`hf-lifecycle.test.ts` + `hf-references.test.ts` pin the shape; comprehensive fixture acceptance still open)
- [ ] 1.4 Pin fail-open dangling `r:id` (**done** in `hf-references.test.ts`) and first-reference-wins (implemented in `hf-references.ts`; dedicated assertion / Word evidence still open — see §3.6)
- [x] 1.5 **Shipped:** flow-height box sizing against a header with a page-relative anchored drawing — `paginated-surface-hf.test.ts` (#856); furniture cache identity covered in `furniture-cache-identity.test.ts`

## 2. Page-number fields

- [x] 2.1 **Shipped:** `SECTIONPAGES` on the allowlist in `field-projection.ts`, reuse keyed by section page count — `section-page-fields.test.ts`
- [x] 2.2 **Shipped via §4:** typed `w:fldChar`, `w:instrText`, `w:fldSimple` as canonical nodes — `ooxml-tree.ts` / `field-nodes.ts` / `typed-field-nodes.test.ts`
- [x] 2.3 **Shipped:** demotion for malformed fields — `end` without `begin`, orphaned `w:instrText`, nested fields beyond cap — `typed-field-nodes.test.ts` / `field-projection.test.ts`
- [x] 2.4 **Shipped:** non-page-number instructions stay inert — no fetch at load, layout, paint, or save — `section-page-fields.test.ts` / `typed-field-nodes.test.ts` / `field-projection.test.ts`
- [x] 2.5 **Shipped for PAGE/NUMPAGES/SECTIONPAGES:** right-aligned/centred/tab positioning across digit boundaries — `field-projection.test.ts` / `section-page-fields.test.ts`
- [x] 2.6 **Shipped:** `NUMPAGES` updates when pagination changes — `field-projection.test.ts` / `finalizePageFieldProjection` / `section-page-fields.test.ts`

## 3. Section geometry

- [x] 3.1 Header and footer distances ship on `SectionProperties.margins`; cover in acceptance rather than re-reading (`section-aware-pagination.test.ts`)
- [x] 3.2 **Shipped:** read `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`); empty element reports no authored values and re-emits empty — `section-properties.test.ts`; PAGE display honours `start`/`fmt` — `section-page-fields.test.ts`
- [ ] 3.3 Read `w:cols/@w:sep` and draw the column separator — **deferred** (multi-column flow still deferred)
- [x] 3.4 **Shipped:** tall furniture push-down — `semantic-layout.ts` (`effectiveTop`/`effectiveBottom`); add `hf-tall-header.docx` conformance (§8.3), do not re-implement
- [ ] 3.5 **Settle the literal-U+0009 rule against Word** before writing a test; pin across `header1`, `header4`, `footer1`, `footer2`, `footer3` — **open**
- [ ] 3.6 Settle "first duplicate reference wins" against Word; currently asserted in `hf-references.ts` without Word evidence / dedicated test — **open**

## 4. Typed fields

- [x] 4.1 **Shipped:** typed field kinds in `ooxml-tree.ts` for `w:fldChar`, `w:instrText`, `w:fldSimple`, preserving `@w:dirty` and `@w:fldLock` — `typed-field-nodes.test.ts`
- [x] 4.3 **Shipped:** honour `w:pgNumType` start and format in `PAGE` — `section-page-fields.test.ts` (coordinate `ST_NumberFormat` with `typed-notes-footnotes-endnotes` as needed)
- [x] 4.4 **Shipped:** leave every other instruction inert; security tests — no fetch for external-inclusion instruction — `section-page-fields.test.ts` / `typed-field-nodes.test.ts`
- [x] 4.5 **Shipped:** preserve cached result on save; structural round-trip — `typed-field-nodes.test.ts` / `field-projection.test.ts`
- [x] 4.6 **Shipped:** field as one unit for caret movement and deletion — `typed-field-nodes.test.ts` (atomic addressing); furniture scope keeps PAGE painted while open — `scoped-header-footer-editing.test.ts`

## 5. Store operations and scoped editing

- [x] 5.1 **Shipped:** `createHeaderFooter`, `deleteHeaderFooter`, `linkToPrevious`, `unlinkFromPrevious`, `setSectionFurnitureOptions` — `hf-lifecycle.ts` / `tree-ops` / `hf-lifecycle.test.ts`
- [x] 5.2 **Shipped:** unlink clones inherited part; link garbage-collects orphan part, relationship, override — `hf-lifecycle.test.ts`
- [x] 5.3 **Shipped:** refuse link-to-previous on first section with `invalidArgs` — `hf-lifecycle.test.ts` / `header-footer-lifecycle-commands.test.ts`
- [x] 5.4 **Shipped:** scope furniture selectability — editable while scope open, `[data-docx-hf]`-excluded otherwise — `scoped-header-footer-editing.test.ts`
- [x] 5.5 **Shipped:** re-express browser DOM mutations inside open scope as `TreeDocOp`s — `scoped-header-footer-editing.test.ts` (typing / formatting path)
- [x] 5.6 **Shipped:** one story edit repaints every page showing it; HF commits publish **`global`** impact — `tree-package-store.ts` / `hf-lifecycle.test.ts` / `scoped-header-footer-editing.test.ts`
- [x] 5.7 **Shipped:** inherited-vs-declared resolution query for chrome; wired into `getHeaderFooterState()` — `hf-lifecycle.test.ts` / `header-footer-lifecycle-commands.test.ts`
- [x] 5.8 **Shipped:** `editHeaderFooter`, `exitHeaderFooter`, `removeHeaderFooter`, `setActiveScope` in `docx-editor.ts` / `docx-editor-hf.ts` using `EditorScope { kind: 'headerFooter'; rId }`

## 6. React adapter

- [x] 6.1 **Shipped:** `insert.pageNumber`, `insert.totalPages`, `insert.sectionPages`, `insert.pageXofY` in `chrome-controls.ts`; ids are public API
- [x] 6.2 **Shipped:** all four rows in `SLOT_COMMANDS` → `insertPageField`
- [x] 6.3 **Shipped:** chrome overlay — region, section, variant, inherited warning — `DocxEditorHeaderFooter.tsx` / `header-footer-chrome.test.tsx`
- [x] 6.4 **Shipped:** options menu with live state and engine-supplied disabled reasons (title page, even/odd, link/unlink, remove)
- [x] 6.5 **Shipped:** enter on furniture activation / double-click path, leave on Escape and body activation; restore prior body selection — `surface-pointer.ts` / `surface-input.ts` / `scoped-header-footer-editing.test.ts`
- [x] 6.6 **Shipped:** chrome mousedown `preventDefault()` except INPUT/SELECT/TEXTAREA — `header-footer-chrome.test.tsx`
- [x] 6.7 **Shipped:** i18n keys in `en.json` (`headerFooter.*`); other locales mirror / null-fallback. (Do not re-touch locales in the stash-conflict pass.)
- [ ] 6.8 `bun run api:extract` and `bun run check:parity` — **follow-up / pre-existing drift:** React-only HF chrome is intentional (Vue furniture chrome deferred); full `api:check` / `check:parity` may still fail for unrelated reasons. Do not claim green here while snapshots stay conflicted.

## 8. Fixtures

- [ ] 8.1 Use `section-inheritance-header-footer.docx` for inheritance and section-1 `titlePg`. Author **`hf-variants.docx`** for mid-document `titlePg` on a `nextPage` section (leading section so first page of section 3 ≠ document page 1). `titlePg-header-footer.docx` exists but does not replace the mid-document case.
- [ ] 8.2 Extend from `section-inheritance-header-footer.docx` for first-section-no-reference shape (also in comprehensive fixture)
- [ ] 8.3 `hf-tall-header.docx` — header taller than margin; exercises push-down conformance (behaviour already in `semantic-layout.ts`)
- [ ] 8.4 `hf-page-numbering.docx` — `w:pgNumType` with `start` and `fmt="lowerRoman"`, plus `SECTIONPAGES` (unit coverage exists in `section-page-fields.test.ts`; dedicated fixture still open)
- [ ] 8.5 `hf-real-tabs.docx` — three-section header with `w:tab` nodes; or extend `header-right-tab.docx` coverage
- [ ] 8.6 Keep comprehensive fixture as round-trip and tolerance fixture

## 9. Verification and honest scope

- [x] 9.1 **Vue is not done (deferred follow-up).** `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Do not claim Vue furniture chrome.
- [x] 9.2 Rewrite headers/footers (+ fields) entries in `deferred-features.md` to post-change status (this pre-PR pass)
- [x] 9.3 D9: canonical fingerprint / save-reopen semantic digest pinned for HF parts on lifecycle path — `hf-lifecycle.test.ts` / `hf-references.test.ts`. Broader unedited-package matrix still open.
- [ ] 9.4 Full-vs-incremental differential over a header edit that changes flow height — **open**
- [ ] 9.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate scoped-header-footer-editing --strict` and `openspec validate typed-ooxml-paragraph-editor --strict` — run openspec in the docs pass; do **not** claim full-suite green (§0.3)
- [x] 9.6 Report bypassed or still-failing gates as failing — baseline is **not** green (§0.3)
- [ ] 9.7 `bun run format` — open for the full PR land; not claimed here

## 10. Explicitly out of scope / deferred

- [ ] 10.1 **Watermarks** — owner `typed-drawings-and-images` (`design.md` §Ownership); `watermark-confidential.docx` not in this lane; `Editor.getWatermark()` remains a stub
- [ ] 10.2 **`w:sectPr/@w:type` section-start indexing** — `continuous`/`evenPage`/`oddPage` affect where a section's first page is; deferred for `titlePg` on continuous sections
- [ ] 10.3 Note references inside headers/footers — `typed-notes-footnotes-endnotes` remaining / notes-in-HF layout
- [ ] 10.4 Field instructions outside page-number family — inert by design (body field evaluation deferred)
- [ ] 10.5 **`CT_FldChar/w:ffData` legacy form fields** — deferred; preserve generic, never execute macros (`design.md` §H7)
- [ ] 10.6 **Vue twin** of HF chrome / hooks — follow-up before adapter-support claim
- [ ] 10.7 **Drawings/images authoring** and **structural table ops** inside furniture — not claimed as body-parity; existing fixtures may paint tables/images but authoring stays with their owner lanes
- [ ] 10.8 **Tracked changes** inside furniture — deferred with `typed-revisions-and-comments`

## 11. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [ ] 11.1 **Declare the D8 boundary expansion** — done in `design.md` §D8; task 0.4 confirms review acceptance
- [x] 11.2 **Shipped:** page-number evaluation in layout, before measurement — `field-projection.ts`, `paginated-surface-hf.test.ts`, `field-projection.test.ts`, `section-page-fields.test.ts`. Do not move to paint.
- [x] 11.3 **Shipped:** demotion rule for malformed fields (§2.3 / §4)
- [x] 11.4 **Shipped:** field atomicity in furniture/model addressing; body `TOC`/`REF`/`SEQ` remain character-editable / inert until a document-wide fields lane exists
- [x] 11.5 **`ffData` legacy form fields deferred** — `design.md` §H7 and §10.5; not owned by this change
- [ ] 11.6 Sweep remaining `EG_SectPrContents`: `w:pgBorders`, `w:vAlign`, `w:lnNumType`, `w:docGrid`, `w:bidi`, `w:rtlGutter`, `w:textDirection`, `w:formProt`, `w:noEndnote` — **open**
- [ ] 11.7 Column geometry: `CT_Columns` `w:col` children with per-column `@w:w`/`@w:space` — **open**
- [x] 11.8 **Shipped:** story-content header/footer edits publish **`global`** impact (§5.6)
- [x] 11.9 **`titlePg` on `continuous` sections deferred** — `design.md` §Ownership; mid-document fixture uses `nextPage` only
- [x] 11.10 **Done:** `## MODIFIED` spec delta at `specs/header-footer-editing/spec.md`
- [x] 11.11 **Watermark owner assigned** to `typed-drawings-and-images` (`design.md` §Ownership)
- [x] 11.12 **Shipped:** reconcile `EditorScope`, `editHeaderFooter`, `getHeaderFooterState` per `design.md` §Contracts; public API expansion is **minor**

## 12. Body parity and page-number correctness

- [x] 12.1 **Shipped:** open scope uses the same editing path as body — `scoped-header-footer-editing.test.ts` (no reduced furniture editor)
- [x] 12.2 **Shipped (core):** scope-boundary clamping via `clampSelectionToScope`; select-all stays inside the open story (pinned). Broader Home/End/arrow-off-last / block-paste matrix still thin — treat residual gaps as follow-up, not unshipped scope.
- [ ] 12.3 Run body editing test suite against open header scope — **open**
- [ ] 12.4 IME composition in scope commits as one semantic history entry — **open** (shared IME path exists; dedicated HF assertion missing)
- [x] 12.5 **Shipped:** `PAGE`/`NUMPAGES`/`SECTIONPAGES` evaluated in layout before measurement — `field-projection.ts`
- [x] 12.6 **Shipped:** layout reuse per distinct evaluated-result geometry — `hf-layout.ts` / `field-projection.ts` / `section-page-fields.test.ts`
- [x] 12.7 **Shipped:** alignment across digit boundary — `field-projection.test.ts` / `section-page-fields.test.ts`
- [x] 12.8 **Shipped:** `NUMPAGES` updates on repagination — `finalizePageFieldProjection`
- [x] 12.9 **Shipped:** `PAGE` stays painted for the edited page while furniture scope is open — `scoped-header-footer-editing.test.ts`

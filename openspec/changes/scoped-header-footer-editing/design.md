# Design — scoped header and footer editing

## Context

`typed-ooxml-paragraph-editor` is the production authority. Its D7 inventory lists headers and footers as deferred for editing with layout "read-only page furniture supported"; this change is that lane's named future gate.

**Shipped on docx-editor-v2 (post PR #76):** per-section resolution (`hf-references.ts`), inheritance via `inheritMaps`, section-relative `w:titlePg` and document-relative odd/even (`semantic-layout.ts` `variantFor` with `pageIndexStart`), flow-height box sizing (`hf-layout.ts`), tall-header push-down (`semantic-layout.ts` effectiveTop/effectiveBottom), layout-time `PAGE`/`NUMPAGES` projection (`field-projection.ts`, `finalizePageFieldProjection`). **Not shipped:** editing, inheritance metadata on the public surface, typed fields, `SECTIONPAGES`, `w:pgNumType`, `w:cols/@w:sep`, and the section-property sweep.

The archived `header-footer-editing` spec described a hidden-ProseMirror-per-`rId` model. That design is **superseded** by scoped semantic editing on the painted surface (`specs/header-footer-editing/spec.md`).

## Decisions

### H1: Resolution is settled; this change surfaces inheritance and consumes it

`resolveHeaderFooterPartsBySection` already computes per-section resolution with inheritance and per-section `titlePage`, and layout attaches it per section. Resolution stays a function, not a stored map. This change **does not** reopen resolution logic; it adds conformance coverage and a **new query** that reports inherited versus declared per kind/variant.

**Correction:** `inheritMaps` merges declared and inherited parts into one map. Nothing on `Editor`, `getHeaderFooterState()`, or the adapter surface exposes whether the active part is inherited. The chrome cannot warn "Same as previous" from today's API — that metadata is a deliverable of this change, not a shipped fact.

### H2: `variantFor` and `pageIndexStart` are settled

`semantic-layout.ts` applies `w:titlePg` to the section-local first page (`index === 0` within the section) and `w:evenAndOddHeaders` against `(pageIndexStart + index + 1)`. `even-odd-header-parity.test.ts` and `hf-references.test.ts` pin this. Do not re-open.

### H3: Tall-header push-down is settled

`semantic-layout.ts` computes `effectiveTop`/`effectiveBottom` from the worst-case furniture flow height (capped at 40% of the sheet). `paginated-surface-hf.test.ts` documents the behaviour. This change adds a dedicated fixture (`hf-tall-header.docx`) and conformance assertion; it does not re-implement push-down.

### H4: Keep the two reference rules that are already right

`hf-references.ts` fails open on a dangling `r:id` and honours the first reference of a duplicated type. `variantFor`'s absent-variant rule — blank, not `default` — survives unchanged.

### H5: `hf-layout.ts` does not change shape

It already lays a story out once per variant at the section's content width, keeps `flowHeight` as the box size, and namespaces line ids by part. Per-section resolution changes *which* stories attach, not how one is laid out.

### H6: Editing scopes the furniture rather than un-furnishing it

While a scope is open, one story's fragments join the caret space; while closed, all furniture is inert (`[data-docx-hf]`, excluded from selection). Inside the scope the behaviour is the body's — no reduced furniture editor. Task 12.3 runs body editing tests against an open scope to prove parity.

### H7: Fields evaluate in layout; everything else is inert

`field-projection.ts` evaluates `PAGE`/`NUMPAGES` during `piecesOfParagraph`, before measurement. Paint-time substitution is explicitly rejected. This change adds `SECTIONPAGES`, types the field nodes, and honours `w:pgNumType` in `PAGE`.

The inert-by-default rule is a security requirement. Non-page-number instructions, including DDE/`INCLUDE*`, never execute. **`CT_FldChar/w:ffData`** (legacy form fields with `entryMacro`/`exitMacro`) is **deferred**: preserved as generic structure, never executed, no macro surface — owned explicitly here as out of scope until a security-reviewed forms lane exists.

### H8: The literal-tab rule is scheduled, not asserted

Five comprehensive-fixture parts use literal U+0009 with a declared right tab stop and zero `w:tab` elements. Task 3.5 settles against Word before pinning a test.

## D8 boundary expansion

D8 fixes the first paragraph property boundary in `typed-ooxml-paragraph-editor`. This change expands it with vocabulary this lane owns:

| Addition | Scope |
| --- | --- |
| Field complex form | `w:fldChar` (`begin`/`separate`/`end`), `w:instrText`, `@w:dirty`, `@w:fldLock` |
| Field simple form | `w:fldSimple` with `@w:instr` |
| Section properties | `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`), `w:cols/@w:sep`, per-column `w:col/@w:w` and `@w:space` |
| Section property sweep (read + round-trip; layout where stated) | `w:pgBorders`, `w:vAlign`, `w:lnNumType` — deferred layout behaviour documented per task 11.6 |

**Not in this D8 expansion:** `CT_FldChar/w:ffData` (deferred §H7), body-story field evaluation (remains deferred; furniture-only projection stays), watermark VML (`typed-vml-watermarks` — sole VML watermark owner).

Task 0.4 requires review acceptance of this expansion before typing any node.

## Contract reconciliation and semver

Reconcile against shipped `@public` members before implementation (`word-fidelity-review-findings.md` §1):

| Shipped member | This change |
| --- | --- |
| `EditorScope { kind: 'headerFooter'; rId }` | **Use as-is.** Scope activation for furniture editing binds here; no parallel `{sectionIndex, variant}` scope shape. |
| `editHeaderFooter` / `exitHeaderFooter` / `removeHeaderFooter` | **Wire** in `docx-editor.ts`. Prefer `variant: 'default' \| 'first' \| 'even'`; `firstPage` / `evenPage` remain aliases. Creating a missing `first`/`even` part enables `titlePg` / `evenAndOddHeaders` in the same undo unit. **Patch** — behaviour addition on existing commands. |
| `getHeaderFooterState(): { editing, sectionIndex } \| null` | **Minor expansion:** add `variant`, `rId`, `inherited`, `partName` (or equivalent) so chrome can render without adapter guesses. Existing fields stay; adapters ignoring new fields remain valid. |
| `setActiveScope` / `getActiveScope` | **Wire** for furniture scope transitions. **Patch.** |
| `Editor.getWatermark()` | **Unchanged stub until watermark owners land** — DrawingML image watermarks: `typed-drawings-and-images`; VML watermarks: `typed-vml-watermarks`. |

`bun run api:extract` + commit snapshot after contract changes. Vue `UseDocxEditorReturn` must declare a named return interface if new reads leak into the Vue API Extractor snapshot.

## Ownership and deferrals

| Topic | Decision |
| --- | --- |
| **Watermarks** (`w:pict`/VML shape or floating drawing in a header) | **VML owner: `typed-vml-watermarks`.** DrawingML image watermarks: `typed-drawings-and-images`. This change defers typing, layout, and editing of VML watermarks. `watermark-confidential.docx` exists but is not in this lane's acceptance. |
| **`CT_FldChar/w:ffData` legacy form fields** | **Deferred by this change.** Round-trip as generic; never execute macros; no `w:formProt` editing surface. Revisit only with an explicit security review. |
| **`w:sectPr/@w:type` ≠ `nextPage` for section-start page index** | **Deferred for `titlePg` on `continuous` sections.** `SectionBreakType` is read (`section-properties.ts`) but continuous section-start page numbering is not modelled for furniture variant pick or `titlePg` "first page of section" when the section shares a sheet. Do not claim mid-document `titlePg` correctness on `continuous` breaks until section-start indexing lands; the new `hf-variants.docx` fixture uses `nextPage` breaks only. |
| **`ST_NumberFormat` shared with notes** | Coordinate with `typed-notes-footnotes-endnotes` before implementing `w:pgNumType/@w:fmt` display (finding 3). |
| **Scope precedence** (comment in note in header) | Coordinate with `typed-notes-footnotes-endnotes` and `typed-revisions-and-comments`; `setActiveScope` is the shared mechanism — this change defines furniture scope only. |

## Open questions

1. **Vue follow-up.** React-only by request. Open a tracked follow-up before merge; do not describe the lane as adapter-supported.

2. **Notes referenced from a header.** `typed-notes-footnotes-endnotes` round-trips such a reference and does not lay it out. Whichever change lands second confirms agreement.

3. **Continuous-section `titlePg`.** Deferred until section-start page indexing exists (see Ownership). The mid-document `titlePg` fixture uses `nextPage` section breaks.

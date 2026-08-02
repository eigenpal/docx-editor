## 0. Confirm the shipped baseline

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and record which header and footer each of the five sections paints. Per-section resolution and inheritance ship, so each section should paint its own pair and the first section should paint blank
- [ ] 0.2 Load `titlePg-header-footer.docx` and `section-inheritance-header-footer.docx` and confirm `first` and `even` variants resolve per section
- [ ] 0.3 Record the current `bun test` result so later "no regression" claims compare against a number that was read

## 1. Conformance for what already ships

- [ ] 1.1 Cover per-section resolution and inheritance against the fixtures above; these paths had no fixture coverage when they landed
- [ ] 1.2 Cover section-relative `w:titlePg` on a **mid-document** section, and document-relative odd/even for a section beginning on an even page
- [ ] 1.3 Cover the first section declaring no reference — it renders blank, not a later section's part
- [ ] 1.4 Pin fail-open on a dangling `r:id` and first-reference-wins on a duplicated type, so a later refactor cannot lose them
- [ ] 1.5 Pin flow-height box sizing against a header containing a page-relative anchored drawing

## 2. Page-number fields

- [ ] 2.1 Add `SECTIONPAGES` to the allowlist, with reuse keyed by the section's page count
- [ ] 2.2 Type `w:fldChar`, `w:instrText`, and `w:fldSimple` as canonical nodes so a field is one addressable unit, preserving `@w:dirty` and `@w:fldLock`
- [ ] 2.3 Add a demotion rule for malformed fields — an `end` with no `begin`, an orphaned `w:instrText`, nested fields
- [ ] 2.4 Assert every non-page-number instruction stays inert, with no fetch at load, layout, paint, or save
- [ ] 2.5 Assert right-aligned, centred, and tab-positioned numbers stay positioned across the single-to-double-digit boundary
- [ ] 2.6 Assert `NUMPAGES` updates everywhere when pagination changes the page count

## 3. Section geometry

- [ ] 3.1 Header and footer distances already ship on `SectionProperties.margins`; cover them rather than re-reading them
- [ ] 3.2 Read `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`); an empty element reports no authored values and re-emits empty
- [ ] 3.3 Read `w:cols/@w:sep` and draw the column separator
- [ ] 3.4 Push the body content area down when a story's flow height exceeds the header margin; keep flow height — never an anchored extent — as the box size
- [ ] 3.5 **Settle the literal-U+0009 rule against Word before writing a test.** ECMA-376 does not decide it. Then pin it across all five affected parts — `header1`, `header4`, `footer1`, `footer2`, `footer3` — not just `header1`, and record the evidence
- [ ] 3.6 Settle "first duplicate reference wins" against Word too; it is currently asserted and unsourced

## 4. Typed fields

- [ ] 4.1 Add typed field kinds to `ooxml-tree.ts` for `w:fldChar`, `w:instrText`, and `w:fldSimple`, preserving `@w:dirty` and `@w:fldLock`
- [ ] 4.3 Honour `w:pgNumType` start and format in `PAGE`
- [ ] 4.4 Leave every other instruction inert; add a security test asserting no fetch is issued at load, layout, paint, or save for an external-inclusion instruction
- [ ] 4.5 Preserve the cached result on save rather than recomputing it
- [ ] 4.6 Field as one unit for caret movement and deletion

## 5. Store operations and scoped editing

- [ ] 5.1 Add create-header-footer, delete-header-footer, link-to-previous, unlink-from-previous, set-section-furniture-options to `tree-ops.ts` and siblings
- [ ] 5.2 Unlink clones the inherited part; link collects an orphaned part, relationship, and content-type override
- [ ] 5.3 Refuse link-to-previous on the first section with `invalidArgs`
- [ ] 5.4 Scope furniture selectability: editable while its scope is open, `[data-docx-hf]`-excluded otherwise
- [ ] 5.5 Re-express browser DOM mutations inside an open scope as `TreeDocOp`s
- [ ] 5.6 One story edit repaints every page that shows it, as one transaction

## 6. React adapter

- [ ] 6.1 Add `insert.pageNumber` and `insert.pageXofY` to `chrome-controls.ts`; ids are public API forever
- [ ] 6.2 Add both rows to `SLOT_COMMANDS`
- [ ] 6.3 Chrome overlay: region, section, variant, and "Same as previous"; UI only, contributing no layout records
- [ ] 6.4 Options menu with live state and engine-supplied disabled reasons
- [ ] 6.5 Enter on double-click, leave on Escape and on double-click in the body; restore the prior body selection
- [ ] 6.6 Chrome mousedown `preventDefault()` except on INPUT/SELECT/TEXTAREA
- [ ] 6.7 i18n keys, `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 6.8 `bun run api:extract` and `bun run check:parity`

## 8. Fixtures

- [ ] 8.1 Use `titlePg-header-footer.docx` and `section-inheritance-header-footer.docx` for variant and inheritance coverage. Author `hf-variants.docx` only for the case they lack: `w:titlePg` on a **mid-document** section, which is the section-relative bug this change fixes
- [ ] 8.2 Extend from `section-inheritance-header-footer.docx`; the case it may lack is a **first** section declaring nothing, which is the comprehensive fixture's shape
- [ ] 8.3 `hf-tall-header.docx` — a header taller than its margin, to exercise the push-down
- [ ] 8.4 `hf-page-numbering.docx` — `w:pgNumType` with `start` and `fmt="lowerRoman"`, plus `SECTIONPAGES`
- [ ] 8.5 `hf-real-tabs.docx` — a three-section header using `w:tab` nodes. The comprehensive fixture has **zero** `w:tab` elements in any header or footer, so real tab layout has no coverage there at all
- [ ] 8.6 Keep the comprehensive fixture as the round-trip and tolerance fixture

## 9. Verification and honest scope

- [ ] 9.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; this change ships React only by request. Open the follow-up before merge and do not describe the lane as supported
- [ ] 9.2 Rewrite the headers/footers entry in `deferred-features.md` to its post-change status; keep the entry
- [ ] 9.3 D9: canonical fingerprint on unedited round trip; save/reopen semantic digest with one edited part and the rest unchanged
- [ ] 9.4 Full-vs-incremental differential test over a header edit that changes flow height
- [ ] 9.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate scoped-header-footer-editing --strict`
- [ ] 9.6 Report any bypassed or still-failing gate as failing
- [ ] 9.7 `bun run format`

## 10. Explicitly out of scope

- [ ] 10.1 Watermarks — blocked on `typed-drawings-and-images`
- [ ] 10.2 `w:sectPr/@w:type` values other than `nextPage` — modelled, not laid out
- [ ] 10.3 Note references inside headers and footers — owned by `typed-notes-footnotes-endnotes`
- [ ] 10.4 Field instructions outside the page-number family — inert by design, not a gap to close later without a security review

## 11. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [ ] 11.1 **Declare the D8 boundary expansion.** This is the only one of the five changes that never does, and it types the whole field vocabulary plus four section properties (finding 4)
- [ ] 11.2 Move page-number field evaluation out of paint and into layout, with a reserved width, so a line measured with a cached result does not paint a wider string. `typed-notes` §3.8 solves the identical problem (finding 4)
- [ ] 11.3 Add a demotion rule for malformed fields — an `end` with no `begin`, an orphaned `w:instrText`, nested fields. This is the one new vocabulary with no fail-open rule
- [ ] 11.4 Field atomicity is scoped to the HF editing scope but fields are document-wide; a body `TOC`/`REF`/`SEQ` is left editable character-by-character (finding 2.6)
- [ ] 11.5 Own or explicitly defer `CT_FldChar/w:ffData` legacy form fields — they carry `entryMacro`/`exitMacro` and are what `w:formProt` protects (finding 2.6)
- [ ] 11.6 Sweep the remaining `EG_SectPrContents`: `w:pgBorders`, `w:vAlign`, `w:lnNumType`, `w:docGrid`, `w:bidi`, `w:rtlGutter`, `w:textDirection`, `w:formProt`, `w:noEndnote`
- [ ] 11.7 Column geometry is still count+gap; `CT_Columns` has `w:col` children with per-column `@w:w`/`@w:space`
- [ ] 11.8 Give header/footer story-content edits a `global` impact class (finding 4)
- [ ] 11.9 Resolve `w:sectPr/@w:type` — `continuous` makes "the first page of its section" undefined, which the section-relative `titlePg` fix depends on (finding 2)
- [ ] 11.10 Add the missing `## MODIFIED` spec delta for `header-footer-editing`; `openspec validate --strict` does not catch its absence
- [ ] 11.11 Assign the watermark owner with `typed-drawings-and-images` (finding 3)

## 12. Body parity and page-number correctness

- [ ] 12.1 Drive the open scope through the **same** editing path as the body — no reduced or special-cased furniture editor. Any capability that needs a scope-specific branch is a defect to justify, not a shortcut to take
- [ ] 12.2 Scope-boundary rules: select-all selects the story; Home/End and line navigation resolve within it; arrow navigation off the last position does not walk into the body; block paste lands in the story
- [ ] 12.3 Run the body's own editing test suite against an open header scope, so parity is proven rather than asserted
- [ ] 12.4 IME composition in scope commits as one semantic history entry
- [ ] 12.5 Evaluate `PAGE` / `NUMPAGES` / `SECTIONPAGES` **in layout, before measurement**, keyed by the page the story attaches to — not as a paint-time substitution. A line measured for `1` and painted with `12` mis-positions every tab stop and right-alignment on that line
- [ ] 12.6 Lay a story out once per variant per distinct evaluated-result geometry; pages whose results measure identically share one layout
- [ ] 12.7 Assert right-aligned, centred, and tab-positioned page numbers stay positioned across a single-to-double-digit boundary
- [ ] 12.8 Assert `NUMPAGES` updates everywhere when pagination changes the page count, with no manual refresh
- [ ] 12.9 Assert a `PAGE` field shows the edited page's own number while its scope is open — not a placeholder, not `1`, not the field code

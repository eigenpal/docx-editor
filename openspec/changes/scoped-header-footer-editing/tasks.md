## 0. Confirm the diagnosis before changing code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and record which header and footer each of the five sections actually paints today. The prediction is that every page shows `rId12` / `rId13`; if it does not, `design.md` is wrong and this change is re-planned before any edit
- [ ] 0.2 Record whether the first section paints blank or paints a later section's header — that single observation is the change's headline defect
- [ ] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result, so later "no regression" claims compare against a number that was read

## 1. Per-section resolution

- [ ] 1.1 Replace the single-`w:sectPr` lookup in `hf-references.ts` with per-section resolution built on `readDocumentSections`
- [ ] 1.2 Implement inheritance from the preceding section, per kind and per variant
- [ ] 1.3 First section with no reference resolves to none, not to a later section's part
- [ ] 1.4 Report `inherited` on the resolution result
- [ ] 1.5 Preserve fail-open on a dangling `r:id` and first-reference-wins on a duplicated type; add tests pinning both so the rewrite cannot lose them
- [ ] 1.6 Update `resolveHeaderFooterParts`'s callers; the document-global signature goes away rather than gaining a section parameter with a default

## 2. Variant selection

- [ ] 2.1 Make `titlePage` a per-section property
- [ ] 2.2 Make `variantFor` section-relative for `first` — the first page of the section, not of the document
- [ ] 2.3 Keep `w:evenAndOddHeaders` document-scoped and evaluated against the displayed page number
- [ ] 2.4 Keep the absent-variant-renders-blank rule
- [ ] 2.5 Cover `first` and `even` with tests; both paths are uncovered by any current fixture

## 3. Section geometry

- [ ] 3.1 Read `w:pgMar/@w:header` and `@w:footer` into `SectionProperties`
- [ ] 3.2 Read `w:pgNumType` (`start`, `fmt`, `chapStyle`, `chapSep`); an empty element reports no authored values and re-emits empty
- [ ] 3.3 Read `w:cols/@w:sep` and draw the column separator
- [ ] 3.4 Push the body content area down when a story's flow height exceeds the header margin; keep flow height — never an anchored extent — as the box size
- [ ] 3.5 Pin the literal-tab rule with a test over `header1.xml`, and record in the fixture notes that this header is a tolerance case

## 4. Typed fields

- [ ] 4.1 Add typed field kinds to `ooxml-tree.ts` for `w:fldChar`, `w:instrText`, and `w:fldSimple`, preserving `@w:dirty` and `@w:fldLock`
- [ ] 4.2 Evaluate `PAGE`, `NUMPAGES`, `SECTIONPAGES` at paint time, keyed by the painted page; painting publishes no `ModelChange`
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

## 7. Retire the superseded spec

- [ ] 7.1 `openspec/specs/header-footer-editing/spec.md` describes a hidden per-`rId` ProseMirror view and a painter that renders it. That architecture no longer exists. Archive or rewrite it in this change; do not leave two contradictory descriptions standing

## 8. Fixtures

- [ ] 8.1 `hf-variants.docx` — `w:titlePg` on a mid-document section plus `first` and `even` references with `w:evenAndOddHeaders` enabled. No current fixture covers either path
- [ ] 8.2 `hf-inheritance.docx` — a section declaring only a footer, a section declaring nothing, and a first section declaring nothing
- [ ] 8.3 `hf-tall-header.docx` — a header taller than its margin, to exercise the push-down
- [ ] 8.4 `hf-page-numbering.docx` — `w:pgNumType` with `start` and `fmt="lowerRoman"`, plus `SECTIONPAGES`
- [ ] 8.5 `hf-real-tabs.docx` — a three-section header using `w:tab` nodes, so tab layout is covered by a file that is not the literal-tab tolerance case
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

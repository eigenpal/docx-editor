## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and record what each of the seventeen controls looks like today — specifically whether a placeholder prompt is indistinguishable from typed text
- [ ] 0.2 Confirm by experiment that typing beside a `w:showingPlcHdr` prompt appends rather than replaces, and that the saved file keeps the flag over the typed text. That is the defect this change is measured against
- [ ] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.4 Confirm with review that the D8 boundary expansion — control nodes, `CT_SdtPr`, type payloads — is accepted before typing any node

## 1. Typed nodes

- [ ] 1.1 Add `contentControl` and `contentControlContent` to the node-kind union in `ooxml-tree.ts` at block, inline, row, and cell level
- [ ] 1.2 Type `CT_SdtPr` in schema order; preserve unmodelled children as generic in position
- [ ] 1.3 Type `CT_SdtDropDownList`, `CT_SdtComboBox`, `CT_SdtDate`, `CT_SdtText`, `CT_DataBinding`, and `w14:checkbox` as a vendor extension
- [ ] 1.4 Define an inline control's contribution to paragraph UTF-16 offsets so `TreeDocOp` addressing is total across it
- [ ] 1.5 Stable node identity independent of `w:id`; preserve `w:id` where present, never fabricate it
- [ ] 1.6 Serialize normalized in schema order; assert canonical-fingerprint equality over all seventeen fixture controls on an unedited round trip

## 2. Layout

- [ ] 2.1 Keep block flattening; extend `storyBlocks` to flatten inline controls into the run stream
- [ ] 2.2 Keep `MAX_SDT_NESTING` and apply one shared bound across block and inline paths
- [ ] 2.3 Emit a boundary record per control: identity, tag, alias, type, lock, placeholder state, and content geometry
- [ ] 2.4 Boundary records report both fragments when a control's content splits across pages
- [ ] 2.5 Assert page geometry is identical with and without a control wrapper around the same content

## 3. Placeholder state

- [ ] 3.1 Render `w:showingPlcHdr` content as placeholder, visually distinguished
- [ ] 3.2 First input replaces the whole prompt and clears the flag in one transaction
- [ ] 3.3 Emptying the control restores the prompt and the flag
- [ ] 3.4 Select the control as a unit rather than a partial range of prompt characters
- [ ] 3.5 Preserve `w:placeholder/w:docPart` without reading the glossary part; the control's own content renders
- [ ] 3.6 Assert the saved file never carries `w:showingPlcHdr` over user-typed content

## 4. Lock enforcement

- [ ] 4.1 Resolve `ST_Lock` — `sdtLocked`, `contentLocked`, `sdtContentLocked`, `unlocked` — per control
- [ ] 4.2 Enforce in `tree-op-validate.ts`, refusing with `locked` and publishing no `ModelChange`
- [ ] 4.3 Refuse an operation whose range spans from unlocked content into a locked control, rather than applying it partially
- [ ] 4.4 Refuse a value operation on a `w:dataBinding` control with `bound`
- [ ] 4.5 Prove enforcement from a path that never touches the surface, so the claim is about the store and not the widget
- [ ] 4.6 Surface the lock as a disabled control with the engine's own reason before the user types

## 5. Value operations and the React surface

- [ ] 5.1 Add set-content-control-value to `tree-ops.ts` with per-type value shapes; dropdown refuses a non-item with `invalidArgs`, combo accepts free entry, wrong type refuses with `typeMismatch`
- [ ] 5.2 Date operation writes `@w:fullDate` and formats content per `w:dateFormat` / `w:lid` in one transaction
- [ ] 5.3 Widgets: dropdown menu, combo entry, date picker, checkbox toggle — each committing through the op, each honouring the lock, each with mousedown prevented
- [ ] 5.4 Form-fill navigation by `w:tabIndex` then document order, skipping locked controls. **Settle Tab-inside-a-table-cell against a Word comparison before implementing** — the binding is ambiguous and must not be decided by event ordering
- [ ] 5.5 Boundary chrome on caret entry and in show-all mode; never permanently painted, never selectable, contributing no layout records
- [ ] 5.6 Inspector reporting tag, alias, type, lock, placeholder, and bound state
- [ ] 5.7 Remove-control action keeping content, disabled on `sdtLocked` / `sdtContentLocked`
- [ ] 5.8 Accessible roles, names, values, locked state, and placeholder-as-prompt
- [ ] 5.9 i18n keys, `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 5.10 `bun run api:extract`, `bun run check:parity`

## 6. Fixtures — the comprehensive file covers almost none of the correctness claims

- [ ] 6.1 `sdt-locks.docx` — every `ST_Lock` value across block, inline, and in-cell controls. **No existing fixture declares a single `w:lock`**, so lock enforcement is untestable until this exists. Author it before task 4.2
- [ ] 6.2 `sdt-checkbox.docx` — real `w14:checkbox` controls, so the checkbox widget is tested against a Word-authored file rather than the fixture's ballot-box symbols
- [ ] 6.3 `sdt-databinding.docx` — a `w:dataBinding` control plus its custom XML part, to test preserve-and-refuse
- [ ] 6.4 `sdt-placeholder-glossary.docx` — `w:placeholder/w:docPart` with a glossary part, to pin preserve-without-resolving
- [ ] 6.5 `sdt-row-cell.docx` — row-level and cell-level `w:sdt`; the comprehensive fixture has none
- [ ] 6.6 `sdt-nesting.docx` — nesting past the bound, to prove content survives and recursion stops
- [ ] 6.7 Keep the comprehensive fixture as the round-trip fixture and record its two tolerance cases: symbol-based pseudo-checkboxes, and prompts with no glossary reference

## 7. Verification and honest scope

- [ ] 7.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Open the follow-up before merge; do not describe the lane as supported
- [ ] 7.2 Rewrite the content-controls entry in `deferred-features.md`; keep the entry
- [ ] 7.3 D9: canonical fingerprint over all seventeen fixture controls unedited; save/reopen semantic digest after a value edit, with every other control unchanged
- [ ] 7.4 Security: assert no fetch is issued on account of `w:dataBinding` metadata at load, layout, paint, or save
- [ ] 7.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-content-controls --strict`
- [ ] 7.6 Report any bypassed or still-failing gate as failing
- [ ] 7.7 `bun run format`

## 8. Explicitly out of scope

- [ ] 8.1 `w:dataBinding` resolution against a custom XML part — preserved and refused, not supported
- [ ] 8.2 The glossary document behind `w:placeholder/w:docPart`
- [ ] 8.3 `w15:repeatingSection` — a Microsoft extension needing its own change; add/remove-item interacts with numbering, bookmarks, and tracked changes
- [ ] 8.4 `w:docPartObj` gallery behaviour; the fixture's TOC control paints its cached field result, since non-page-number field instructions stay inert
- [ ] 8.5 Tracked value changes — owned by `typed-revisions-and-comments`

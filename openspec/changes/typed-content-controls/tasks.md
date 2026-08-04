## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and record what each of the seventeen controls looks like today — specifically whether a placeholder prompt is indistinguishable from typed text
- [ ] 0.2 Confirm by experiment that typing beside a `w:showingPlcHdr` prompt appends rather than replaces, and that the saved file keeps the flag over the typed text. That is the defect this change is measured against
- [ ] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.4 Confirm with review that the D8 boundary expansion — control nodes, `CT_SdtPr`, type payloads — is accepted before typing any node

## Implementation evidence (store slice only)

Twenty-eight focused store tests in `content-control-ops.test.ts` (18) and `content-control-lock.test.ts` (10) cover inline offset accounting, value ops, literal placeholder first-input replacement, empty-does-not-restore, glossary preserve-only, temporary unwrap, bound refusal, lock union, and repeating-section `unsupported`. They do **not** cover layout boundary records, paint placeholder styling, React/Vue authoring, fixtures beyond inline XML, or full verification gates.

## 1. Typed nodes

- [ ] 1.1 Add `contentControl` and `contentControlContent` to the node-kind union in `ooxml-tree.ts` at block, inline, row, and cell level
- [ ] 1.2 Type `CT_SdtPr` in schema order; preserve unmodelled children as generic in position
- [ ] 1.2a Type `w:sdtEndPr` at every SDT level in schema position
- [ ] 1.3 Type `CT_SdtDropDownList`, `CT_SdtComboBox`, `CT_SdtDate`, `CT_SdtText`, `CT_DataBinding`, and `w14:checkbox` as a vendor extension; bound `w:listItem` to `MAX_SDT_LIST_ITEMS` (256)
- [ ] 1.4 Define an inline control's contribution to paragraph UTF-16 offsets so `TreeDocOp` addressing is total across it — **store slice landed** (`content-control-ops.test.ts`, 28-test suite)
- [ ] 1.5 Stable node identity independent of `w:id`; preserve `w:id` where present, never fabricate it
- [ ] 1.6 Serialize normalized in schema order; assert canonical-fingerprint equality over all seventeen fixture controls on an unedited round trip

## 2. Layout

- [ ] 2.1 Keep block flattening; extend `storyBlocks` to flatten inline controls into the run stream
- [ ] 2.2 Keep `MAX_SDT_NESTING` and apply one shared bound across block and inline paths
- [ ] 2.3 Emit a boundary record per control: identity, tag, alias, type, lock, placeholder state, and content geometry
- [ ] 2.4 Boundary records report both fragments when a control's content splits across pages
- [ ] 2.5 Assert page geometry is identical with and without a control wrapper around the same content

## 3. Placeholder state

- [ ] 3.1 Render `w:showingPlcHdr` content as placeholder, visually distinguished via `w:sdtPr/w:rPr`
- [x] 3.2 First input replaces the whole literal prompt and clears the flag in one transaction — store slice (`content-control-ops.test.ts`)
- [x] 3.3 Emptying after a literal-only replace leaves content empty and does not reassert `w:showingPlcHdr`; undo may restore through history — store slice (`content-control-ops.test.ts`)
- [ ] 3.4 Select the control as a unit rather than a partial range of prompt characters
- [x] 3.5 Preserve `w:placeholder/w:docPart` without reading the glossary part; no restore invented from the reference — store slice (`content-control-ops.test.ts`)
- [x] 3.6 Assert the saved file never carries `w:showingPlcHdr` over user-typed content — store slice (`content-control-ops.test.ts`)
- [x] 3.7 `w:temporary` controls self-remove on first successful content edit — store slice (`content-control-ops.test.ts`)

## 4. Lock enforcement

- [x] 4.1 Resolve `ST_Lock` — `sdtLocked`, `contentLocked`, `sdtContentLocked`, `unlocked` — per control with nested lock union across ancestors — store slice (`content-control-lock.test.ts`)
- [x] 4.2 Enforce in `tree-op-validate.ts`, refusing with `locked` and publishing no `ModelChange` — store slice (`content-control-lock.test.ts`)
- [x] 4.3 Refuse an operation whose range spans from unlocked content into a locked control, rather than applying it partially — store slice (`content-control-lock.test.ts`)
- [x] 4.4 Refuse content edits and value operations on a `w:dataBinding` control with `bound` — store slice (both test files in 28-test suite)
- [x] 4.5 Prove enforcement from a path that never touches the surface, so the claim is about the store and not the widget — store slice (`content-control-lock.test.ts`)
- [ ] 4.6 Surface the lock as a disabled control with the engine's own reason before the user types
- [ ] 4.7 Do not read or enforce `w:documentProtection/@w:edit="forms"` or section `w:formProt` — deferred

## 5. Value operations and the React surface

- [x] 5.1 Add set-content-control-value to `tree-ops.ts` with per-type internal validation; keep public `setContentControlValue: { value: string }` and map the string by control type — store slice (`content-control-ops.test.ts`)
- [x] 5.1a Refuse shipped `addRepeatingSectionItem` / `removeRepeatingSectionItem` with `unsupported` — store slice (`content-control-ops.test.ts`)
- [x] 5.1b Publish D12 impact classes per design S10 — store slice (`content-control-ops.test.ts`, temporary+placeholder case)
- [x] 5.2 Date operation writes `@w:fullDate` and formats content per `w:dateFormat` / `w:lid` in one transaction — store slice (`content-control-ops.test.ts`)
- [ ] 5.3 Widgets: dropdown menu, combo entry, date picker, checkbox toggle — each committing through the op, each honouring the lock, each with mousedown prevented
- [ ] 5.4 Form-fill navigation by `w:tabIndex` then document order, skipping locked controls. **Settle Tab-inside-a-table-cell against a Word comparison before implementing** — the binding is ambiguous and must not be decided by event ordering
- [ ] 5.5 Boundary chrome on caret entry and in show-all mode; never permanently painted, never selectable, contributing no layout records
- [ ] 5.5a Register `contentControl.showAll`, `contentControl.formFill`, `contentControl.inspector`, and `contentControl.remove` in `CHROME_GROUPS`
- [ ] 5.6 Inspector reporting tag, alias, type, lock (content-edit axis only), placeholder, and bound state
- [ ] 5.7 Remove-control action keeping content, disabled on `sdtLocked` / `sdtContentLocked`
- [ ] 5.8 Accessible roles, names, values, locked state, and placeholder-as-prompt
- [ ] 5.9 i18n keys, `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 5.10 `bun run api:extract`, `bun run check:parity`

## 6. Fixtures — the comprehensive file covers almost none of the correctness claims

- [ ] 6.1 Start from the locks that already exist — `block-sdt-comprehensive.docx`, `block-sdt-widgets.docx`, `block-sdt-showcase.docx`, and `inline-checkbox-controls.docx` all declare `w:lock w:val="sdtContentLocked"`. Author `sdt-locks.docx` only to cover the `ST_Lock` values those files lack (`sdtLocked`, `unlocked`) and the nesting case
- [ ] 6.2 Checkbox coverage already exists in two places — the comprehensive fixture's four inline `w14:checkbox` controls and `inline-checkbox-controls.docx` (10 occurrences). No new checkbox fixture is needed
- [ ] 6.3 `w:dataBinding` coverage already exists in the four fixtures named in 6.1; use them for preserve-and-refuse rather than authoring a new file
- [ ] 6.4 `sdt-placeholder-glossary.docx` — `w:placeholder/w:docPart` with a glossary part, to pin preserve-without-resolving
- [ ] 6.5 `sdt-row-cell.docx` — row-level and cell-level `w:sdt`; the comprehensive fixture has none
- [ ] 6.6 `sdt-nesting.docx` — nesting past the bound, to prove content survives and recursion stops
- [ ] 6.7 Keep the comprehensive fixture as the round-trip fixture. Its one tolerance case is prompts with `w:showingPlcHdr` and no `w:placeholder/w:docPart`. Its checkboxes are **not** a tolerance case — they are real `w14:checkbox` controls

## 7. Verification and honest scope

- [ ] 7.1 **Vue is explicitly deferred.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only in this change. Open the follow-up before claiming paired support; do not describe the lane as adapter-supported
- [ ] 7.2 Rewrite the content-controls entry in `deferred-features.md`; keep the entry
- [ ] 7.3 D9: canonical fingerprint over all seventeen fixture controls unedited; save/reopen semantic digest after a value edit, with every other control unchanged
- [ ] 7.4 Security: assert no fetch is issued on account of `w:dataBinding` metadata at load, layout, paint, or save
- [ ] 7.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-content-controls --strict`
- [ ] 7.6 Report any bypassed or still-failing gate as failing
- [ ] 7.7 `bun run format`

## 8. Explicitly out of scope

- [ ] 8.1 `w:dataBinding` resolution against a custom XML part — preserved and refused, not supported
- [ ] 8.2 The glossary document behind `w:placeholder/w:docPart`
- [ ] 8.3 `w15:repeatingSection` add/remove — shipped `addRepeatingSectionItem` / `removeRepeatingSectionItem` refuse with `unsupported` until a dedicated change lands
- [ ] 8.4 `w:docPartObj` gallery behaviour; the fixture's TOC control paints its cached field result, since non-page-number field instructions stay inert
- [ ] 8.5 Tracked value changes — owned by `typed-revisions-and-comments`
- [ ] 8.6 `w:documentProtection/@w:edit="forms"` and section `w:formProt` — deferred; only per-control `w:lock` is enforced

## 9. Review findings — decisions resolved

See `openspec/changes/word-fidelity-review-findings.md`.

- [x] 9.1 **Chrome slots chosen.** `contentControl.showAll`, `contentControl.formFill`, `contentControl.inspector`, `contentControl.remove` — design S14; insert-authoring deferred
- [x] 9.2 Reconcile with the shipped contract: `ContentControlSummary.locked` = content-edit locked; `setContentControlValue` stays `string` at public layer with internal per-type mapping; `addRepeatingSectionItem`/`removeRepeatingSectionItem` refuse `unsupported`; untyped/preserved types report as `richText` — design S12
- [x] 9.3 Type `w:sdtEndPr` at every SDT level — design S9, spec `content-control-model`
- [x] 9.4 `w:temporary` self-removes after first successful content edit — design S4b; store slice landed
- [x] 9.5 Placeholder grey italic comes from `w:sdtPr/w:rPr` — design S4 (paint/layout not yet verified; store transition landed)
- [x] 9.6 Nested lock union defined; `w:documentProtection`/`w:formProt` deferred — design S3
- [ ] 9.7 Own or defer `w:customXml` and `w:smartTag` — same content positions as `w:sdt`, same UTF-16 offset correctness argument (finding 2)
- [x] 9.8 D12 impact classes declared — design S10, spec `content-control-model`
- [ ] 9.9 Resolve `mc:AlternateContent` with `typed-drawings-and-images` — it also gates `mc:Ignorable`-declared `w14:checkbox` (finding 2.1)
- [x] 9.10 `MAX_SDT_LIST_ITEMS = 256` cap for dropdown/combo items — design S11, spec `content-control-model`
- [x] 9.11 `w:dataBinding` content and value edits refuse with `bound` — design S6, spec `content-control-model`

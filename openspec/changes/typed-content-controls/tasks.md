## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and record what each of the seventeen controls looks like today — specifically whether a placeholder prompt is indistinguishable from typed text
- [ ] 0.2 Confirm by experiment that typing beside a `w:showingPlcHdr` prompt appends rather than replaces, and that the saved file keeps the flag over the typed text. That is the defect this change is measured against
- [ ] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.4 Confirm with review that the D8 boundary expansion — control nodes, `CT_SdtPr`, type payloads — is accepted before typing any node

## Implementation evidence

Focused store tests cover inline offset accounting, value ops, literal placeholder first-input replacement, empty-does-not-restore, glossary preserve-only, temporary unwrap, bound refusal, lock union, and repeating-section `unsupported`. Additional branch coverage records canonical typing and round trips, layout boundaries and row/cell flattening, operation-reach lock and binding enforcement, forms protection, and automation writes. Paint placeholder styling, unit selection, and the remaining React/Vue authoring work stay open below.

## 1. Typed nodes

- [x] 1.1 Add `contentControl` and `contentControlContent` to the node-kind union in `ooxml-tree.ts` at block, inline, row, and cell level
- [x] 1.2 Type `CT_SdtPr` in schema order; preserve unmodelled children as generic in position
- [x] 1.2a Type `w:sdtEndPr` at every SDT level in schema position
- [ ] 1.3 Type `CT_SdtDropDownList`, `CT_SdtComboBox`, `CT_SdtDate`, `CT_SdtText`, `CT_DataBinding`, and `w14:checkbox` as a vendor extension; bound `w:listItem` to `MAX_SDT_LIST_ITEMS` (256)
- [x] 1.4 Define an inline control's contribution to paragraph UTF-16 offsets so `TreeDocOp` addressing is total across it
- [x] 1.5 Stable node identity independent of `w:id`; preserve `w:id` where present, never fabricate it
- [x] 1.6 Serialize normalized in schema order; assert canonical-fingerprint equality over all seventeen fixture controls on an unedited round trip

## 2. Layout

- [x] 2.1 Keep block flattening; extend `storyBlocks` to flatten inline controls into the run stream
- [x] 2.2 Keep `MAX_SDT_NESTING` and apply one shared bound across block and inline paths
- [x] 2.3 Emit a boundary record per control: identity, tag, alias, type, lock, placeholder state, and content geometry
- [x] 2.4 Boundary records report both fragments when a control's content splits across pages
- [x] 2.5 Assert page geometry is identical with and without a control wrapper around the same content
- [x] 2.6 Apply ONE bounded unwrap rule wherever a walk filters on rows or cells — table grid/cell passes, list resolution, story paragraph collection — so a `CT_SdtRow`/`CT_SdtCell` row or cell measures, paints, claims its grid, and stays addressable

## 3. Placeholder state

- [ ] 3.1 Render `w:showingPlcHdr` content as placeholder, visually distinguished via `w:sdtPr/w:rPr`
- [x] 3.2 First input replaces the whole literal prompt and clears the flag in one transaction
- [x] 3.3 Emptying after a literal-only replace leaves content empty and does not reassert `w:showingPlcHdr`; undo may restore through history
- [ ] 3.4 Select the control as a unit rather than a partial range of prompt characters
- [x] 3.5 Preserve `w:placeholder/w:docPart` without reading the glossary part; no restore is invented from the reference
- [x] 3.6 Assert the saved file never carries `w:showingPlcHdr` over user-typed content
- [x] 3.7 `w:temporary` controls self-remove on first successful content edit

## 4. Lock enforcement

- [x] 4.1 Resolve `ST_Lock` — `sdtLocked`, `contentLocked`, `sdtContentLocked`, `unlocked` — per control with nested lock union across ancestors
- [x] 4.2 Enforce in `tree-op-validate.ts`, refusing with `locked` and publishing no `ModelChange`
- [x] 4.3 Refuse an operation whose range spans from unlocked content into a locked control, rather than applying it partially — resolved against an inline control's own offset span, not only against a block control's ancestry
- [x] 4.4 Refuse content edits and value operations on a `w:dataBinding` control with `bound`
- [x] 4.7 Classify every `TreeDocOp` kind's reach exhaustively and fail closed for an unclassified one, so revision decisions, hyperlink writes and document-scoped writes meet the lock and forms protection instead of bypassing an op-name allowlist
- [x] 4.8 Refuse every content mutation targeting or intersecting a bound control with `bound`, not only the value write; allow wrapper removal, which takes the binding with it
- [x] 4.9 Own a control's LEADING edge and not its trailing one, matching where an insertion applied at a boundary offset actually lands, and let a caller name the control it writes into when the offset cannot say
- [x] 4.10 Keep a `w:lock` to content: page setup, section furniture and note numbering are the document's own properties and are not refused by a locked control, while forms protection still refuses them
- [x] 4.11 Resolve the forms-protection exemption from the range an operation addresses, so an unlocked INLINE field can be filled in while the paragraph holding it stays protected
- [x] 4.12 Validate a named insertion owner before resolving anything against it — a typed control, on the addressed paragraph's ancestor line, holding the addressed offset — and fail an unresolvable control reach closed, so a forged name cannot claim the forms-protection exemption
- [x] 4.13 Refuse a bound control's content for a value-reaching insertion in validation, not only in the value applier, so the insert-text command cannot desync a `w:dataBinding` control
- [x] 4.14 Resolve a positioned value write against the controls it would LAND in — the named control, its ancestors and any control nested inside it that receives the content — through the same rule the applier writes by, so naming an unlocked outer control cannot write into a locked or bound nested one
- [x] 4.15 Constrain a named insertion's offset by the span the control covers in the addressed paragraph for block and inline controls alike, and keep the offset walk and the run walk to one nesting bound
- [x] 4.16 Report the node a write with no run to join would MINT its run in — the addressed paragraph, or a named inline control's own content — from the same resolution the applier writes by, and resolve the lock, binding and forms rules against the controls holding it, so a nested control's empty paragraph is not a hole at either command location
- [x] 4.17 Resolve a write that REPLACES a control's whole content — a value write, and a removal that does not keep the content — against every control nested inside it, refusing `locked` for a nested lock that forbids the edit or the removal and `bound` for a nested `w:dataBinding`, while a removal that keeps the content and a metadata write reach nothing nested
- [x] 4.5 Prove enforcement from a path that never touches the surface, so the claim is about the store and not the widget
- [ ] 4.6 Surface the lock as a disabled control with the engine's own reason before the user types

## 5. Value operations and the React surface

- [x] 5.1 Add set-content-control-value to `tree-ops.ts` with per-type validation; keep public `setContentControlValue: { value: string }` and map the string by control type. Dropdown refuses a non-item with `invalidArgs`, combo accepts free entry, and an internal value of the wrong shape refuses with `typeMismatch`
- [x] 5.1a Refuse shipped `addRepeatingSectionItem` / `removeRepeatingSectionItem` with `unsupported`
- [x] 5.1b Publish D12 impact classes per design S10
- [x] 5.2 Date operation writes `@w:fullDate` and formats content per `w:dateFormat` / `w:lid` in one transaction
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
- [x] 6.2 Checkbox coverage already exists in two places — the comprehensive fixture's four inline `w14:checkbox` controls and `inline-checkbox-controls.docx` (10 occurrences). No new checkbox fixture is needed
- [x] 6.3 `w:dataBinding` coverage already exists in the four fixtures named in 6.1; use them for preserve-and-refuse rather than authoring a new file
- [ ] 6.4 `sdt-placeholder-glossary.docx` — `w:placeholder/w:docPart` with a glossary part, to pin preserve-without-resolving
- [ ] 6.5 `sdt-row-cell.docx` — row-level and cell-level `w:sdt`; the comprehensive fixture has none
- [ ] 6.6 `sdt-nesting.docx` — nesting past the bound, to prove content survives and recursion stops
- [ ] 6.7 Keep the comprehensive fixture as the round-trip fixture. Its one tolerance case is prompts with `w:showingPlcHdr` and no `w:placeholder/w:docPart`. Its checkboxes are **not** a tolerance case — they are real `w14:checkbox` controls

## 7. Verification and honest scope

- [ ] 7.1 **Vue is explicitly deferred.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only in this change. Open the follow-up before claiming paired support; do not describe the lane as adapter-supported
- [ ] 7.2 Rewrite the content-controls entry in `deferred-features.md`; keep the entry
- [x] 7.3 D9: canonical fingerprint over all seventeen fixture controls unedited; save/reopen semantic digest after a value edit, with every other control unchanged
- [x] 7.4 Security: assert no fetch is issued on account of `w:dataBinding` metadata at load, layout, paint, or save
- [x] 7.5 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-content-controls --strict`
- [x] 7.6 Report any bypassed or still-failing gate as failing
- [x] 7.7 `bun run format`

## 8. Explicitly out of scope

- [x] 8.1 `w:dataBinding` resolution against a custom XML part — preserved and refused, not supported
- [x] 8.2 The glossary document behind `w:placeholder/w:docPart`
- [x] 8.3 `w15:repeatingSection` add/remove — shipped `addRepeatingSectionItem` / `removeRepeatingSectionItem` refuse with `unsupported` until a dedicated change lands
- [x] 8.4 `w:docPartObj` gallery behaviour; the fixture's TOC control paints its cached field result, since non-page-number field instructions stay inert
- [x] 8.5 Tracked value changes — owned by `typed-revisions-and-comments`

## 9. Review findings — decisions resolved

See `openspec/changes/word-fidelity-review-findings.md`.

- [x] 9.1 **Chrome slots chosen.** `contentControl.showAll`, `contentControl.formFill`, `contentControl.inspector`, `contentControl.remove` — design S14; insert-authoring deferred
- [x] 9.2 Reconcile with the shipped contract: `ContentControlSummary.locked` = content-edit locked; `setContentControlValue` stays `string` at public layer with internal per-type mapping; `addRepeatingSectionItem`/`removeRepeatingSectionItem` refuse `unsupported`; untyped/preserved types report as `richText` — design S12
- [x] 9.3 Type `w:sdtEndPr` at every SDT level — design S9, spec `content-control-model`
- [x] 9.4 `w:temporary` self-removes after first successful content edit — design S4b; store slice landed
- [x] 9.5 Placeholder grey italic comes from `w:sdtPr/w:rPr` — design S4 (paint/layout not yet verified; store transition landed)
- [x] 9.6 Nested lock union and forms-protection reach are defined; `w:documentProtection/@w:edit="forms"` and section `w:formProt` use the same addressed-range rule — design S3
- [ ] 9.7 Own or defer `w:customXml` and `w:smartTag` — same content positions as `w:sdt`, same UTF-16 offset correctness argument (finding 2)
- [x] 9.8 D12 impact classes declared — design S10, spec `content-control-model`
- [ ] 9.9 Resolve `mc:AlternateContent` with `typed-drawings-and-images` — it also gates `mc:Ignorable`-declared `w14:checkbox` (finding 2.1)
- [x] 9.10 `MAX_SDT_LIST_ITEMS = 256` cap for dropdown/combo items — design S11, spec `content-control-model`
- [x] 9.11 `w:dataBinding` content and value edits refuse with `bound` — design S6, spec `content-control-model`

# Open items — the five OOXML feature-lane changes

`typed-notes-footnotes-endnotes`, `scoped-header-footer-editing`, `typed-content-controls`, `typed-revisions-and-comments`, and `typed-drawings-and-images` each close a lane in `deferred-features.md`. Every one passes `openspec validate --strict` and every factual claim in them was verified against the schemas in `reference/ecma-376/part1/schemas/`, the source under `packages/core/src/`, or the fixtures in `e2e/fixtures/`.

This file records what is **not** settled. Each item must be resolved before implementation starts on the change that owns it.

## 1. Contract reconciliation

All five changes describe new `TreeDocOp`s and new model shapes without reconciling against the already-`@public` surface in `packages/core/src/contracts/` and `packages/core/src/index.ts`. Every item below is API-Extractor-snapshotted. **No change may start until its row is settled and its semver consequence stated.**

| Shipped member | Conflict | Owner |
| --- | --- | --- |
| `Revision.date: string` (required) | `revision-model` requires "never fabricate a date"; `@w:date` is optional on `CT_TrackChange` | revisions |
| `Revision.part?: 'body'\|'footnote'\|'endnote'` | `revision-model` requires part be **required** and refuses an id without one; comments need header, footer, and comment parts too | revisions |
| `Revision.type: 'insert'\|'delete'\|'format'` | No move, no cell, no paragraph-mark kinds | revisions |
| `DocEdits.proposeInsertion` / `proposeDeletion` / `proposeReplacement` | Documented as *"tracked-ness is verb identity, not a boolean flag, so there is no global trackChanges toggle to forget"* — a direct rejection of the store-level suggesting mode this change introduces. **Two write vocabularies for one intent.** Settle as one decision | revisions |
| `DocComment` | No anchor, story, or orphan field; `review-surface` requires all three | revisions |
| `ContentControlSummary.locked?: boolean` | Design S3 argues against exactly this boolean collapse; `ST_Lock` has four values | content controls |
| `ContentControlType` | No member for an untyped control, `group`, `docPartObj`, `citation`, `bibliography`, `equation` | content controls |
| `DocEdits.setContentControlValue: { value: string }` | Per-type value shapes required (ISO date → `@w:fullDate`, checkbox toggle, dropdown item) | content controls |
| `DocEdits.addRepeatingSectionItem` / `removeRepeatingSectionItem` | Already shipped, while `typed-content-controls` §8.3 defers repeating sections to a later change | content controls |
| `EditorSnapshot.image.wrap` | `'inline'\|'square'\|'tight'\|'topAndBottom'\|'behind'\|'inFront'` is the right *user-facing* shape — `behind` and `inFront` correctly separate two states that share `wrapNone`. It lacks `through`, and lacks the square left/right distinction Word's menu offers | drawings |
| `Editor.getSelectedImage()` | Returns `{id, widthEmu, heightEmu}`; the properties dialog needs wrap, crop, alt text | drawings |
| `Editor.getHeaderFooterState()` | Returns `{editing, sectionIndex}`; the chrome needs variant, `rId`, and inherited | header/footer |
| `SectionProperties.footnote` / `.endnote` `{numFmt, numRestart, position, numStart}` | Already shipped; `typed-notes` describes note properties as new | notes |
| `EditorScope` `{ kind: 'note'; id }` and `{ kind: 'frame'; id }` | Already shipped and documented as open-ended. `typed-notes` invented a parallel `{noteKind, noteId}` shape — **use the shipped one** | notes |
| `Editor.getComments()` / `getTrackedChanges()` / `getWatermark()` / `query({type:'contentControlAt'})` | Ship as honest-empty stubs, which is the intended home for each change's read surface. **No change names the member it fills** | all five |

## 2. ECMA-376 gaps that produce wrong output, not missing output

1. **`mc:AlternateContent` is unhandled everywhere.** Word wraps shapes, text boxes, and `wp14` relative-sizing anchors in `mc:Choice`/`mc:Fallback`. It is Part 3 markup and appears in none of the Part 1 schemas. Under D1 the wrapper demotes to `generic`, so the anchor inside never types and never lays out — on the majority of real files. Needs an MC-preprocessing decision before any typing. *(drawings, content controls)*
2. **Paragraph-mark revisions are missing.** `CT_ParaRPr` opens with `EG_ParaRPrTrackChanges` — `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo` inside `w:pPr/w:rPr`. This is how Word records a paragraph split or merge. Accepting a deleted paragraph mark merges with the following paragraph. Without it, accept-all produces the wrong paragraph structure on any real tracked document. *(revisions — now in the proposal, still needs spec scenarios)*
3. **Row and cell revisions have types but no accept/reject.** `CT_TrPr` holds `w:ins`/`w:del`/`w:trPrChange`; `CT_TcPr` holds `w:cellIns`/`w:cellDel`/`w:cellMerge`. As written, accepting a tracked row deletion removes the `w:del` element and leaves the row. Silent table corruption. *(revisions)*
4. **Move pairing has no key.** `@w:name` on `CT_MoveBookmark` is the join between a `moveFrom` and its `moveTo`. The headline "a move is one decision" requirement never mentions it. *(revisions — now in the proposal)*
5. **The note mark and separator have no nodes.** `w:footnoteRef`, `w:endnoteRef`, `w:separator`, `w:continuationSeparator`, `w:annotationRef` are all `EG_RunInnerContent`, not note types. `typed-notes` requires the note's own mark be clickable and styled, and the document's separator be drawn, with nothing typed to hang either on. *(notes)*
6. **Fields are typed globally but owned locally.** `w:fldSimple` and `w:fldChar` live in `EG_PContent`/`EG_RunInnerContent` — body, notes, comments, SDT content. `header-footer-fields` scopes field atomicity to "while a header or footer scope is being edited", leaving a body `TOC`/`REF`/`SEQ` editable character-by-character, while `typed-content-controls` depends on that change for its TOC control. Also unowned: `CT_FldChar/w:ffData` — the legacy form fields (`checkBox`, `ddList`, `textInput`, `entryMacro`, `exitMacro`) that `w:formProt` protects and that carry a macro surface. *(header/footer)*

## 3. Cross-change ownership

- **Watermarks are nobody's.** `scoped-header-footer-editing` defers them to drawings; `typed-drawings-and-images` defers VML and says "assign an owner before either change merges". Meanwhile `Editor.getWatermark()` already ships. Assign before either merges.
- **`storyBlocks` story-root extension** is claimed by both `typed-notes` (note roots) and `typed-revisions-and-comments` (comment bodies), and `scoped-header-footer-editing` adds a third editable scope. Nothing defines scope precedence or nesting — a comment anchored in a note body inside a header is reachable. `EditorScope` and `setActiveScope` already exist; one change must land the shared shape.
- **`ST_NumberFormat`** (60+ values) drives both note numbering and `w:pgNumType/@w:fmt`. Two changes each require "displays `iv`" with no shared owner.
- **Neighbouring ledger lanes get half-closed silently.** `scoped-header-footer-editing` closes most of the fields lane and part of the sections lane; `typed-drawings-and-images` closes part of the hyperlinks lane. Each change rewrites only its own `deferred-features.md` entry, so after merge the ledger will describe fields, hyperlinks, and sections as untouched when they are half-implemented.
- **The four deferrals point at requirements that do not exist.** All four other changes defer tracked interactions to `typed-revisions-and-comments`, which never states what a tracked note insertion, a tracked control value change, or a tracked drawing deletion *is*. `w:sectPrChange` is the concrete case: it lives in `CT_SectPr`, owned by the header/footer change, and is typed by the revisions change with no accept/reject semantics.

## 4. Impact classes and D8 declarations

- `scoped-header-footer-editing` is the only change that never declares its D8 expansion, and it types the entire field vocabulary plus four section properties. Add the confirmation task and the design open question.
- `typed-revisions-and-comments` declares no D12 impact class for accept/reject, and specifies display-mode switching as re-running layout without publishing a `ModelChange` — but D12 keys change-scoped layout off `ModelChange` evidence. Nothing says how a non-`ModelChange` input invalidates the session.
- `typed-content-controls` declares no impact class at all; placeholder replacement, dropdown values, and date reformatting all change text length and can re-flow.
- `scoped-header-footer-editing` gives an impact class to lifecycle ops but not to story-content edits, which change flow height on every page of every section resolving to that part — that is `global`.

## 5. Adapter surface

- **`typed-content-controls` proposes no chrome slots at all**, while requiring an inspector, show-all-controls, form-fill navigation, and remove-control. Its own Impact section names `chrome-controls.ts`; its tasks do not. `DocxEditor.Toolbar` derives from `CHROME_GROUPS`, so none of them can render.
- **The `insert.*` group inverts the registry's taxonomy.** Every existing group is an object domain with insertion inside it (`image.insert`, `table.insert`); `insert.footnote` and `insert.pageNumber` invert that, and `CHROME_MENUS` already has a menu with id `insert`. Two changes invented the group independently. `ChromeSlotId` is public forever — decide once.
- **Value-typed slots do not generalize.** `commandForSlotValue` is hardcoded to `setMarkAttr`, and `ToolbarCommandState` has no `value`. `review.displayMode`, `review.editingMode`, and `image.wrap` all require rendering a current value. Extend the mechanism or these cannot be wired as slots.
- **The customization ladder is absent from all five.** Every UX requirement names a bespoke component; none mentions `className`/`data-active`, the `icon` prop, `asChild`, slot override, `hidden`/`preset={false}`, or the compound pattern.
- **Subscription discipline is unaddressed.** The review sidebar, control inspector, and header/footer chrome all report live per-caret or per-layout state with no mention of `useEditorState` selectors or reference stability. The natural implementation re-renders a 40-card sidebar on every keystroke.
- **Cross-cutting Word behaviour absent from all five**: copy/paste of these constructs, print/PDF resolution (including the viewport-materialization fallback), find-and-replace scope across note and comment bodies, zoom scaling of handles and overlays, RTL, undo across scopes, drag-and-drop image insert, and empty/error states.

## 6. What reviewed clean

The OOXML modelling within each element's own boundary, the D9 two-oracle discipline, the security posture (no zero-click fetch, bounds before allocation, text-content-not-markup), and the honest Vue-parity carve-outs all reviewed clean. Every source path named in the five Impact sections exists. All five pass `openspec validate --strict`.

The structural weakness is uniform: each change types the element it is named after thoroughly and stops where that element meets the rest of OOXML — and each was written against the schemas and the engine's internal lanes rather than against the public contract and the adapter surface it has to land on. Sections 2 through 6 are that gap.

## 7. Identifier allocation

A revision-id counter seeded from a clock produces values around 1.8e12 — thirteen digits. Word's revision ids are signed 32-bit, so those values overflow, and the exported file opens with a repair prompt. The document is unusable in the application it was written for, and the symptom appears only on export.

**The schema will not catch this.** `CT_Markup/@w:id` is `ST_DecimalNumber`, a restriction of `xsd:integer` with no bounds at all. A validator passes the file; Word rejects it. Any conformance test that relies on schema validation to police an identifier is testing nothing.

Every identifier space this repository writes now carries an explicit requirement: seed from the document's existing maximum, clamp to the consuming application's range, never derive from a clock, timestamp, random source, or hash, and fail with `invalidArgs` on exhaustion rather than wrapping.

| Identifier | Schema type | Real bound |
| --- | --- | --- |
| Revision `w:id` (`CT_Markup`) | `ST_DecimalNumber` = `xsd:integer`, unbounded | Word: signed 32-bit |
| Comment `w:id` | same | Word: signed 32-bit |
| Note `w:id` (`CT_FtnEdn`) | same | Word: signed 32-bit; `-1` and `0` reserved for the separators |
| Content control `w:id` | `CT_DecimalNumber/@w:val` | Word: signed 32-bit; optional, never fabricate |
| `wp:docPr/@id` | `ST_DrawingElementId` = `xsd:unsignedInt` | Word: unique per document, non-zero |
| `w14:paraId` | `ST_LongHexNumber` = `xsd:hexBinary` length 4 | exactly 8 hex digits, not `00000000` |

The current `packages/core/src` has no clock-seeded identifier — the only `Date.now()` is a performance timer fallback in `paginated-surface.ts`. The requirements exist so the regression cannot return through the new allocators these five changes introduce.

## 8. Revision identity

`@w:id` on `CT_Markup` carries no uniqueness constraint and no author scoping. Two consequences:

- Two authors' revisions may legally share an id in one part, so addressing by `(part, id)` merges distinct revisions.
- One logical revision is deliberately many elements sharing one id — a tracked row insertion writes `w:trPr/w:ins` on the row and `w:cellIns` on every cell — so a uniqueness rule cannot express the most common structural revision at all.

`revision-model` therefore identifies a revision by the `(id, author, date)` triple resolved within a named part, and accept/reject resolves every site carrying that triple in one transaction and one undo step.

## 9. Sizing

Each of the five carries 16–21 requirements, 65–89 scenarios, and 63–85 tasks — a program of work rather than a single landable change.

The ratio is the sharper problem: roughly four scenarios per requirement. That is over-specified in scenarios and under-specified in requirements, and several scenarios here are requirements wearing a scenario's clothes, which makes them hard to review and hard to mark done. Each change should be split along its existing capability seams so a model change can land before its surface.

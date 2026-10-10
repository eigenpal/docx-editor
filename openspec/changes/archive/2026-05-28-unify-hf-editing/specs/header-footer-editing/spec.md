## ADDED Requirements

### Requirement: Single visible renderer for header and footer content

The system SHALL render header and footer content through the painter (`renderHeaderFooterContent`) in both edit and non-edit modes. There SHALL NOT be a second visible ProseMirror EditorView that replaces the painted header or footer region while the user is editing.

#### Scenario: Non-edit display

- **WHEN** a document with a header is opened and the user is not editing the header
- **THEN** the visible header DOM is the painter's `.layout-page-header` subtree built from `renderHeaderFooterContent`
- **AND** no ProseMirror EditorView mounted by `InlineHeaderFooterEditor` is visible on screen

#### Scenario: Edit mode display

- **WHEN** the user double-clicks the header to enter edit mode
- **THEN** the visible header DOM remains the painter's `.layout-page-header` subtree
- **AND** the inline editor's PM EditorView (if it exists for state management) is positioned off-screen at `left: -9999px`
- **AND** there is no CSS rule that hides the painted `.layout-page-header > *` children

#### Scenario: Geometry parity across modes on the #468 fixture

- **WHEN** `DC_Template_Descricao_Cargo_Controlado_Enterprise.docx` is loaded and a screenshot of the header is taken in non-edit mode
- **AND** the user enters edit mode and a screenshot of the header is taken
- **THEN** the two screenshots have identical column widths, row heights, cell padding, and text positions within the header region
- **AND** the only allowed visual differences are the inline editor's UI chrome (dotted border, "Header" / "Options" labels, and the dim-body overlay)

### Requirement: Persistent hidden HF ProseMirror EditorView per distinct part

The system SHALL maintain one persistent hidden ProseMirror EditorView per distinct header/footer part in the loaded document, keyed by `rId`. The set of parts is enumerated as `Document.package.headers ∪ Document.package.footers` — i.e., every entry in those two `Map<string /* rId */, HeaderFooter>` maps. EditorViews SHALL be mounted to off-screen DOM (`left: -9999px`) for the lifetime of the document, not on-demand per double-click. The `(hdrFtrType, kind)` tuple SHALL NOT be the slot key: two sections with `default`-type headers pointing to different `rId`s require two EditorViews; two sections sharing one `rId` require one.

#### Scenario: Part enumeration on document load

- **WHEN** a document is loaded with three distinct HF parts (e.g., a default header `rId4`, a first-page header `rId5`, a default footer `rId6`)
- **THEN** the system mounts exactly three hidden HF EditorViews, one per `rId`
- **AND** an entry in `Document.package.headers` keyed by `rId4` resolves to the same EditorView regardless of which section painted instance is being viewed

#### Scenario: Persistence across double-click

- **WHEN** the user double-clicks the header (enters edit mode), then clicks back into the body (exits edit mode), then double-clicks the header again
- **THEN** the same EditorView instance handles both edit sessions
- **AND** undo history persists across the click-out / click-in cycle

#### Scenario: Cross-section header shared by rId

- **WHEN** a document has multiple sections referencing the same header via the same `rId`
- **THEN** the system mounts one EditorView for that `rId`, not one per section
- **AND** edits made when focused on one section's painted instance appear in every other section's painted instance within one layout pass

#### Scenario: Sections with same hdrFtrType but distinct rIds

- **WHEN** a document has two sections, each with a `default`-type header reference, but pointing to different `rId`s
- **THEN** the system mounts two distinct EditorViews, one per `rId`
- **AND** edits in section 1's default header do not appear in section 2's default header

#### Scenario: evenAndOddHeaders setting does not gate PM mounting

- **WHEN** a document has `w:evenAndOddHeaders=false` in `word/settings.xml` but `package.headers` contains an `even`-type part referenced by some `rId`
- **THEN** an EditorView for that `rId` is mounted
- **AND** the painter does not consult that EditorView at paint time (the setting controls painter consultation, not PM mounting)

#### Scenario: Runtime materialization of a new HF part

- **WHEN** the user triggers creation of a new HF part at runtime (e.g., toggling "Different first page" materializes a new first-page header with a new `rId`)
- **THEN** a hidden PM EditorView for the new `rId` is mounted lazily
- **AND** the new EditorView persists for the remainder of the session

#### Scenario: Section break insertion reuses inherited rIds

- **WHEN** the user inserts a section break in the body that produces a new section without explicit `headerReference` elements
- **THEN** the new section's painted HF reuses the parent section's HF PM EditorViews via inherited `rId`s (§17.10.1 continuation rule)
- **AND** no new EditorViews are mounted

#### Scenario: Storage model unchanged on document open

- **WHEN** a document is opened
- **THEN** `Document.package.headers` and `.footers` (`Map<string /* rId */, HeaderFooter>` declared at `packages/core/src/types/document.ts:192-195`) remain populated identically to today's behavior — the PM projection does not replace or mutate the Document model on load

### Requirement: PM projection synced to Document model

Each hidden HF EditorView SHALL be initialized from its corresponding `Document.package.headers[rId].content` (or `.footers[rId].content`) via `headerFooterToProseDoc`. On every PM transaction that mutates the document, the projection SHALL be serialized back via `proseDocToBlocks` and written into `Document.package.headers[rId].content` (or `.footers[rId].content`). The Document model SHALL remain source-of-truth for storage and round-trip serialization.

#### Scenario: Edit propagates to Document

- **WHEN** the user types "Updated" into the header
- **THEN** the corresponding `Document.package.headers[rId].content` reflects the typed text
- **AND** saving the document via `serializer` emits the typed text into the right `word/header*.xml` part

#### Scenario: Edit does not mutate unrelated HF parts

- **WHEN** the user edits the default header (some `rId4`)
- **THEN** `Document.package.headers[rId_first]` and `package.footers[rId_default]` are not mutated
- **AND** their corresponding XML parts on save are byte-identical to load (modulo unrelated normalization)

#### Scenario: PM projection does not fork rId-shared headers

- **WHEN** two sections share a header by `rId` and the user edits it from section 1's painted instance
- **THEN** the change is reflected in `Document.package.headers[rId].content` once, not twice
- **AND** on save, only one `word/header*.xml` part is emitted for the shared `rId`

#### Scenario: Image dragged from body into header gets the right relationship part

- **WHEN** the user inserts (paste, drop, or move) an image into a header
- **THEN** on save, the image's relationship is emitted into `word/_rels/headerN.xml.rels` for the part owning that `rId`
- **AND** the image's relationship is not emitted into `word/_rels/document.xml.rels`

### Requirement: Painter consumes HF PM document directly

The painter pipeline (`convertHeaderFooterToContent` in `packages/core/src/flow-model/headerFooterLayout.ts`) SHALL accept either the retired `HeaderFooter.content` array or the current PM document of the corresponding HF EditorView, and prefer the PM document when one exists for that slot.

#### Scenario: PM-driven paint after edit

- **WHEN** the user edits a header and a layout pass runs
- **THEN** `convertHeaderFooterToContent` reads from the HF EditorView's `state.doc` and feeds it to `buildBoxTree` → `measureBlocks` → `renderHeaderFooterContent`
- **AND** the painted header reflects the edited content within one layout pass

#### Scenario: Per-page reflow preserved

- **WHEN** a document with a `PAGE` field in the header is rendered across multiple pages
- **THEN** each painted instance of the header resolves the `PAGE` field to that page's number
- **AND** the underlying PM document holds one logical instance of the header content, not one per page

### Requirement: Click in painted HF routes to HF PM

When the user clicks (or double-clicks) inside the painted `.layout-page-header` or `.layout-page-footer` region, the system SHALL translate the click coordinates to a position inside the matching HF EditorView's document and set that view's selection to the resolved position. The body EditorView SHALL lose focus and the HF EditorView SHALL gain focus.

#### Scenario: Caret placement in cell text

- **WHEN** the user clicks on the text "DESCRIÇÃO" inside a header table cell
- **THEN** the HF EditorView's selection is positioned at or near the clicked character index inside that cell's text run
- **AND** the HF EditorView holds native browser focus

#### Scenario: Body click while editing HF

- **WHEN** the user is editing the header and clicks on a body paragraph
- **THEN** the body EditorView regains focus
- **AND** the HF EditorView loses focus
- **AND** the dim-body overlay and "Header" / "Options" affordances disappear

#### Scenario: Click in footer when editing header

- **WHEN** the user is editing the default header and clicks inside the painted footer
- **THEN** focus moves from the header PM to the footer PM
- **AND** the dim-body affordance updates to "Footer"

#### Scenario: Click in header that does not exist

- **WHEN** the user clicks in the header region of a document that has no header for that section/type
- **THEN** the existing materialization flow runs (create empty `HeaderFooter`, mount a new persistent PM for that slot, focus it)

### Requirement: Selection overlay draws HF carets and selections

A selection overlay SHALL draw the caret and selection rectangles for the currently focused HF EditorView inside the painted `.layout-page-header` or `.layout-page-footer` region, using the painter's existing `data-doc-from` and `data-doc-to` markers on cell content for position mapping. Only the focused EditorView's selection SHALL render an overlay at any given time.

#### Scenario: Caret visible in HF cell

- **WHEN** the HF EditorView is focused with an empty selection at position N inside a cell paragraph
- **THEN** a caret element is rendered inside the painted cell at the visual position corresponding to PM position N

#### Scenario: Range selection across cells

- **WHEN** the user selects text spanning two cells in a header table
- **THEN** selection rectangles are drawn for both selected cell ranges in the painted header
- **AND** no selection rectangles are drawn in the body region

#### Scenario: Overlay clears on focus change

- **WHEN** the focused EditorView changes from header to body
- **THEN** the HF selection overlay is removed from the painted header
- **AND** the body's existing selection overlay renders as normal

### Requirement: Toolbar commands route to focused EditorView

Toolbar commands (bold, italic, font, alignment, undo, redo, etc.) SHALL be dispatched to whichever EditorView currently holds focus. There SHALL NOT be a separate "is editing HF" boolean that determines the routing — focus alone determines the active editor.

#### Scenario: Bold toolbar button in header

- **WHEN** the user is editing the header and clicks the Bold button
- **THEN** the bold mark is applied to the HF EditorView's selection
- **AND** the body EditorView is unaffected

#### Scenario: Undo in header is independent of body

- **WHEN** the user edits the body, then edits the header, then presses Ctrl/Cmd+Z while focused on the header
- **THEN** only the most recent header edit is undone
- **AND** the body edit remains in its modified state
- **AND** the body's undo stack is unchanged

#### Scenario: Switching focus updates toolbar state

- **WHEN** focus moves from a non-bold body paragraph to a bold header cell
- **THEN** the Bold toolbar button reflects the active mark of the header selection (showing "pressed")

### Requirement: Removal of `.hf-editor-pm` CSS patches

The CSS rules under selectors `.hf-editor-pm`, `.paged-editor--editing-header .layout-page-header > *`, and `.paged-editor--editing-footer .layout-page-footer > *` SHALL be removed from `packages/core/src/prosemirror/editor.css` and `packages/react/src/styles/editor.css`. UI-chrome rules (dotted border, separator bar styling, dim-body overlay) SHALL be preserved under different selectors that key on focused-PM state rather than on the overlay's class.

#### Scenario: No font-strut hacks in shipped CSS

- **WHEN** the change is merged
- **THEN** `grep -n "font-size: 0 !important" packages/core/src/prosemirror/editor.css packages/react/src/styles/editor.css` returns nothing
- **AND** `grep -n "top: 0.4em" packages/core/src/prosemirror/editor.css packages/react/src/styles/editor.css` returns nothing

#### Scenario: No visibility:hidden on painted HF

- **WHEN** the change is merged and the user enters HF edit mode
- **THEN** `computed-style(visibility)` on any element inside `.layout-page-header` is not `hidden` (the painter remains visible during edit)

#### Scenario: UI chrome preserved

- **WHEN** the user enters HF edit mode
- **THEN** the dotted blue border on the active header is visible
- **AND** the "Header" / "Options" labels are visible at the bottom of the painted header area
- **AND** the body content is dimmed (opacity reduced) to indicate focus is in HF

### Requirement: React and Vue adapter parity

The unified HF editing model SHALL be implemented in both the React adapter (`packages/react/`) and the Vue adapter (`packages/vue/`). Platform-agnostic logic (HF projection sync, slot-scoped DOM-to-PM-position helpers) SHALL live in `packages/core/`. The parity contract check (`bun run check:parity-contract`) SHALL pass on the merged change.

#### Scenario: Both adapters use the painter for HF display

- **WHEN** the change is merged
- **THEN** both the React `PagedEditor` and the Vue `useDocxEditor` composable render header/footer content through the painter pipeline
- **AND** neither adapter mounts a visible PM EditorView for HF in edit mode

#### Scenario: Parity contract passes

- **WHEN** the change is merged
- **THEN** `bun run check:parity-contract` exits 0

### Requirement: Behavioral parity with current HF capabilities

The unified editing model SHALL preserve all existing header/footer capabilities: page-number field resolution, `titlePg` first-page header swap, image insertion and resize, floating image and table positioning, multi-section header references, header creation and removal, and round-trip serialization.

#### Scenario: Existing HF playwright specs pass

- **WHEN** the change is merged
- **THEN** `titlePg-header-footer.spec.ts`, `footer-page-number.spec.ts`, `sdt-header-content.spec.ts`, `hf-trailing-rule.spec.ts`, and `hf-toolbar-and-zindex.spec.ts` all pass without modification

#### Scenario: PAGE field resolves per page

- **WHEN** a document with `<w:fldChar>` PAGE in the header is rendered across three pages
- **THEN** the painted headers show "1", "2", and "3" respectively
- **AND** the HF PM document contains the field instruction unchanged

#### Scenario: titlePg first-page header

- **WHEN** a document has `<w:titlePg/>` and a first-page header distinct from the default header
- **THEN** page 1 shows the first-page header content
- **AND** pages 2 onward show the default header content
- **AND** each is its own persistent HF EditorView

#### Scenario: Save round-trip

- **WHEN** the user opens, edits the header, and saves a document
- **THEN** the saved DOCX, when re-opened, contains the edited header content
- **AND** image relationship parts for the header continue to live in `word/_rels/header*.xml.rels`, not `word/_rels/document.xml.rels`

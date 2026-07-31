## ADDED Requirements

### Requirement: Browser-first paragraph feedback checkpoint
Before comprehensive semantic pagination or paired-adapter conformance, the existing React `DocxEditor` SHALL expose a private visible ProseMirror `contenteditable` paragraph demo. The checkpoint SHALL support browser-native click, drag, arrow, Shift-arrow, and select-all selection; writing and selected-text replacement; Backspace and Delete across run boundaries; Enter paragraph split; Backspace paragraph join; repository-specified Word-like formatting and editing keymaps; and normalized save/reopen through `EditorBinding → DocOp → DocumentStore`.

#### Scenario: User evaluates paragraph interaction
- **WHEN** the browser-first React demo passes one focused browser smoke flow
- **THEN** implementation pauses for hands-on user feedback before comprehensive property matrices or semantic paginated output proceed

#### Scenario: Demo interaction remains non-canonical
- **WHEN** visible ProseMirror handles native browser selection and key input
- **THEN** `DocumentStore` remains authored authority and save reads the committed store rather than ProseMirror

### Requirement: Private React vertical-slice acceptance
Before production parity, the system SHALL prove paragraph load, edit, formatting, layout, pagination, semantic interaction, normalized save, and reopen through a private React acceptance harness that creates no public support claim.

#### Scenario: Private paragraph fixture passes
- **WHEN** the private React harness edits and formats a paragraph spanning page fragments and saves it
- **THEN** semantic assertions, rendered output, canonical tree fingerprint, and reopened semantic digest agree at the committed revision

### Requirement: Fixed paragraph property boundary
The paragraph acceptance fixture SHALL cover run font family, half-point size, color, bold, italic, underline variant/color, strike/double-strike, highlight, vertical alignment/baseline, caps/small-caps, character spacing, horizontal scaling, and kerning. It SHALL cover paragraph style, alignment, spacing (including `w:spacing` before/after), line spacing/rule, left/right/first-line/hanging indents, tabs, numbering identity/level, keep-next, keep-lines, widow control, page-break-before, shading, and `w:pBdr/w:bottom` only. Inline text, authored whitespace, tab, line hard break, and typed `w:br w:type="page"` page-break content SHALL be editable with normalized save/reopen. Section-aware pagination fixtures SHALL exercise per-section geometry/margins, default/`nextPage` breaks, `titlePage`, and per-section read-only header/footer inheritance. Non-bottom `w:pBdr` edges, `continuous`/`evenPage`/`oddPage` section semantics, multi-column flow, section insertion UI, and product command wiring remain deferred and SHALL NOT upgrade public support claims until paired acceptance passes.

#### Scenario: Complete accepted property fixture
- **WHEN** the private React and paired adapter fixtures exercise the paragraph slice
- **THEN** every accepted run property, paragraph property, inline page-break token, section-pagination case, and content token has load, semantic model, layout, edit where applicable, normalized save, and reopen assertions

#### Scenario: Deferred inline feature is present
- **WHEN** a paragraph also contains a hyperlink, field, comment, tracked change, image, table, content control, header/footer reference, or note reference
- **THEN** that feature follows its declared preservation status and is excluded from paragraph support claims

### Requirement: Paired production adapter behavior
Production acceptance SHALL require React and Vue to host the same engine-owned paragraph editor behavior through thin adapter boundaries.

#### Scenario: Paired interaction suite runs
- **WHEN** the production paragraph slice is exercised through React and Vue
- **THEN** both adapters produce equivalent semantic edits, layout records, interaction results, and normalized saved content

### Requirement: Parity and public contract gates
The production gate SHALL pass repository parity, API snapshot, public docs-surface, adapter CSS, and i18n checks before supported behavior is advertised.

#### Scenario: Private proof passes before parity
- **WHEN** the React private harness passes but any paired or public contract check fails
- **THEN** the paragraph slice remains private and no public support matrix is upgraded

### Requirement: Honest baseline reporting
Verification SHALL compare with the current run recorded in `baseline.md`, distinguish known infrastructure failures from regressions, and never describe a failing baseline as clean.

#### Scenario: Verification is reported
- **WHEN** a later test run is compared with the baseline
- **THEN** the report lists both pre-existing failures and any new failures and does not convert failed checks into passing claims

### Requirement: Deferred feature inventory
The change SHALL inventory non-paragraph features with separate parse/model/layout/edit/save status and SHALL NOT infer semantic support from generic-tree preservation.

#### Scenario: Unsupported table is loaded
- **WHEN** a document contains a table outside the accepted paragraph boundary
- **THEN** the inventory identifies its limited parse, layout, and edit status without claiming complete structural editing or Word-fidelity layout

### Requirement: Deferred lanes remain gated
Hyperlinks, tables, drawings/images, headers/footers, footnotes/endnotes, fields, content controls, tracked changes, comments, collaboration/replicated undo, deterministic PDF/print/export, and server rendering/language bindings MUST remain deferred until separately specified and accepted. Each lane SHALL have separate parse, model, layout, edit, and save statuses plus a named future gate.

#### Scenario: Deferred feature appears in fixture
- **WHEN** an acceptance fixture contains a deferred feature
- **THEN** the test asserts its declared preservation or rejection behavior and excludes it from paragraph-slice support claims

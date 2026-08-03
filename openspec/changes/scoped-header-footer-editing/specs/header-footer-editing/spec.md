## MODIFIED Requirements

### Requirement: Single visible renderer for header and footer content

The system SHALL render header and footer content through the semantic paint pipeline in both edit and non-edit modes. There SHALL NOT be a hidden ProseMirror `EditorView` per header/footer part, and there SHALL NOT be a second visible renderer that replaces the painted region while the user is editing.

#### Scenario: Non-edit display

- **WHEN** a document with a header is opened and the user is not editing the header
- **THEN** the visible header DOM is the painted page-furniture subtree carrying `[data-docx-hf]`
- **AND** no off-screen or hidden ProseMirror surface exists for that part

#### Scenario: Edit mode display

- **WHEN** the user opens a header or footer editing scope
- **THEN** the visible header or footer DOM remains the same painted subtree
- **AND** the engine caret and selection overlay render inside that subtree
- **AND** no CSS rule hides painted furniture children during edit

### Requirement: Editing is scoped semantic surface authority, not a parallel PM stack

Header and footer stories SHALL be edited through the same semantic editing path as the body. Entering a scope SHALL bind `EditorScope { kind: 'headerFooter'; rId }` (or the equivalent view scope the engine publishes) and route mutations through `TreeDocOp`s on the canonical tree. The system SHALL NOT maintain a persistent hidden ProseMirror `EditorView` per `rId`, SHALL NOT project PM transactions into a parallel `Document.package.headers` / `.footers` map, and SHALL NOT use focus on a hidden PM view to decide toolbar routing.

#### Scenario: One part shared across sections uses one canonical story

- **WHEN** multiple sections reference the same header `rId`
- **THEN** the store holds one header part for that `rId`
- **AND** one edit in an open scope updates every page that resolves to that part in one transaction

#### Scenario: Distinct parts stay distinct

- **WHEN** two sections each declare a `default` header with different `rId`s
- **THEN** edits in one scope do not mutate the other part

#### Scenario: Undo is semantic history, not per-PM-stack

- **WHEN** the user edits a header, leaves the scope, and presses undo
- **THEN** the header edit is undone through the same semantic history as body edits
- **AND** no separate ProseMirror undo stack exists for page furniture

### Requirement: Click and keyboard input route through the scoped surface

When a header or footer scope is open, pointer and keyboard input inside the painted furniture region SHALL resolve to canonical positions in that story and commit through the store. When no furniture scope is open, furniture SHALL remain `contenteditable=false`, carry `[data-docx-hf]`, and be excluded from selection — the body drag-select guarantee is unchanged.

#### Scenario: Double-click enters scope on the resolved part

- **WHEN** the user double-clicks the painted header on page 5
- **THEN** the scope opens on the part that page resolves to, with the caret at the clicked position

#### Scenario: Body click while editing furniture leaves scope

- **WHEN** the user is editing a header and clicks a body paragraph
- **THEN** the furniture scope closes, body scope is restored, and the prior body selection is restored where possible

#### Scenario: Furniture is inert outside scope

- **WHEN** the user drags a selection through the body across a page boundary and no furniture scope is open
- **THEN** header and footer text is not selected

### Requirement: Toolbar commands route through active scope

Toolbar commands SHALL be dispatched against the active `EditorScope`. A command enabled in an open header scope SHALL apply to that story with the same semantics it would have on equivalent body content. There SHALL NOT be a separate "is editing HF" boolean that determines routing.

#### Scenario: Bold in an open header scope

- **WHEN** the user invokes bold with a header scope open and a non-empty selection
- **THEN** the mark applies to the header story
- **AND** the body is unaffected

#### Scenario: Page-number insert is scope-gated

- **WHEN** focus is not in a header or footer scope
- **THEN** `insert.pageNumber` and `insert.pageXofY` are disabled with the engine's reason

### Requirement: React adapter lands first; Vue follows

The scoped header/footer authoring chrome SHALL ship in the React adapter only for this change. Vue SHALL keep disabled furniture slots and SHALL NOT grow a parallel header/footer chrome implementation here.

#### Scenario: No Vue support claim

- **WHEN** this change merges without a paired Vue implementation
- **THEN** `paragraph-adapter-acceptance` does not treat headers/footers as a supported editing lane
- **AND** documentation describes React-only furniture authoring until the follow-up lands

### Requirement: Behavioral parity with read-only furniture capabilities

The scoped editing model SHALL preserve the read-only furniture capabilities that already ship: per-section resolution and inheritance, section-relative `w:titlePg`, document-relative odd/even selection, flow-height box sizing, tall-header push-down, and layout-time `PAGE` / `NUMPAGES` evaluation keyed by the attaching page.

#### Scenario: PAGE resolves per page while scope is closed

- **WHEN** a document with a `PAGE` field in the footer is rendered across three pages
- **THEN** the painted footers show "1", "2", and "3" respectively
- **AND** the saved part still contains the field instruction unchanged

#### Scenario: PAGE stays correct while scope is open

- **WHEN** the user opens the footer scope on page 7 beside a `PAGE` field
- **THEN** the field continues to show 7 for that page

#### Scenario: Save round-trip through canonical tree

- **WHEN** the user opens, edits a header, and saves
- **THEN** the saved DOCX reopens with the edited header content in the correct `word/header*.xml` part

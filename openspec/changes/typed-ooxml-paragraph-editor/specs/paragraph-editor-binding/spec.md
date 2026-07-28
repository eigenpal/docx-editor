## ADDED Requirements

### Requirement: ProseMirror paragraph projection
`EditorBinding` SHALL project supported paragraph content and formatting from a committed canonical revision into ProseMirror without exposing ProseMirror types to the semantic store, layout, output, or public editor host.

#### Scenario: Projection is initialized
- **WHEN** an editor opens a committed document containing supported paragraphs
- **THEN** ProseMirror content represents those paragraphs while the canonical tree remains the authored authority

### Requirement: Transaction-to-DocOp mapping
`EditorBinding` SHALL map complete supported ProseMirror transactions into typed `DocOp`s using transaction step mappings, stable semantic identities, and selection evidence.

#### Scenario: Text transaction commits
- **WHEN** a user inserts text into a projected paragraph
- **THEN** the binding commits the corresponding semantic operation before reconciling the view from its `ModelChange`

#### Scenario: Unsupported transaction is rejected
- **WHEN** a transaction contains a step with no supported semantic mapping
- **THEN** no canonical mutation occurs and the projection is restored to committed state with a diagnostic result

### Requirement: Reconciliation loop prevention
Canonical-to-ProseMirror reconciliation SHALL use a distinct projection origin that cannot generate new authored `DocOp`s.

#### Scenario: External semantic edit arrives
- **WHEN** a committed `ModelChange` updates a projected paragraph
- **THEN** the view reconciles once without a feedback mutation or duplicate history entry

### Requirement: Canonical semantic history
Undo and redo SHALL operate through semantic store history and committed revisions. Each accepted user intent SHALL create one semantic history entry: one supported ProseMirror transaction, one complete IME composition, or one toolbar/command invocation. Projection reconciliation SHALL create no entry. The ProseMirror history plugin, old PM-owned history path, and time-based PM grouping MUST NOT be canonical authority.

#### Scenario: Undo paragraph edit
- **WHEN** the user undoes a committed paragraph insertion
- **THEN** a semantic operation changes the canonical tree and the ProseMirror projection follows that commit

#### Scenario: One transaction is atomic history
- **WHEN** one accepted ProseMirror transaction maps to multiple `DocOp`s
- **THEN** all operations commit atomically as one semantic history entry

#### Scenario: IME composition spans transactions
- **WHEN** ProseMirror emits multiple transactions between `compositionstart` and `compositionend`
- **THEN** the accepted composition commits as one semantic history entry

#### Scenario: Toolbar command is one intent
- **WHEN** one toolbar or command invocation changes multiple accepted properties
- **THEN** the changes commit atomically as one semantic history entry

#### Scenario: Projection reconciliation has no history
- **WHEN** the binding reconciles ProseMirror from a committed `ModelChange`
- **THEN** no semantic history entry is created

#### Scenario: Consecutive typing remains separate
- **WHEN** ordinary typing produces consecutive accepted ProseMirror transactions outside composition
- **THEN** the transactions may remain separate semantic history entries without time-based PM grouping

### Requirement: Projection excluded from save and layout
Save and layout code MUST NOT consume `EditorState`, `EditorView`, ProseMirror document content, or mounted DOM as document input.

#### Scenario: Editor view is absent
- **WHEN** a committed paragraph document is saved or laid out without mounting ProseMirror
- **THEN** the result is produced from the same canonical tree used by an interactive editor

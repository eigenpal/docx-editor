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

#### Scenario: Native deletion commits

- **WHEN** a user presses Backspace or Delete at a caret or over a browser-native selection
- **THEN** the binding commits precise semantic deletion operations, including supported run-boundary deletion and paragraph join

#### Scenario: Word-like keymap command commits

- **WHEN** a repository-specified ProseMirror keymap handles Enter, Backspace, Delete, Mod-B/I/U, or select-all
- **THEN** the command uses the current projection and commits authored effects only through typed `DocOp`s

#### Scenario: Unsupported transaction is rejected

- **WHEN** a transaction contains a step with no supported semantic mapping
- **THEN** no canonical mutation occurs and the projection is restored to committed state with a diagnostic result

### Requirement: Reconciliation loop prevention

Canonical-to-ProseMirror reconciliation SHALL use a distinct projection origin that cannot generate new authored `DocOp`s.

#### Scenario: External semantic edit arrives

- **WHEN** a committed `ModelChange` updates a projected paragraph
- **THEN** the view reconciles once without a feedback mutation or duplicate history entry

### Requirement: Canonical semantic history

Undo and redo SHALL operate through semantic store history and committed revisions. Each accepted user intent SHALL create one semantic history entry: one supported ProseMirror transaction, one complete IME composition, or one toolbar/command invocation. Projection reconciliation SHALL create no entry. The ProseMirror history plugin and time-based PM grouping MUST NOT be canonical authority.

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

### Requirement: Table commands are tree-authoritative

Table structural edits, column resize commits, and selected-cell border/fill commands SHALL plan and execute against the committed canonical tree rather than ProseMirror document content or mounted DOM. Each accepted table command SHALL create one semantic history entry.

#### Scenario: Toolbar table command commits once

- **WHEN** a user invokes insert row, delete column, set table borders, or clear cell fill from chrome
- **THEN** the engine commits the corresponding validated tree operation in one transaction and reconciles projections from its `ModelChange`

#### Scenario: Explicit resize target commits on pointer-up

- **WHEN** a column divider or outer-right resize gesture completes with an explicit target whose `sourceRevision` matches the current canonical store revision
- **THEN** one tree operation commits on pointer-up and Escape cancels without mutation

### Requirement: Pasted list levels keep their stated text and format

A rich paste of HTML with `mso-list` paragraphs SHALL build each used `w:lvl` from the `@list` level rule that the HTML states. The level text SHALL come from `mso-level-text`, unquoted and unescaped. The marker run properties SHALL come from the rule's font, color, weight, style, size, and underline. A bullet SHALL keep the stated glyph and font.

#### Scenario: A numbered level keeps its text and format

- **GIVEN** a rule `@list l0:level1 {mso-level-text:"%1\)"; color:red; mso-ansi-font-weight:bold}`
- **WHEN** a paragraph of that level pastes
- **THEN** its `w:lvl` has `w:lvlText w:val="%1)"` and a bold red `w:rPr`

#### Scenario: A symbol-font bullet keeps its glyph

- **GIVEN** a bullet rule with a private-use `mso-level-text` glyph and `font-family:Wingdings`
- **WHEN** a paragraph of that level pastes
- **THEN** its `w:lvl` has that glyph as `w:lvlText` and Wingdings as its `w:rFonts`

### Requirement: Pasted list levels keep their stated geometry

The pasted level indent SHALL come from the rule's `margin-left` and `text-indent`, and `mso-level-tab-stop` SHALL set the number tab stop. A value that the rule leaves out SHALL take the default level geometry. Every value SHALL be bounded and escaped before it reaches `numbering.xml`.

#### Scenario: A level keeps its indents

- **GIVEN** a rule `@list l0:level1 {margin-left:54.0pt; text-indent:-27.0pt}`
- **WHEN** a list item of that level with no indents of its own pastes
- **THEN** its `w:lvl` has `w:ind w:left="1080" w:hanging="540"`, and the number hangs 27pt left of the text

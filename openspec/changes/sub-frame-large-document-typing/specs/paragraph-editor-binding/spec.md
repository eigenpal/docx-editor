## MODIFIED Requirements

### Requirement: Transaction-to-DocOp mapping

`EditorBinding` SHALL map complete supported ProseMirror transactions and supported painted-surface input into typed `DocOp`s using transaction step mappings, stable semantic identities, model selection, and revision-tagged selection evidence. It MAY prepare a store-owned `CandidateChange`, but commit SHALL compare its predecessor revision, paragraph fingerprint, source layout revision, normalized effects, and shaping resources before canonical mutation. The binding SHALL commit mapped selection before provisional presentation and SHALL never derive later input from browser-mutated DOM.

#### Scenario: Text transaction commits

- **WHEN** a user inserts text into a projected paragraph
- **THEN** the binding commits the corresponding semantic operation before reconciling the view or presenting provisional committed text from its `ModelChange`

#### Scenario: Native deletion commits

- **WHEN** a user presses Backspace or Delete at a caret or over a browser-native selection
- **THEN** the binding commits precise semantic deletion operations, including supported run-boundary deletion and paragraph join

#### Scenario: Word-like keymap command commits

- **WHEN** a repository-specified ProseMirror keymap handles Enter, Backspace, Delete, Mod-B/I/U, or select-all
- **THEN** the command uses the current projection and commits authored effects only through typed `DocOp`s

#### Scenario: Unsupported transaction is rejected

- **WHEN** a transaction contains a step with no supported semantic mapping
- **THEN** no canonical mutation or provisional presentation occurs and the projection is restored to committed state with a diagnostic result

#### Scenario: Later character arrives before layout settles

- **WHEN** another eligible insertion arrives while provisional presentation is active
- **THEN** the binding maps it from committed model selection and the provisional source map rather than stale complete-layout or DOM positions

#### Scenario: Delayed selection evidence arrives

- **WHEN** browser selection evidence carries an older selection epoch
- **THEN** the binding rejects it before mapping another input operation

### Requirement: Canonical semantic history

Undo and redo SHALL operate through semantic store history and committed revisions. Each accepted user intent SHALL create one semantic history entry: one supported ProseMirror transaction, one complete IME composition, or one toolbar/command invocation. Projection reconciliation and provisional presentation SHALL create no entry. Presentation coalescing and complete-layout job coalescing SHALL NOT merge or redefine semantic history. The ProseMirror history plugin and time-based PM grouping MUST NOT be canonical authority.

#### Scenario: Undo paragraph edit

- **WHEN** the user undoes a committed paragraph insertion
- **THEN** a semantic operation changes the canonical tree and every projection follows that commit

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

#### Scenario: Consecutive typing keeps intent boundaries

- **WHEN** ordinary typing produces consecutive accepted ProseMirror transactions outside composition
- **THEN** each accepted `beforeinput` intent creates its own semantic history entry even when presentation or settle work is coalesced

#### Scenario: Provisional display is replaced

- **WHEN** complete layout atomically replaces provisional presentation
- **THEN** no semantic history entry is created

### Requirement: Projection excluded from save and layout

Save and complete layout code MUST NOT consume `EditorState`, `EditorView`, ProseMirror document content, composition draft DOM, provisional DOM, provisional display tags, or mounted DOM as document input. A provisional paragraph computation SHALL consume only a store-produced candidate and revision-matched semantic dependencies, then verify the committed candidate fingerprint before presentation.

#### Scenario: Editor view is absent

- **WHEN** a committed paragraph document is saved or laid out without mounting ProseMirror
- **THEN** the result is produced from the same canonical tree used by an interactive editor

#### Scenario: Save runs during provisional display

- **WHEN** DOCX save captures an input queue sequence before complete layout settles
- **THEN** save commits every accepted event through that sequence, excludes later events, and serializes that canonical revision without reading provisional DOM

#### Scenario: Complete layout follows provisional display

- **WHEN** complete layout starts after a provisional paragraph is visible
- **THEN** it reads the committed canonical revision and semantic caches rather than provisional DOM or display records as authored input

#### Scenario: Save runs during composition

- **WHEN** an unresolved private composition draft exists
- **THEN** public `Editor.save()` rejects with typed `composition-active` and never serializes draft content

## ADDED Requirements

### Requirement: Commands are open interfaces

The edit and command vocabularies SHALL be declared as TypeScript interfaces (`DocEdits`, `EditorCommands`) keyed by command name, not as sealed unions, so third parties can widen them by declaration merging. The executable union SHALL be derived from those interfaces.

#### Scenario: Extension contributes a command

- **WHEN** an extension augments `EditorCommands` with a new key and registers its handler
- **THEN** `exec` SHALL accept that command, and the command SHALL typecheck at call sites without casts

#### Scenario: Unknown command dispatched

- **WHEN** `exec` receives a `type` no extension has registered
- **THEN** it SHALL return a failure with code `unsupported` rather than throwing

### Requirement: Commands are serializable

Every command and edit SHALL be a plain JSON-serializable object of the form `{ type, ...args }`, so it can cross an MCP or RPC boundary without a per-command wrapper.

#### Scenario: Agent emits a command as JSON

- **WHEN** an agent emits `{"type":"toggleMark","mark":"bold"}` and it is parsed and passed to `exec`
- **THEN** it SHALL apply identically to the same command constructed in-process

#### Scenario: Command carries binary payload

- **WHEN** a command requires binary data, such as `insertImage`
- **THEN** the payload SHALL be typed so a JSON-safe projection is available for transport

### Requirement: Runtime schemas accompany the vocabulary

The package SHALL export runtime JSON Schemas keyed by command and query name (`docEditSchemas`, `docQuerySchemas`), because TypeScript types do not exist at runtime and MCP `tools/list` requires real schemas.

#### Scenario: MCP host enumerates tools

- **WHEN** an MCP host requests the tool list
- **THEN** each command SHALL yield a JSON Schema describing its arguments, without that schema being hand-maintained separately from the type

#### Scenario: Extension registers a command schema

- **WHEN** an extension calls `registerCommandSchema` for a command it contributed
- **THEN** that schema SHALL appear in the runtime registry alongside the built-in ones

### Requirement: Writes return a result taxonomy

Every write SHALL return `ExecResult`: either `{ ok: true, changed }` or `{ ok: false, code, reason }` where `code` is one of `notFound`, `ambiguous`, `locked`, `bound`, `typeMismatch`, `kindMismatch`, `outOfBounds`, `unsupported`, `invalidArgs`. A bare boolean SHALL NOT be used.

#### Scenario: Command applies and changes the document

- **WHEN** a command applies and modifies content
- **THEN** the result SHALL be `{ ok: true, changed: true }`

#### Scenario: Command applies but changes nothing

- **WHEN** a command is valid but produces no modification, such as bolding already-bold text
- **THEN** the result SHALL be `{ ok: true, changed: false }`, distinguishable from a failure

#### Scenario: Target is a locked content control

- **WHEN** a write targets a content control marked locked
- **THEN** the result SHALL be `{ ok: false, code: 'locked' }` and the document SHALL be unmodified

### Requirement: Batch edits report per-edit results

`applyEdits` SHALL return one `ExecResult` per input edit, positionally aligned with the input array.

#### Scenario: Batch with one failing edit

- **WHEN** a batch of five edits is applied and the third targets a missing paragraph
- **THEN** the result array SHALL have five entries, with the third reporting `notFound`

### Requirement: Tracked authorship is verb identity

Commands that record tracked changes SHALL require an `author` argument. There SHALL NOT be a global track-changes toggle that silently alters the behaviour of untracked commands.

#### Scenario: Proposing a replacement

- **WHEN** a caller invokes `proposeReplacement` with an author
- **THEN** the change SHALL be recorded as a tracked revision attributed to that author

#### Scenario: Author omitted

- **WHEN** a tracked command is invoked without an author
- **THEN** it SHALL fail to typecheck, rather than falling back to an implicit or empty author

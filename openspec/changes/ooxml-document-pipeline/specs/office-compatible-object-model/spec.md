## ADDED Requirements

### Requirement: Proxy graph adopts the `Word.*` names and types

The object model from `modular-core-api` SHALL declare its members with the names
and types of the document add-in JS API: `run`, `Word.RequestContext`,
`Word.Document`, `Word.Body`, `Word.Paragraph` (+ `Word.ParagraphCollection`),
`Word.Range`, `Word.Table` (+ `Word.TableCollection`), `Word.Section`
(+ `Word.SectionCollection`), `Word.Font`, `Word.Comment`, the collection shape
(`.items`, `getFirst()`, `getItem(i)`), `ClientResult<T>`, and `InsertLocation`.

#### Scenario: Add-in source loads and syncs

- **WHEN** consumer code calls `run(async (context) => { const body =
  context.document.body; body.load('text'); await context.sync() })`
- **THEN** it SHALL type-check and run against core with those member names

#### Scenario: Insert with a location enum

- **WHEN** consumer code calls `body.insertParagraph('x', InsertLocation.end)`
- **THEN** the `InsertLocation` values SHALL match the add-in enum
  (`Before`, `After`, `Start`, `End`, `Replace`)

### Requirement: No dependency on the add-in package

Core SHALL declare these types itself. It SHALL NOT add the document add-in
package (or its typings package) as a dependency.

#### Scenario: Dependency graph is checked

- **WHEN** core's dependencies are inspected
- **THEN** the add-in package SHALL be absent, and the `Word.*` types SHALL
  resolve from core's own declarations

### Requirement: The proxy graph projects store.model and queues DocOps

Reading a proxy property SHALL project from `store.model`; a mutation SHALL queue
on the context and flush through `store.apply` as one or more `DocOp`s on `sync`.
`sync` SHALL be the only materialization point, SHALL also reconcile any pending
remote `merge`, and SHALL trigger at most one relayout.

#### Scenario: Batched mutations flush once

- **WHEN** consumer code queues several inserts and calls `context.sync()` once
- **THEN** the mutations SHALL flush as `DocOp`s through `store.apply` together and
  trigger a single relayout

#### Scenario: Proxy read reflects store.model

- **WHEN** a property is `load`ed and `sync` completes
- **THEN** its materialized value SHALL reflect the current `store.model`

#### Scenario: sync reconciles a concurrent remote edit

- **WHEN** a remote or agent `DocOp` was merged into the store between two `sync`
  calls
- **THEN** the next `sync` SHALL reconcile it, so subsequent reads reflect both the
  local mutations and the remote change

### Requirement: The API is a headless superset of the client original

The same object-model code SHALL run client-side and additionally headless
(worker or server) against a document with no host application.

#### Scenario: Same code, server runtime

- **WHEN** object-model code that runs in the client editor is executed on the
  server against a parsed document
- **THEN** it SHALL run unchanged, reading and mutating the same document model
  through the same proxy names

### Requirement: Feature-gated members appear only when installed

A proxy member backed by a gated extension SHALL be present only when that
extension is installed; referencing an absent member SHALL be a build-time
type error, not a runtime licensing branch.

#### Scenario: Comments without collaboration

- **WHEN** the collaboration extension is not installed and code references
  `context.document.body ... getComments()` (or `Word.Comment`)
- **THEN** the reference SHALL be a missing-type error at build time

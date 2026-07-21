## ADDED Requirements

### Requirement: The model is the single source of truth through the store

The document model reached as `store.model` SHALL be canonical and always
current. All reads (object model, layout, serialize) SHALL derive from it, and no
other representation SHALL be canonical under any configuration.

#### Scenario: Canonical read

- **WHEN** any consumer reads document content
- **THEN** it SHALL read from `store.model`, which reflects every applied edit

#### Scenario: No canonicity flip between solo and collaboration

- **WHEN** collaboration is installed or absent
- **THEN** `store.model` SHALL remain canonical, and only the store backend SHALL
  differ, never which representation holds truth

### Requirement: apply is the only mutation path

`store.apply(op)` SHALL be the only way to mutate the document. A `DocOp` SHALL be
the serializable, anchor-addressed edit vocabulary from `core-api-contract`, so
one currency serves edit, undo, sync delta, and persistence.

#### Scenario: Every writer goes through apply

- **WHEN** a keystroke, an object-model write, or a remote delta mutates the
  document
- **THEN** it SHALL result in one or more `DocOp`s applied through `store.apply`
  (a remote delta via `store.merge`, which applies the equivalent ops)

#### Scenario: A DocOp crosses a process boundary

- **WHEN** a `DocOp` is serialized to JSON, transmitted, and applied by another
  process against the same document
- **THEN** it SHALL produce the same model change, because it addresses locations
  by anchor and holds no live handles

### Requirement: subscribe reports block-level change for incremental work

`store.subscribe` SHALL deliver a `ModelChange` naming the affected blocks on
every edit, so consumers invalidate incrementally rather than diffing the whole
document.

#### Scenario: One paragraph edited

- **WHEN** a single paragraph is edited
- **THEN** the `ModelChange` SHALL name that block, and measurement SHALL
  re-measure only the affected blocks, not the whole document

#### Scenario: Structural sharing preserves unchanged subtrees

- **WHEN** an edit changes one block
- **THEN** unchanged blocks SHALL retain identity, so a consumer can skip them by
  reference

### Requirement: The CRDT is a swappable store backend

The store backend SHALL be swappable behind the `DocumentStore` interface. A solo
document SHALL use an in-memory op-log backend; a collaborative document SHALL use
the `CrdtBackend` from `remote-document-sync` as a `DocumentStore` implementation.
The model-canonical shape SHALL be identical for both.

#### Scenario: Solo backend

- **WHEN** no collaboration extension is installed
- **THEN** the store SHALL use a local op-log backend, and `apply`/`subscribe`
  SHALL behave as with the CRDT backend

#### Scenario: Collaboration backend

- **WHEN** the collaboration extension is installed
- **THEN** `store.apply` SHALL map to a CRDT transaction, `store.merge` SHALL
  apply a remote delta, and `store.subscribe` SHALL fire on local and remote
  change, with no change to how `store.model` is read

### Requirement: The model mirrors the office-js Word object model

The model's structure and property names SHALL mirror the document add-in JS API
Word object model, so the object-model proxy graph is a thin lazy facade over the
model rather than a translation layer.

#### Scenario: Content tree shape

- **WHEN** the model is traversed
- **THEN** it SHALL expose a `Document` with `body` and `sections`; a `Body` with
  `paragraphs`, `tables`, and `inlinePictures`; a `Paragraph` with `font`,
  `style`, `alignment`, and `listItem`; a `Range`; a `Table` with `rows` and
  cells; and a `Font` with `bold`/`italic`/`underline`/`color`/`size`/`name`,
  matching the add-in names

#### Scenario: Proxy read is a projection, not a translation

- **WHEN** the object model reads `context.document.body.paragraphs`
- **THEN** it SHALL project the model's corresponding tree directly, without a
  name-mapping or reshaping step

### Requirement: The model is PM-free and DOM-free data

The model SHALL contain no ProseMirror node, no `EditorView`, and no DOM element.
ProseMirror and the display list SHALL be projections of the model, not stored in
it.

#### Scenario: Model carries no framework type

- **WHEN** the model is inspected
- **THEN** no field SHALL hold a ProseMirror `Node`, an `EditorView`, or a DOM
  element

#### Scenario: Server builds the model with no editor

- **WHEN** the pipeline parses a `.docx` on a server with no ProseMirror and no
  DOM
- **THEN** it SHALL produce a complete, canonical `store.model`

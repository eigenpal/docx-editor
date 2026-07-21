## ADDED Requirements

### Requirement: Four stages over store.model and the ports

Layout SHALL run as `measure -> paginate -> resolve -> emit`. Each stage SHALL
read `store.model` and the runtime ports and SHALL produce the input to the next
stage, with no dependency on a browser or a live editor.

#### Scenario: Stages run headless

- **WHEN** the pipeline runs on a server or worker
- **THEN** all four stages SHALL run to completion reading `store.model`, with no
  DOM and no ProseMirror present

#### Scenario: Layout reads the canonical model, never the editor

- **WHEN** layout runs on the client while a ProseMirror editor is mounted
- **THEN** it SHALL read `store.model` and SHALL NOT read the `EditorView` or its
  DOM

### Requirement: Measurement is a deterministic pure function

`measure` SHALL obtain glyph advances and vertical metrics through the injected
`MetricsProvider` and SHALL NOT call a browser canvas or font stack. For the same
`(model, ports)` the measured result SHALL be identical across runtimes.

#### Scenario: Same input, same measure

- **WHEN** the same model is measured with metric-equivalent ports in a browser
  and on a server
- **THEN** the measured advances and line breaks SHALL be identical

#### Scenario: Geometry lives in the model

- **WHEN** a line requires justification or text-fit adjustment
- **THEN** the adjustment SHALL be expressed as explicit per-line advance values
  in the measured result, not deferred to a downstream layout engine

### Requirement: Pagination splits flows into pages with owned geometry

`paginate` SHALL split sections, columns, tables, and header/footer flows into
pages, and the resulting page geometry SHALL live in the model output, so no
consumer re-derives positions.

#### Scenario: Table split across a page break

- **WHEN** a table does not fit on a page
- **THEN** pagination SHALL split it at a row boundary and record the fragment
  geometry, including any repeated header rows

#### Scenario: Header and footer flows

- **WHEN** a section defines a header and footer
- **THEN** pagination SHALL place them within the section's page geometry from
  the model, not from a runtime default

### Requirement: Cross-references resolve in a second pass

`resolve` SHALL run after pagination to fix values that depend on final page
placement: page numbers, `PAGEREF` / table-of-contents targets, and footnote
placement.

#### Scenario: A PAGEREF target

- **WHEN** a field references a bookmark whose page is known only after
  pagination
- **THEN** `resolve` SHALL fill the correct page number and internal-link
  destination

### Requirement: Emit produces the display-list IR for any backend

`emit` SHALL walk the resolved pages and produce the `DisplayItem[]` IR defined
by `modular-core-api`. Every output target (DOM, PDF, print, hit-test) SHALL
consume that IR and SHALL NOT re-derive geometry or interpret CSS.

#### Scenario: Two backends, one IR

- **WHEN** the same resolved pages are emitted to the DOM backend and the PDF
  backend
- **THEN** both SHALL consume the same `DisplayItem[]`, and neither SHALL
  recompute glyph positions

### Requirement: ProseMirror is a projection, incremental relayout on ModelChange

ProseMirror SHALL be a projection bound via `EditorBinding`: it is the editing
engine (keystroke -> transaction -> `DocOp` -> `store.apply`) but holds no
canonical state. Layout SHALL relayout in response to `store.subscribe`, and a
`ModelChange` SHALL re-measure only the blocks it names.

#### Scenario: Edit then relayout

- **WHEN** a user types in the client editor
- **THEN** the transaction SHALL apply `DocOp`s to the store, and the resulting
  `ModelChange` SHALL trigger relayout of only the affected blocks

#### Scenario: Remote or agent edit reaches the editor

- **WHEN** a remote or server-agent `DocOp` is merged into the store
- **THEN** the `ModelChange` SHALL both relayout the affected blocks and be
  reconciled into the `EditorState` by `EditorBinding`, so the edit appears in the
  editor without ProseMirror being the source

#### Scenario: No editor on the server

- **WHEN** the pipeline runs on the server
- **THEN** it SHALL run `parse -> store -> measure -> paginate -> resolve -> emit`,
  with the object model applying `DocOp`s and no ProseMirror present

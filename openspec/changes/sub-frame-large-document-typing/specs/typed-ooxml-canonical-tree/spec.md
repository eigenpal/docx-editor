## MODIFIED Requirements

### Requirement: Derived semantic indexes

Paragraph, story, relationship, style, parent, content-control, review, note, field, bookmark, drawing, section, table, and other lookup structures SHALL be derived from a specific canonical-tree revision and SHALL NOT be mutation or serialization authority. An aggregate index SHALL patch from validated mutation effects only when baseline evidence places its complete rebuild on the eligible typing path. Cold or uncommon indexes MAY retain complete rebuilding.

#### Scenario: Index is rebuilt

- **WHEN** a committed operation invalidates an index entry
- **THEN** rebuilding the index from the same tree revision yields the same semantic identity, order, relationships, and content

#### Scenario: Text changes without paragraph structure

- **WHEN** a text-local operation changes one paragraph without changing its semantic identity or order
- **THEN** paragraph and parent indexes reuse unaffected entries and perform no complete paragraph walk

#### Scenario: Undo restores a prior revision

- **WHEN** undo returns to a retained canonical revision
- **THEN** its derived indexes are restored or patched without using indexes from another revision

### Requirement: Atomic semantic mutation

The `DocumentStore` SHALL accept authored changes only as validated `DocOp`s against stable semantic identities and SHALL atomically publish a new tree revision and `ModelChange`. Text-local mutation SHALL validate checked mutation evidence and SHALL preserve immutable prior revisions, source order, unaffected node identity, and complete fallback behavior.

#### Scenario: Invalid operation has no effect

- **WHEN** a `DocOp` targets a missing paragraph, violates a tree invariant, or carries inconsistent mutation evidence
- **THEN** the operation is rejected without changing the revision, tree, indexes, history, or notifications

#### Scenario: Middle paragraph receives one character

- **WHEN** one character is inserted into an existing paragraph under a body with thousands of sibling blocks
- **THEN** the transaction publishes one validated revision without copying or freezing every body child

#### Scenario: Mutation lineage is unavailable

- **WHEN** an operation supplies an arbitrary replacement root or lacks an exact store-produced path witness
- **THEN** scoped validation refuses the operation or runs complete validation before anything publishes

### Requirement: Bounded untrusted input

Tree parsing and serialization SHALL enforce finite package/XML limits, safe part and relationship paths, no external entity expansion, no implicit external fetch, and escaped attacker-controlled output. Incremental validation SHALL apply the same canonical and security rules to every changed or created node and rebuilt ancestor. It MAY reuse prior proof only for object-identical untouched subtrees.

#### Scenario: Malicious package is rejected

- **WHEN** a package exceeds a mandatory limit or contains an unsafe traversing part path
- **THEN** parsing fails before publishing any canonical model

#### Scenario: Edited text is invalid XML

- **WHEN** inserted text violates canonical XML text rules
- **THEN** the operation is rejected before provisional display, history, notification, or save output

#### Scenario: Namespace context changes

- **WHEN** an operation changes a namespace binding that can affect descendant interpretation
- **THEN** validation expands to the complete affected namespace scope rather than reusing descendant proof

## ADDED Requirements

### Requirement: Bounded-touch canonical child sequences

Warm text-local mutation SHALL replace canonical content without work proportional to the total child count of an unchanged high-fanout ancestor. One internal persistent sequence SHALL be child-storage authority and SHALL provide stable ordered traversal, indexed edits, immutable snapshots, structural sharing, and deterministic serialization. Public `OoxmlNode.children` SHALL remain a stable frozen `readonly OoxmlNode[]` projection for one node, and `Array.isArray(node.children)` SHALL remain true.

#### Scenario: Unaffected sibling survives

- **WHEN** a text-local operation commits beside unknown elements and unrelated typed blocks
- **THEN** every unaffected subtree retains object identity and normalized save preserves its content and relative order

#### Scenario: Prior revision remains readable

- **WHEN** a later revision replaces one child in a high-fanout container
- **THEN** readers of the prior revision observe its original child sequence and content

#### Scenario: Public children are read

- **WHEN** a consumer reads `children` repeatedly from one canonical node
- **THEN** it receives the same frozen array projection while internal mutation and serialization continue to use the authoritative sequence

#### Scenario: No compatible representation passes

- **WHEN** every prototype violates public array behavior, fidelity, memory, or bounded-touch gates
- **THEN** migration stops and requires a separately specified major API change

### Requirement: Scoped validation uses sealed mutation lineage

Only sanctioned store mutation primitives SHALL create scoped-validation evidence. Each primitive SHALL emit exact rebuilt ancestry, child-sequence path edits, identity effects, namespace scope, and package-shell effects. Local sequence lineage SHALL be checked at every rebuilt sequence node. Collision-prone hashes SHALL NOT be security evidence.

#### Scenario: Forged proof reaches validation

- **WHEN** a caller supplies evidence that was not created by a sanctioned mutation primitive
- **THEN** scoped validation rejects it or runs complete validation

#### Scenario: Sequence path witness is inconsistent

- **WHEN** a rebuilt sequence node does not match the exact old-to-new path edit in its witness
- **THEN** the transaction is rejected before publication

### Requirement: Incremental identity integrity

Created, deleted, moved, and retained node identities SHALL be checked against the prior validated node index and checked mutation evidence. Incremental validation SHALL reject duplicate or inconsistent identities with the same observable result as complete validation.

#### Scenario: New identity collides with an untouched node

- **WHEN** a changed subtree introduces an identity already owned by an untouched subtree
- **THEN** the transaction is rejected before the new revision publishes

#### Scenario: Node moves between parents

- **WHEN** a supported structural operation moves a node while retaining its identity
- **THEN** the parent index and mutation proof record exactly one new parent and complete rebuilding yields the same relationship

### Requirement: Package validation follows package structure

Package relationship, content-type, safe-name, and part-membership validation SHALL run whenever package structure can change. A text-local replacement of an existing part MAY reuse prior package proof only when package structure, relationships, content types, part names, and membership remain identical.

#### Scenario: Text changes inside an existing part

- **WHEN** a validated text-local operation replaces only the canonical root of an existing part
- **THEN** the store does not rescan unchanged package relationships and content types

#### Scenario: Relationship or part changes

- **WHEN** a transaction creates, removes, renames, or relates a package part
- **THEN** complete package invariants run and any dangling relationship or missing content type rejects the transaction

### Requirement: Complete rebuild remains the index oracle

Every incrementally maintained index SHALL provide a complete rebuild oracle. Repository tests SHALL compare incremental and complete results after supported edits, undo, redo, rejection, and randomized operation sequences.

#### Scenario: Random operation sequence completes

- **WHEN** a deterministic sequence mixes text edits, split, join, table operations, undo, and redo
- **THEN** every incremental index equals a complete rebuild at each published revision

#### Scenario: Rejected operation leaves sidecars unchanged

- **WHEN** validation rejects an operation
- **THEN** canonical state and all index sidecars remain those of the prior revision

### Requirement: Incremental state has bounded retention

Persistent sequences, mutation proofs, and index sidecars SHALL use structural sharing and bounded retention. History eviction SHALL release revision-only metadata. Retained complexity SHALL be proportional to the live indexes plus changed entries in undoable revisions, not history length multiplied by document size.

#### Scenario: Sustained typing exceeds history limit

- **WHEN** a long document receives more text edits than the configured history limit
- **THEN** evicted revisions and their unshared index metadata become collectible while live and undoable revisions remain valid

### Requirement: ModelChange carries normalized part effects

Published `ModelChange` SHALL carry part-scoped created, deleted, moved, and changed identities, replaced ancestry, package-shell effects, dependency invalidations, and impact. Private validation proof SHALL NOT escape the store. Undo and redo SHALL retag reused immutable-tree sidecars for their new monotonic publication revision.

#### Scenario: Node moves within a part

- **WHEN** a validated structural operation moves one node
- **THEN** `ModelChange` names its part, retained identity, previous parent, new parent, and affected dependencies

#### Scenario: Undo restores an immutable tree

- **WHEN** undo publishes a previously retained tree under a new revision
- **THEN** consumers receive normalized effects for the new transition and never observe the old publication revision on reused sidecars

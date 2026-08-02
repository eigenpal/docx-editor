## REMOVED Requirements

### Requirement: Comment and proposeChange transaction builders in core

Superseded. `createCommentTr`, `replyTr`, and `proposeChangeTr` were ProseMirror transaction builders from the architecture where PM transactions were the write path. None has any occurrence under `packages/`. The write path is now `TreeDocumentStore.transact` over `TreeDocOp`s, and the comment operations are specified in `comment-thread-model`.

## MODIFIED Requirements

### Requirement: Canonical, instance-scoped identifier allocation

Identifier allocation SHALL be instance-scoped, not module-global, so two editors on one page never share a counter. Each editor SHALL instantiate one allocator per identifier space and seed it on document load from the **maximum identifier already present in that document**.

Allocation SHALL be monotonic and SHALL NOT reuse an identifier freed by a deletion within a session.

Every identifier written to a file SHALL be allocated inside the range the consuming application accepts, which is **narrower than the schema permits**. `CT_Markup/@w:id` is `ST_DecimalNumber`, a restriction of `xsd:integer` with no bounds, so a schema validator will accept a value Word rejects. An allocator SHALL therefore clamp to the application range and SHALL NOT derive an identifier from a clock, a timestamp, a random source, a hash, or any other value that ignores the document's existing maximum.

This generalises the previous ProseMirror-scoped requirement to every identifier space the engine writes, and restates it against the store rather than against a PM transaction builder.

#### Scenario: Monotonic ids survive deletions

- **WHEN** a comment or revision is added, deleted, and another added
- **THEN** the new identifier does not collide with a previously used one, and the freed value is not immediately reissued

#### Scenario: Allocators are per-instance

- **WHEN** two editor instances each create an allocator
- **THEN** identifiers drawn from one are independent of the other, with no shared module-global counter

#### Scenario: Seeded from the document, never from a clock

- **WHEN** an allocator is seeded on load for any identifier space
- **THEN** it is seeded from the maximum identifier present in the loaded document plus one
- **AND** seeding from `Date.now()`, a random source, or a hash is refused — a document whose highest revision id is 12 allocates 13, not a 13-digit value

#### Scenario: Written identifiers stay inside the consuming application's range

- **WHEN** any identifier is written to a package
- **THEN** it is within the range that application accepts, and a conformance test asserts the bound
- **AND** the test does not rely on schema validation, which accepts out-of-range values for `ST_DecimalNumber`

#### Scenario: Exhaustion is an error, not an overflow

- **WHEN** an identifier space has no value left inside its range
- **THEN** allocation fails with `invalidArgs` and publishes no `ModelChange`
- **AND** it does not wrap, truncate, or emit a value outside the range

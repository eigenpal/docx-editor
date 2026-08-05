# core-comment-ops Specification (delta)

## MODIFIED Requirements

### Requirement: Comment and proposeChange transaction builders in core

Comment creation, reply, and tracked-change proposal operations SHALL be contributed by the pro review module through the `EditorModule` seam rather than exported from `@docx-editor.dev/core` as free-core API. The operation contracts are unchanged: builders cover range resolution and overlapping-change rejection, and adapter-specific state mutation, event emission, and subscriber notification remain in each adapter. Core SHALL retain lossless parse/serialize of comments and revisions regardless of module registration.

#### Scenario: Add a comment over a located range

- **WHEN** the review module's comment-creation command is invoked for a resolvable range in a licensed editor
- **THEN** it produces a transaction adding the comment over the range with an allocated comment id, according to the documented operation contract

#### Scenario: Propose a tracked change

- **WHEN** the review module's propose-change command is invoked for an insertion, deletion, or replace
- **THEN** it applies the deletion/insertion correctly and rejects when the range overlaps an existing tracked change

#### Scenario: Free core preserves comments without write ops

- **WHEN** a document with comments is opened, edited elsewhere, and saved in an editor with no review module
- **THEN** comment parts and references round-trip losslessly and no comment write API is exposed

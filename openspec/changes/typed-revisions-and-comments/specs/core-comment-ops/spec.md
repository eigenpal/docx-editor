## MODIFIED Requirements

### Requirement: Comment and proposeChange transaction builders in core

`@docx-editor.dev/core` SHALL expose the comment and tracked-change write path as `TreeDocOp`s and package transactions over the canonical OOXML tree — not as ProseMirror transaction builders over marks. `createCommentTr`, `replyTr` and `proposeChangeTr` are withdrawn with the lane they belonged to: a comment is `w:commentRangeStart`/`w:commentRangeEnd`/`w:commentReference` in a story plus a `CT_Comment` in `word/comments.xml`, and a mark cannot express markup that spans five parts.

A comment write SHALL commit through the package transaction seam, so the story markers, the comment body, the thread state, the relationship and the content-type override commit together or not at all. A tracked edit SHALL commit as an ordinary text op carrying a `RevisionAttributionInput`, so an op still states on its face whether it is tracked and no emit site can silently write an untracked edit while suggesting mode is on.

Adapter-specific state mutation, event emission, and subscriber notification SHALL remain in each adapter.

#### Scenario: Add a comment over a located range

- **WHEN** a comment is added over a resolvable paragraph range
- **THEN** one transaction writes the three story markers, the `CT_Comment` body, and — creating them if the package has none — the comment part, its relationship, and its content-type override
- **AND** it publishes one `ModelChange` and one undo entry, so one undo takes the whole comment back

#### Scenario: A partially written comment is unreachable

- **WHEN** any part of a comment write fails
- **THEN** nothing is published, and there is never a story referencing a comment body that does not exist

#### Scenario: Propose a tracked change

- **WHEN** text is inserted or deleted while suggesting mode is active
- **THEN** the insertion commits as `w:ins` and the deletion re-labels the words as `w:delText` inside `w:del`, both carrying the configured author
- **AND** an edit overlapping an existing tracked change follows the containment rule in `revision-model` rather than being refused

### Requirement: Canonical, instance-scoped comment/revision ID allocation

ID allocation SHALL be monotonic within an editor session and SHALL NOT reuse a value released during it. Comment ids and revision ids are SEPARATE spaces and SHALL be allocated separately: `@w:id` on a `w:comment` and `@w:id` on a `w:ins` are unrelated, and so is the bookmark id space, which is attacker-controlled and unbounded.

Each SHALL be seeded from the DOCUMENT — one past the highest value the relevant part already carries — rather than from module-global state, a clock, or a random source, so two editor instances on one page cannot share a counter and a reopened document cannot mint an id it already uses.

Both SHALL be clamped to signed 32-bit, which is what Word reads even though `ST_DecimalNumber` is unbounded. When the ceiling is reached, allocation SHALL take the lowest unused value rather than wrap into an id the file already uses — an id collision makes the user's edit a member of somebody else's revision, which a crafted `@w:id` could force deliberately.

#### Scenario: Monotonic ids survive deletions

- **WHEN** a comment or tracked change is added, then deleted, then another is added
- **THEN** the new id does not collide with a previously used id

#### Scenario: Comment and revision id spaces are separate

- **WHEN** a document's highest comment id is 12 and its highest revision id is 3
- **THEN** the next comment is 13 and the next revision is 4, because neither is seeded from the other

#### Scenario: A bookmark id never seeds a revision id

- **WHEN** a part carries a `w:bookmarkStart` with a 23-digit `@w:id`
- **THEN** revision allocation ignores it, because it is a different id space
- **AND** no revision is written with a value outside signed 32-bit, which Word calls unreadable

#### Scenario: Seed on load avoids collisions with existing ids

- **WHEN** a document with existing comment and revision ids is loaded
- **THEN** the next allocated id of each kind is strictly greater than the highest pre-existing one of that kind in that part

#### Scenario: Exhaustion takes a free id, never a used one

- **WHEN** allocation would pass the signed 32-bit ceiling
- **THEN** the lowest id nobody is using is taken instead
- **AND** a part with no free id refuses rather than inventing a collision

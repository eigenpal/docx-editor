## ADDED Requirements

### Requirement: ECMA-376 Part 1 governs the comment markup

Every rule below SHALL be read against ECMA-376 Part 1 as the governing authority: `CT_Comment` (§17.13.4.2) and the range markers `w:commentRangeStart`/`w:commentRangeEnd` (§17.13.4.4, §17.13.4.3). Part 1 defines no thread parent and no resolved flag; the `w14`/`w15`/`w16cid`/`w16cex` namespaces that carry them are outside it and SHALL be read as optional evidence whose absence is never an error.

#### Scenario: A package with comments and no extension parts is fully supported

- **WHEN** a package holds `comments.xml` and none of the extension parts
- **THEN** its comments load, anchor, and edit, with threading taken from Part 1 markup alone

### Requirement: Comment markup and comment bodies are typed

The canonical tree SHALL type `w:commentRangeStart`, `w:commentRangeEnd`, `w:commentReference`, and `CT_Comment` in `word/comments.xml` — which extends `CT_TrackChange` with `@w:initials` and block content. A comment body SHALL be a story, so its paragraphs flow through the same path the body uses.

#### Scenario: Comment part loads as typed comments

- **WHEN** a package containing `word/comments.xml` with four comments is loaded
- **THEN** all four are typed, each carrying its id, author, date, optional initials, and block content

#### Scenario: Anchors are typed, not generic

- **WHEN** a paragraph contains `w:commentRangeStart` and `w:commentRangeEnd`
- **THEN** both are typed nodes with a defined contribution to the paragraph's UTF-16 offsets

#### Scenario: Comment body flows

- **WHEN** a comment body contains two paragraphs
- **THEN** both are laid out as a story, so the review surface renders measured text rather than a raw string

#### Scenario: Package with no comment part

- **WHEN** a package declares no comments relationship
- **THEN** no comment part, relationship, or content-type override is fabricated on save

### Requirement: Thread state is read from structure, never inferred from text

ECMA-376 §17.13.4.2 gives `CT_Comment` no parent pointer and no resolved flag, so neither is something Part 1 states. Threading, resolved state, durable ids, and UTC dates SHALL therefore be read as optional evidence from `commentsExtended.xml` (`w15:commentEx` with `@w15:paraIdParent` and `@w15:done`), `commentsIds.xml` (`w16cid`, including `@w16cid:parentId` on `w:comment`), and `commentsExtensible.xml` (`w16cex`) — all outside Part 1 — and their absence SHALL NOT be an error.

Where no part names a parent, a reply SHALL be recognised from its ANCHOR: a comment whose `w:commentRangeStart`/`w:commentRangeEnd` (§17.13.4.4, §17.13.4.3) cover exactly the characters an earlier comment's cover is a reply to it. Those markers are Part 1's own vocabulary and all that survives a producer that omits the sibling parts. Coincidence SHALL be the last resort, SHALL NOT override a stated link, and SHALL NOT apply to a comment the file gives a `w15:commentEx` record — such a record without `@w15:paraIdParent` states that the comment is top-level. A merely NARROWER range inside another comment's range SHALL NOT be read as a reply. Thread structure SHALL NOT be inferred from a comment's text.

#### Scenario: Reply linkage comes from commentsExtended

- **WHEN** `commentsExtended.xml` declares `@w15:paraIdParent` for a comment
- **THEN** that comment is presented as a reply to the named parent

#### Scenario: Reply linkage comes from `@w16cid:parentId`

- **WHEN** a `w:comment` carries `@w16cid:parentId` naming another comment in the same part
- **THEN** it is presented as a reply to that comment

#### Scenario: A coincident anchor is a thread

- **WHEN** two comments are anchored over exactly the same characters and no part names a parent for either, as comments `w:id="2"` and `w:id="3"` in the comprehensive fixture are
- **THEN** the later comment is presented as a reply to the earlier one

#### Scenario: A narrower range inside another comment is a separate comment

- **WHEN** one comment's range covers a span strictly inside another comment's range
- **THEN** both are presented as top-level, because commenting on a word inside a commented sentence is a new remark rather than a reply

#### Scenario: Prose that looks like a reply is not a reply

- **WHEN** a comment's text begins "Reply:", no part names a parent for it, and its range covers characters no other comment covers
- **THEN** it is presented as an independent top-level comment on its own anchor range
- **AND** no thread is inferred from its wording

#### Scenario: Resolved state comes from `@w15:done`

- **WHEN** `commentsExtended.xml` marks a comment `@w15:done="1"`
- **THEN** it is presented as resolved

#### Scenario: A sibling part present without thread links is not threading

- **WHEN** `commentsExtended.xml` is present and every `w15:commentEx` carries `@w15:done` with no `@w15:paraIdParent`, as `issue-68-large-comments-suggestions.docx` does for all 212 of its comments
- **THEN** resolved state is read from it
- **AND** every comment is still presented as top-level, even where two share an anchor, because the record states the answer and no inference may overrule it

#### Scenario: Absent sibling parts mean no resolved state

- **WHEN** a package contains `comments.xml` but none of the three sibling parts
- **THEN** every comment is unresolved
- **AND** threading is whatever the anchors state and nothing more
- **AND** the absence is reported so the surface can explain why resolve is unavailable rather than showing it as broken

#### Scenario: Sibling parts round-trip

- **WHEN** a package containing all three sibling parts is loaded and saved unedited
- **THEN** each matches its input by canonical fingerprint

### Requirement: A reply against a tracked change is a comment on that change's range

OOXML gives a revision no body, no thread, and no reply: `w:ins` and `w:del` carry `(@w:id, @w:author, @w:date)` and nothing else. A reply offered against a revision SHALL therefore commit as a comment anchored over that revision's resolved range, and SHALL NOT invent markup on the revision element.

#### Scenario: Replying to a revision creates a comment

- **WHEN** the user replies to a tracked insertion from the review surface
- **THEN** a comment is created whose anchor range covers that revision's content
- **AND** the revision element itself is unchanged, keeping its id, author, and date

#### Scenario: The comment threads under the change it covers

- **WHEN** a comment's range overlaps a revision's range
- **THEN** the review surface presents the comment with that change
- **AND** the association is derived from the ranges, not stored as a new attribute

#### Scenario: Reply is not offered when comments cannot be written

- **WHEN** a build renders revisions but has no comment write path
- **THEN** the reply affordance is not rendered, rather than rendered and inert

### Requirement: `w14:paraId` is allocated on first comment write, never assumed

Threading and resolved state require `w14:paraId` on **comment** paragraphs. Where a document has none, the system SHALL allocate them when it first writes thread state, SHALL record the allocation, and SHALL NOT link comments by position.

This requirement governs `word/comments.xml`. Paragraph identity in the main part is allocated at load by `normalizeParagraphIdentity`, because `DocAnchor` addresses paragraphs by `w14:paraId` and an unidentified paragraph is unaddressable. The comment part SHALL NOT be normalized at load.

#### Scenario: Reply on a document with no paraId

- **WHEN** the user replies to a comment in a document with zero `w14:paraId` values, as the comprehensive fixture has
- **THEN** a `w14:paraId` is allocated for the parent comment paragraph, `commentsExtended.xml` is created with its relationship and content-type override, and the reply links to it
- **AND** it all commits in one transaction

#### Scenario: Allocated ids are well-formed and unique

- **WHEN** `w14:paraId` values are allocated
- **THEN** each is an 8-hex-digit value, unique within the document, and not the reserved all-zero value

#### Scenario: No allocation in the comment part without a comment write

- **WHEN** a package whose `comments.xml` has no `w14:paraId` is loaded, laid out, and saved without a comment write
- **THEN** no `w14:paraId` is added to `comments.xml` and that part matches its input by canonical fingerprint

### Requirement: Comment anchors are durable ranges over node identity

A comment's anchor SHALL be a range over stable node identities and offsets, with declared affinity at each boundary, surviving edits inside and around it.

#### Scenario: Edit inside the range

- **WHEN** text is inserted in the middle of a commented range
- **THEN** the comment still covers the range including the new text

#### Scenario: Insertion at a boundary follows affinity

- **WHEN** text is inserted exactly at a comment range's start or end
- **THEN** its inclusion follows the stored affinity, consistently for every reader of the same revision

#### Scenario: Paragraph split inside the range

- **WHEN** a commented range is split by Enter into two paragraphs
- **THEN** the comment covers both fragments

#### Scenario: Paragraph join

- **WHEN** two paragraphs, each carrying a comment, are joined
- **THEN** both comments survive over their respective character ranges in the joined paragraph

#### Scenario: Overlapping and nested ranges

- **WHEN** two comment ranges overlap, or one nests inside another
- **THEN** both load, both render, and both remain separately addressable

#### Scenario: Anchors outside the body

- **WHEN** a comment is anchored in a header, footer, or note body
- **THEN** it is addressable in that story, and the review surface reports which story it belongs to

### Requirement: Orphan policy is explicit and never silently reattaches

The behaviour of a comment whose anchored range is entirely deleted, partially deleted, or made ambiguous SHALL be declared. A comment SHALL NOT reattach to unrelated text.

#### Scenario: Whole range deleted

- **WHEN** every character of a commented range is deleted
- **THEN** the comment enters its declared orphaned state — retained and reported, or deleted — atomically with the edit, per the declared policy
- **AND** it does not silently anchor to the neighbouring text

#### Scenario: Partial deletion

- **WHEN** part of a commented range is deleted
- **THEN** the comment covers the surviving part

#### Scenario: Orphans are visible

- **WHEN** a document contains an orphaned comment
- **THEN** the review surface lists it as orphaned rather than omitting it

#### Scenario: Dangling reference

- **WHEN** a `w:commentReference` names an id with no comment in the comment part
- **THEN** the document loads, the reference is preserved, and the condition is reported as a diagnostic

#### Scenario: Range markers without a reference

- **WHEN** a `w:commentRangeStart` has no matching `w:commentRangeEnd`
- **THEN** the document loads, the markup is preserved, and the condition is reported rather than the range being guessed

### Requirement: Comment operations commit through the store

`TreeDocOp` SHALL include add-comment, reply-to-comment, edit-comment, delete-comment, and resolve/reopen-comment. Each SHALL require an author, validate, and commit atomically.

#### Scenario: Add a comment on a range

- **WHEN** add-comment runs over a selected range with an author
- **THEN** the range markers, the reference, and the comment body commit in one transaction with one `ModelChange` and one D10 history entry

#### Scenario: Add a comment inside a locked control

- **WHEN** add-comment targets a range inside a `contentLocked` content control
- **THEN** it is refused with `locked` and no comment is created

#### Scenario: Delete a comment removes its markup

- **WHEN** a comment is deleted
- **THEN** its range markers, its reference, its body, and its thread record are all removed in one transaction

#### Scenario: Deleting a parent with replies

- **WHEN** a comment with replies is deleted
- **THEN** the declared policy applies to the replies — deleted with the parent, or promoted — and it is the same policy every time

#### Scenario: Resolve writes thread state, not body text

- **WHEN** a comment is resolved
- **THEN** `@w15:done` is written in `commentsExtended.xml` and the comment's own text is unchanged

### Requirement: Comment parts satisfy both D9 oracles

Comment parts and their siblings SHALL pass the canonical tree fingerprint on an unedited round trip and the save/reopen semantic digest after a comment operation.

#### Scenario: Comments survive an unrelated edit

- **WHEN** a document with comments is loaded, an unrelated paragraph is edited, and the package is saved
- **THEN** `word/comments.xml` and every sibling thread part match their input by canonical fingerprint

#### Scenario: Reply reopens as a reply

- **WHEN** a reply is added, saved, and reopened
- **THEN** the digest reports the parent link, the author, the date, and the body as equivalent, and the other comments unchanged

### Requirement: Comment and paraId allocation is bounded and document-seeded

Comment ids share `ST_DecimalNumber`'s unbounded schema type and Word's signed 32-bit limit, and SHALL be allocated by seeding from the document's maximum comment id plus one, never from a clock, timestamp, random source, or hash.

`w14:paraId` is `ST_LongHexNumber` — `xsd:hexBinary` of length 4, so exactly **8 hex digits**. An allocated value SHALL be 8 hex digits, unique within the document, and SHALL NOT be the reserved all-zero value.

#### Scenario: Comment ids are seeded from the document

- **WHEN** a comment is added to a document whose highest comment id is 3
- **THEN** the allocated id is 4, and it is within signed 32-bit

#### Scenario: paraId is well-formed

- **WHEN** a `w14:paraId` is allocated on first thread write
- **THEN** it is exactly 8 hex digits, is not all zeros, and collides with no existing value in the document

#### Scenario: Exported ids open in Word

- **WHEN** a document with engine-authored comments and replies is saved and opened in Word
- **THEN** it opens without a repair prompt and the thread structure is intact

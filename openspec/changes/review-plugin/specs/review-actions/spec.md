## ADDED Requirements

### Requirement: Add comment by paragraph index

The system SHALL provide `addComment({ paragraphIndex, author, text, search? })`. When `search` is omitted, the comment SHALL anchor to the entire paragraph. When `search` is provided, it SHALL anchor to the first occurrence of that string within the specified paragraph. SHALL throw `ChangeNotFoundError` if `paragraphIndex` is out of bounds. SHALL throw `TextNotFoundError` if `search` is provided but not found in the paragraph.

#### Scenario: Comment on whole paragraph

- **WHEN** `addComment({ paragraphIndex: 15, author: 'AI', text: 'Liability cap too low.' })` is called
- **THEN** a comment is anchored to the full text of paragraph 15, a `Comment` object is added to `body.comments`, and `CommentRangeStart`/`CommentRangeEnd` markers wrap the paragraph content

#### Scenario: Comment on specific text within paragraph

- **WHEN** `addComment({ paragraphIndex: 15, search: '$50,000', author: 'AI', text: 'Should be uncapped.' })` is called
- **THEN** the comment anchors only to the "$50,000" text within paragraph 15

#### Scenario: Search text not found in paragraph

- **WHEN** `addComment({ paragraphIndex: 15, search: 'nonexistent', author: 'AI', text: 'note' })` is called
- **THEN** `TextNotFoundError` is thrown

### Requirement: Reply to existing comment

The system SHALL provide `replyTo(commentId, { author, text })` that adds a reply to an existing comment. SHALL throw `CommentNotFoundError` if the comment ID doesn't exist.

#### Scenario: Reply to a comment

- **WHEN** `replyTo(5, { author: 'AI', text: 'Agreed, updating to 60 days.' })` is called
- **THEN** a reply `Comment` with `parentId: 5` is added and appears in the parent's `replies` array via `getComments()`

#### Scenario: Reply to non-existent comment

- **WHEN** `replyTo(999, { author: 'AI', text: 'reply' })` is called
- **THEN** `CommentNotFoundError` is thrown

### Requirement: Propose replacement as tracked change

The system SHALL provide `proposeReplacement({ paragraphIndex, search, author, replaceWith })`. It SHALL find `search` in the specified paragraph, wrap the matched runs in a `Deletion`, and insert an `Insertion` with `replaceWith` immediately after. SHALL throw `TextNotFoundError` if `search` is not found in the paragraph.

#### Scenario: Propose replacing text

- **WHEN** `proposeReplacement({ paragraphIndex: 15, search: '$50,000', author: 'AI', replaceWith: '$500,000' })` is called
- **THEN** "$50,000" is wrapped in a `Deletion` and "$500,000" in an `Insertion`, both with author 'AI' and current timestamp

#### Scenario: Replacement visible in getChanges

- **WHEN** `proposeReplacement(...)` is called, then `getChanges()` is called
- **THEN** two new changes appear: one deletion and one insertion, both at the same paragraphIndex

### Requirement: Propose insertion as tracked change

The system SHALL provide `proposeInsertion({ paragraphIndex, author, insertText, position })`. `position` is `'before'` or `'after'` (default: `'after'`), referring to the paragraph's content. Optionally accepts `search` to insert adjacent to specific text within the paragraph.

#### Scenario: Insert after paragraph content

- **WHEN** `proposeInsertion({ paragraphIndex: 23, author: 'AI', insertText: ' Sections 5 and 6 shall survive termination.', position: 'after' })` is called
- **THEN** an `Insertion` tracked change is appended to paragraph 23's content

#### Scenario: Insert adjacent to specific text

- **WHEN** `proposeInsertion({ paragraphIndex: 15, search: 'exceed', author: 'AI', insertText: ' (excluding IP claims)', position: 'after' })` is called
- **THEN** the insertion appears immediately after "exceed" in paragraph 15

### Requirement: Propose deletion as tracked change

The system SHALL provide `proposeDeletion({ paragraphIndex, search, author })`. It SHALL find `search` in the specified paragraph and wrap the matched runs in a `Deletion`. SHALL throw `TextNotFoundError` if not found.

#### Scenario: Propose deleting text

- **WHEN** `proposeDeletion({ paragraphIndex: 20, search: 'and all consequential damages', author: 'AI' })` is called
- **THEN** the matched text is wrapped in a `Deletion` tracked change

### Requirement: Accept and reject tracked changes

The system SHALL provide `acceptChange(id)` and `rejectChange(id)`. Accept: for insertions, keep text and remove wrapper; for deletions, remove text and wrapper. Reject: inverse. SHALL throw `ChangeNotFoundError` if ID doesn't exist. SHALL provide `acceptAll()` and `rejectAll()` that process all changes and return the count.

#### Scenario: Accept an insertion

- **WHEN** `acceptChange(1)` is called for an insertion
- **THEN** the text becomes normal paragraph content, the `Insertion` wrapper is removed

#### Scenario: Accept a deletion

- **WHEN** `acceptChange(2)` is called for a deletion
- **THEN** the deleted text and the `Deletion` wrapper are both removed

#### Scenario: Reject an insertion

- **WHEN** `rejectChange(1)` is called for an insertion
- **THEN** the inserted text and the `Insertion` wrapper are both removed

#### Scenario: Reject a deletion

- **WHEN** `rejectChange(2)` is called for a deletion
- **THEN** the text becomes normal paragraph content, the `Deletion` wrapper is removed

#### Scenario: Accept all

- **WHEN** `acceptAll()` is called on a document with 5 tracked changes
- **THEN** all changes are accepted and 5 is returned

### Requirement: Batch review operation

The system SHALL provide `applyReview(ops)` accepting: `accept` (number[]), `reject` (number[]), `comments` (array of `{ paragraphIndex, author, text, search? }`), `replies` (array of `{ commentId, author, text }`), `proposals` (array of `{ paragraphIndex, search, author, replaceWith }`). Operations SHALL be applied in order: accept/reject, then comments, then replies, then proposals. Individual failures SHALL be collected in `errors` array, not thrown. SHALL return `BatchResult` with counts.

#### Scenario: Full batch review

- **WHEN** `applyReview({ accept: [1], reject: [2], comments: [{ paragraphIndex: 15, author: 'AI', text: 'Too low' }], proposals: [{ paragraphIndex: 15, search: '$50,000', author: 'AI', replaceWith: '$500,000' }] })` is called
- **THEN** change 1 is accepted, change 2 is rejected, a comment is added, a replacement is proposed, and result has correct counts

#### Scenario: Partial failures don't stop batch

- **WHEN** `applyReview({ accept: [1, 999] })` is called where 999 doesn't exist
- **THEN** change 1 is accepted, error for 999 is collected, result is `{ accepted: 1, errors: [{ operation: 'accept', id: 999, error: 'Change not found' }] }`

### Requirement: Export modified document

The system SHALL provide `toDocument()` returning the modified `Document` model, and `toBuffer()` returning `Promise<ArrayBuffer>` (serialized DOCX). `toBuffer()` SHALL throw if no original buffer was provided at construction.

#### Scenario: Round-trip

- **WHEN** changes are accepted, comments added, then `toBuffer()` is called and the result re-parsed
- **THEN** the re-parsed document reflects all modifications

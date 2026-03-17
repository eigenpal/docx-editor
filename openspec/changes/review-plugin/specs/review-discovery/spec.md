## ADDED Requirements

### Requirement: getChanges returns all tracked changes

The system SHALL provide `getChanges(filter?)` that returns all tracked changes as `ReviewChange[]`. Each object SHALL include: `id` (number, OOXML revision ID), `type` ('insertion' | 'deletion' | 'moveFrom' | 'moveTo'), `author` (string), `date` (string | null), `text` (string, the affected text content), `context` (string, full paragraph text), and `paragraphIndex` (number). Multiple runs sharing the same revision ID within a paragraph SHALL be grouped into a single `ReviewChange` with combined text.

#### Scenario: Document with insertions and deletions

- **WHEN** `getChanges()` is called on a document with tracked changes
- **THEN** one `ReviewChange` per logical change is returned with correct type, author, date, text, and paragraphIndex

#### Scenario: No tracked changes

- **WHEN** `getChanges()` is called on a clean document
- **THEN** an empty array is returned

#### Scenario: Filter by author

- **WHEN** `getChanges({ author: 'Jane' })` is called
- **THEN** only changes by Jane are returned

#### Scenario: Filter by type

- **WHEN** `getChanges({ type: 'deletion' })` is called
- **THEN** only deletions are returned

### Requirement: getComments returns all comments

The system SHALL provide `getComments(filter?)` that returns all comments as `ReviewComment[]`. Each object SHALL include: `id` (number), `author` (string), `date` (string | null), `text` (string, comment body as plain text), `anchoredText` (string, document text the comment is attached to), `paragraphIndex` (number), `replies` (array of `{ id, author, date, text }`), and `done` (boolean).

#### Scenario: Document with comments and replies

- **WHEN** `getComments()` is called on a document with comments
- **THEN** top-level comments are returned with nested replies, and `anchoredText` contains the text between range markers

#### Scenario: No comments

- **WHEN** `getComments()` is called on a document with no comments
- **THEN** an empty array is returned

#### Scenario: Filter by author

- **WHEN** `getComments({ author: 'Bob' })` is called
- **THEN** only Bob's comments are returned

#### Scenario: Filter by done status

- **WHEN** `getComments({ done: false })` is called
- **THEN** only unresolved comments are returned

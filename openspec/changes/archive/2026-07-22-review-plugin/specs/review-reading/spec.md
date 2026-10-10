## ADDED Requirements

### Requirement: getContent returns structured document blocks

The system SHALL provide `getContent(options?)` on `DocxReviewer` that returns the document as an array of `ContentBlock` objects. Each block SHALL have: `type` ('heading' | 'paragraph' | 'table' | 'list-item'), `index` (paragraph/block index in the document), and `text` (full plain text, NOT truncated). Headings SHALL include `level` (1-9). Tables SHALL include `rows` (2D string array of cell text). List items SHALL include `listLevel` and `listType` ('bullet' | 'number').

#### Scenario: Simple document

- **WHEN** `getContent()` is called on a document with a heading, 2 body paragraphs, and a table
- **THEN** the result is `[{ type: 'heading', level: 1, index: 0, text: 'Title' }, { type: 'paragraph', index: 1, text: 'First paragraph full text...' }, { type: 'paragraph', index: 2, text: 'Second paragraph...' }, { type: 'table', index: 3, rows: [['H1','H2'],['C1','C2']] }]`

#### Scenario: No truncation

- **WHEN** a document has 500 paragraphs and `getContent()` is called
- **THEN** all 500 paragraphs are returned with full text

### Requirement: getContent supports chunked reading

The system SHALL accept optional `fromIndex` and `toIndex` parameters on `getContent()` to return a slice of the document. Both are inclusive.

#### Scenario: Read a chunk

- **WHEN** `getContent({ fromIndex: 10, toIndex: 20 })` is called
- **THEN** only blocks with index 10 through 20 are returned

#### Scenario: fromIndex without toIndex

- **WHEN** `getContent({ fromIndex: 50 })` is called
- **THEN** all blocks from index 50 to the end of the document are returned

### Requirement: getContent annotates tracked changes inline

When `includeTrackedChanges` is true (the default), tracked change text SHALL be annotated inline in the `text` field: insertions as `[+text+]{by:author}`, deletions as `[-text-]{by:author}`.

#### Scenario: Tracked changes visible

- **WHEN** `getContent()` is called on a document where paragraph 5 has a deletion "30 days" and insertion "60 days" both by Jane
- **THEN** paragraph 5's text reads: `'...notice period of [-30 days-]{by:Jane} [+60 days+]{by:Jane}...'`

#### Scenario: Tracked changes hidden

- **WHEN** `getContent({ includeTrackedChanges: false })` is called
- **THEN** text fields show current visible text only (insertions as plain text, deletions excluded)

### Requirement: getContent annotates comments inline

When `includeCommentAnchors` is true (the default), commented text SHALL be annotated as `[comment:id]anchored text[/comment]`.

#### Scenario: Comments visible

- **WHEN** `getContent()` is called on a document where comment 3 is anchored to "indemnification cap"
- **THEN** the paragraph's text reads: `'...the [comment:3]indemnification cap[/comment] shall not exceed...'`

### Requirement: DocxReviewer construction

The system SHALL provide `DocxReviewer.fromBuffer(buffer)` static async factory and `new DocxReviewer(document, originalBuffer?)` constructor. The constructor SHALL deep-clone the document. `toBuffer()` SHALL throw if no `originalBuffer` was provided.

#### Scenario: Create from buffer

- **WHEN** `DocxReviewer.fromBuffer(buffer)` is called with a valid DOCX buffer
- **THEN** a `DocxReviewer` instance is returned and `getContent()` works immediately

#### Scenario: Original document not mutated

- **WHEN** operations are performed on the reviewer and `toDocument()` is called
- **THEN** the original document passed to the constructor is unchanged

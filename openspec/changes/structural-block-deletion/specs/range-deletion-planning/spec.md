## ADDED Requirements

### Requirement: A range deletion removes the tables it fully contains

Planning the deletion of a document-ordered range SHALL remove, with `deleteBlock`, every `w:tbl` whose every descendant paragraph lies fully inside the range, and SHALL emit no `deleteText` for the paragraphs inside such a table. A paragraph counts as fully inside the range when it lies strictly between the endpoints, or is the first paragraph with the range starting at offset zero, or is the last paragraph with the range ending at its length. A table only partially covered SHALL keep today's behavior: its covered text clears and its structure stays.

The plan SHALL order its operations as text removals, then block removals, then joins, so each join sees the sibling sequence the block removals leave behind.

#### Scenario: Select All then Delete empties the document

- **WHEN** the whole of a document holding paragraphs and tables is selected and deleted
- **THEN** the document holds exactly one empty paragraph, no table, and one page

#### Scenario: A partially covered table survives

- **WHEN** a range starts in a body paragraph and ends inside the third row of a table
- **THEN** the covered text clears, the table keeps all of its rows and cells, and no `deleteBlock` is planned for it

#### Scenario: Joins reach across a removed table

- **WHEN** a range covers a paragraph, a whole table, and the paragraph after it
- **THEN** the table is removed and the two paragraphs join into one, because removing the table makes them adjacent siblings

#### Scenario: A block this lane does not own is still a boundary

- **WHEN** a range spans a block-level container the canonical tree keeps generic — a `w:sdt`, say — because content controls are a deferred lane
- **THEN** the container is not removed, its paragraphs are emptied, and it remains a join boundary, so one empty paragraph is left beside it
- **AND** a table holding a paragraph layout never emitted is emptied rather than removed, because the range cannot be said to have covered a paragraph the user could not see selected

### Requirement: The plan names where the caret lands

Planning a range deletion SHALL return the surviving position the caret collapses to alongside its operations. The survivor SHALL be the range's first paragraph, unless that paragraph sits inside a table the plan removes, in which case the first covered paragraph outside every removed table SHALL be promoted and the collapse position SHALL be its offset zero. When every covered paragraph sits inside one table, that table SHALL NOT be removed — it is emptied instead — because nothing else could host the caret.

Every caller that deletes a selection and then addresses a position SHALL use the plan's collapse position rather than the range's start, because an operation addressing a paragraph the same transaction removed is refused, and one refused operation vetoes the whole transaction.

#### Scenario: A leading table is removed and the caret moves on

- **WHEN** a document that starts with a table is fully selected and deleted
- **THEN** the table is removed, the first paragraph after it survives, and the caret sits at its offset zero

#### Scenario: A document that is only a table keeps it

- **WHEN** a document whose only content is one table is fully selected and deleted
- **THEN** the table's cells are emptied, the table remains, and the caret sits in its first cell

#### Scenario: Pasting over a table-spanning selection lands the text

- **WHEN** text is pasted over a selection that covers a leading table and the paragraphs after it
- **THEN** the table is removed and the pasted text appears in the surviving paragraph

#### Scenario: Typing over a table-spanning selection lands the text

- **WHEN** a character is typed over a selection whose first paragraph sits inside a removed table
- **THEN** the character appears in the promoted survivor rather than the transaction being refused

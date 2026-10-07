## ADDED Requirements

### Requirement: Paragraph inline content is one shared text

The system SHALL store the inline content of each paragraph as one shared text, with each non-text inline element as an embedded reference to a registry node.

#### Scenario: Seeding a document

- **WHEN** a room is created from a document
- **THEN** every paragraph's characters are characters of that paragraph's shared text, in document order
- **AND** every other inline element is one embed whose node keeps the element's exact subtree

#### Scenario: Round trip

- **WHEN** a room is seeded from any corpus document and materialized without edits
- **THEN** the canonical fingerprint and the save/reopen semantic digest equal those of the original document

### Requirement: Concurrent typing survives a concurrent deletion

The system SHALL delete only the characters an author's replica held when the author deleted them.

#### Scenario: Typing inside a run a peer deletes whole

- **WHEN** one peer deletes a selection that covers a whole run and another peer types inside that run at the same time
- **THEN** every replica shows the typed characters, with that run's formatting, between the text around the deletion

### Requirement: Formatting merges by property for each character

The system SHALL store each run property as its own attribute on each character.

#### Scenario: Different properties on the same text

- **WHEN** one peer makes text bold and another peer makes overlapping text italic at the same time
- **THEN** each character shows every property that either peer applied to it

#### Scenario: The same property set twice

- **WHEN** two peers set the same property of the same character to different values at the same time
- **THEN** every replica shows the same one of the two values

### Requirement: A character shows once

The system SHALL show each character of shared paragraph text at most once in the materialized document.

#### Scenario: Concurrent splits and undo

- **WHEN** peers split, format, and undo in one run in any order and delivery
- **THEN** every replica shows each character once, and no later edit in that text is refused

### Requirement: Run boundaries and exact properties survive

The system SHALL keep a document's run boundaries, run attributes, the order of run properties, and text element boundaries through editing that does not change them.

#### Scenario: Equal formatting in separate runs

- **WHEN** a document holds two adjacent runs with equal properties but different revision save IDs
- **THEN** the saved document still holds two runs with their own IDs

### Requirement: Rooms of the earlier format migrate

The system SHALL refuse to synchronize with a room of the earlier collaboration format and SHALL let the host seed a new room generation from that room's document.

#### Scenario: Opening an earlier room

- **WHEN** a host opens a room created by an earlier release
- **THEN** the session reports `collaboration-format-mismatch` before any update enters the room
- **AND** `readCollaborationDocument` returns that room's document for seeding a new generation

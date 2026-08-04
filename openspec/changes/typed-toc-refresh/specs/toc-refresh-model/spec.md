## ADDED Requirements

### Requirement: Bounded TOC field detection

The engine SHALL discover body TOC complex fields that span paragraphs, including fields wrapped in a block content control and bare fields, without executing field instructions.

#### Scenario: SDT-wrapped TOC is detected

- **WHEN** a block `w:sdt` contains a complex field whose instruction keyword is `TOC` with `begin`/`separate`/`end` spanning multiple paragraphs
- **THEN** detection returns one TOC identity covering that field and preserves the instruction text and field chrome node identities

#### Scenario: Bare cross-paragraph TOC is detected

- **WHEN** a TOC complex field spans multiple body paragraphs without an SDT wrapper
- **THEN** detection returns one TOC identity for that field

#### Scenario: Hostile instructions stay inert

- **WHEN** a field instruction is not a TOC keyword, exceeds the instruction length cap, or nests beyond the nesting cap
- **THEN** it is not treated as a refreshable TOC and is never executed

### Requirement: Entry generation from outline

Refresh of the entire table SHALL replace TOC result paragraphs from the canonical document outline, honouring `\o` level range when present, and SHALL ensure bookmark targets for hyperlinked entries.

#### Scenario: Entries follow outline levels

- **WHEN** `replaceTocResult` runs for a TOC with `\o "1-2"`
- **THEN** only outline levels 0 and 1 (Heading 1–2) produce TOC entry paragraphs styled `TOC1`/`TOC2`

#### Scenario: Bookmarks are preserved or created

- **WHEN** an outline heading lacks a `_Toc…` bookmark and the instruction includes `\h`
- **THEN** a bounded new bookmark is allocated on that heading and TOC hyperlinks use its name

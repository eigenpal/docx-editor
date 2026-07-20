## ADDED Requirements

### Requirement: Anchor-based addressing

A caller SHALL name a location in a document using `DocAnchor`, comprising a `paraId` (the `w14:paraId` of the containing paragraph) and an optional `search` phrase within that paragraph. Addressing SHALL NOT require a character offset computed by the caller.

#### Scenario: Anchor names a paragraph

- **WHEN** a caller supplies `{ paraId }` with no `search`
- **THEN** the target SHALL be the whole paragraph bearing that `paraId`

#### Scenario: paraId is matched case-insensitively

- **WHEN** a caller supplies a `paraId` differing only in hexadecimal letter case from the stored value
- **THEN** it SHALL match

#### Scenario: paraId does not exist

- **WHEN** a caller supplies a `paraId` present in no paragraph
- **THEN** the operation SHALL fail with code `notFound` and SHALL NOT modify the document

### Requirement: Search phrases must be unique

When `search` is supplied, it SHALL match exactly once within the addressed paragraph. Ambiguity SHALL be an error. The implementation SHALL NOT silently select the first match.

#### Scenario: Search matches exactly once

- **WHEN** `search` matches one position in the paragraph
- **THEN** the target SHALL be that span

#### Scenario: Search matches more than once

- **WHEN** `search` matches two or more positions and `occurrence` is not supplied
- **THEN** the operation SHALL fail with code `ambiguous` and SHALL NOT modify the document

#### Scenario: Search matches nothing

- **WHEN** `search` matches no position in the addressed paragraph
- **THEN** the operation SHALL fail with code `notFound` and SHALL NOT modify the document

#### Scenario: Caller disambiguates explicitly

- **WHEN** `search` matches multiple positions and `occurrence` is supplied
- **THEN** the target SHALL be the match at that index

### Requirement: Structural addressing for unreachable content

Content that carries no `paraId` SHALL be addressable via `DocLocation`, comprising a `ContainerRef` and a path of block indices, with an optional character offset.

#### Scenario: Addressing content in a header

- **WHEN** a caller supplies `{ container: { part: 'header', rId }, path }`
- **THEN** the target SHALL resolve within that header part rather than the body

#### Scenario: Addressing a nested table cell

- **WHEN** a caller supplies a path descending through a table into a cell
- **THEN** the target SHALL resolve to the addressed block within that cell

#### Scenario: Path leaves the document

- **WHEN** a path index exceeds the number of blocks at that level
- **THEN** the operation SHALL fail with code `outOfBounds`

### Requirement: Addresses are JSON-safe

`DocAnchor`, `DocLocation`, `ContainerRef`, and `DocRange` SHALL be plain JSON-serializable values, holding no object references, class instances, or live document handles.

#### Scenario: Address crosses a process boundary

- **WHEN** an address is serialized to JSON, transmitted, and parsed by another process
- **THEN** it SHALL address the same location, given the same document

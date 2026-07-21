## ADDED Requirements

### Requirement: Citations are first-class durable annotations
A citation SHALL have a stable annotation ID, one or more internal range
anchors, source metadata, display/formatting metadata, creation and update
provenance, and optional external source identifiers. It MUST NOT exist only as
rendered text or editor plugin state.

#### Scenario: Citation survives reopen
- **WHEN** a citation is created, exported to DOCX, and reopened
- **THEN** its identity, anchors, source metadata, and visible representation MUST be equivalent

### Requirement: Annotation kinds share anchor infrastructure
Comments, tracked changes, citations, bookmarks, and presence ranges SHALL use
the same internal edit-surviving anchor primitives while retaining kind-specific
schemas, permissions, histories, and serialization rules.

#### Scenario: Concurrent insertion inside annotated range
- **WHEN** text is concurrently inserted at an annotation boundary
- **THEN** inclusion in the range MUST follow the stored anchor affinity consistently for every replica

### Requirement: Citation source metadata is structured
Citation metadata SHALL support source type, title, contributors, dates,
publisher/container, locators, identifiers, authored raw URL, sanitized runtime
URL projection, access date, locale, and extension metadata through a versioned
schema. Unknown metadata and raw URLs MUST be preserved inertly across lossless
round-trip. Only sanitized projections MAY reach navigation/fetch sinks.

#### Scenario: Source URL is unsafe
- **WHEN** citation metadata contains a disallowed URL scheme or control-character obfuscation
- **THEN** runtime navigation MUST reject it while validated XML serialization preserves its escaped authored form unless explicit non-lossless scrub export removes it

### Requirement: Navigation resolves through current anchors
The object model, query API, display list, and editor SHALL expose navigation
from citation marker to anchored content and source metadata, and from a
bibliography entry to referencing citations. Navigation MUST resolve against the
current revision rather than cached paragraph indices.

#### Scenario: Cited paragraph moves
- **WHEN** a paragraph containing a citation is moved to another section
- **THEN** navigation MUST follow its retained identity and anchor to the new location

### Requirement: Deletion and ambiguity are explicit
Each annotation kind MUST define behavior when all or part of its range is
deleted, split, joined, replaced, or rendered ambiguous. The engine SHALL
collapse, detach, tombstone, or delete according to that rule and MUST NOT
silently reattach to unrelated text.

#### Scenario: Entire citation marker is deleted
- **WHEN** an edit removes the complete anchored citation marker
- **THEN** the citation MUST enter its declared detached/tombstoned state or be deleted atomically, with source records retained or collected by explicit policy

### Requirement: Comments and tracked changes are semantic state
The engine SHALL store comment threads, replies, status, authorship, dates, and
tracked insert/delete/format/structural revisions in canonical authored state.
When collaboration is enabled, the replication backend MUST mirror that
canonical semantic state in its model-shaped replicated representation.
Tracked operations MUST require explicit author identity and honor accept,
reject, lock, and permission rules.

#### Scenario: Tracked structural change spans stories
- **WHEN** an authorized command proposes a structural change involving a body node and relationship part
- **THEN** its revision metadata and package mutations MUST commit atomically and replicate together

### Requirement: Annotation operations use the common API
The engine SHALL expose create, read, update, delete, navigate, search, accept,
reject, and source-edit operations through `DocxEditor.*`, JSON command/query
schemas, and server RPC over the common result taxonomy and transactions.

#### Scenario: Locked control contains a citation
- **WHEN** a caller attempts to edit citation metadata or range inside a locked content control
- **THEN** the operation MUST return `locked` without changing annotation or document state

### Requirement: Annotation output is anchored and deterministic
Layout SHALL emit anchored display items for visible markers, highlights,
comment indicators, revision marks, citation text, bibliography entries, and
navigation links. DOM and PDF backends MUST preserve equivalent annotation
geometry and destinations where the format supports them.

#### Scenario: Citation link is exported to PDF
- **WHEN** a citation marker links to a bibliography entry
- **THEN** PDF output MUST include the visible marker and an internal navigation destination derived from the same display-list anchors

### Requirement: Citation OOXML ownership is explicit
The citation capability MUST define a versioned OOXML persistence profile:
marker representation, stable annotation-ID encoding, source/bibliography part
location, relationship ownership, content-type records, ordering, namespace
bindings, and preservation behavior for unsupported citation fields. It MUST
declare which bytes/records the capability owns and MUST preserve unowned
citation-related XML.

#### Scenario: Citation and bibliography round-trip
- **WHEN** a citation is inserted, its surrounding paragraph is edited, DOCX is selectively saved, and the file is reopened
- **THEN** marker ID, source record, bibliography ownership, relationships, anchors, display text, and every unowned byte MUST satisfy the citation comparator

### Requirement: Citation equivalence comparator is canonical
Citation equivalence MUST compare stable ID, normalized source metadata,
unknown-field preservation, anchor resolution and affinity, marker/source
ownership, bibliography membership/order, navigation destination, and authored
OOXML records. Rendered text equality alone MUST NOT establish equivalence.

#### Scenario: Rendered citation text matches but source differs
- **WHEN** two citations render identically but have different source identifiers
- **THEN** the comparator MUST report them as non-equivalent

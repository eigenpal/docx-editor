## ADDED Requirements

### Requirement: Authored package state is canonical
The spike SHALL represent its one body story, paragraphs, text, bold and italic marks, stable paragraph identities, authored omission, raw lexical values, and one unsupported OOXML capsule in an authored canonical model. Resolved formatting or layout values MUST remain derived data with revision provenance and dependency/input fingerprints; cross-revision reuse is allowed only when fingerprints and the immutable operation environment match. Derived values MUST NOT replace authored values.

#### Scenario: Derived values do not normalize authored state
- **WHEN** the spike resolves formatting and lays out a paragraph whose property is omitted or stored with a raw lexical value
- **THEN** the canonical model and a subsequent export retain the authored omission or raw lexical value rather than materializing the resolved value

### Requirement: Selective export preserves unsupported content
Before gate execution the spike MUST freeze the capsule's exact input bytes,
byte boundaries, owning paragraph-child slot, captured namespace bindings, and
previous/next sibling bytes. The serializer SHALL patch only the owned edited
text bytes and MUST preserve the capsule and every unowned byte byte-for-byte.

#### Scenario: Edited text leaves an unsupported capsule untouched
- **WHEN** a semantic text operation changes a supported paragraph and selective export runs
- **THEN** the exact uncompressed XML-part comparator MUST limit differences to the owned range while the semantic ZIP comparator MAY allow recompression metadata/CRC/size/offset/directory changes, and capsule, namespace, sibling position, and unowned XML bytes MUST remain identical

### Requirement: Stable paragraph identity follows edit rules
The spike model SHALL preserve paragraph identity across insertion and deletion, SHALL retain the original identity on the first fragment after split, SHALL mint a new identity for the tail, and SHALL retain the first surviving identity after join.

#### Scenario: Split and join preserve deterministic identity
- **WHEN** a paragraph is split and the resulting paragraphs are joined
- **THEN** the first fragment keeps the original identity, the split tail receives a new identity, and the join keeps the first surviving identity

### Requirement: The facade has one public namespace
The spike SHALL expose its familiar Office JavaScript-style facade only as `DocxEditor.*` and MUST NOT declare another public namespace or alias.

#### Scenario: Facade entry points are inspected
- **WHEN** the spike's public facade declarations and schema-backed command entry points are enumerated
- **THEN** every facade entry is rooted at `DocxEditor.*` and no alternate namespace or alias is present

## ADDED Requirements

### Requirement: Canonical ordered OOXML tree
The system SHALL represent each authored OOXML part as one ordered tree in which supported elements are typed nodes and unsupported elements are generic nodes in the same child sequence.

#### Scenario: Known and unknown siblings load together
- **WHEN** a paragraph contains a supported run beside an unsupported namespace-qualified element
- **THEN** the canonical tree contains both nodes in source order without creating a second preservation model

### Requirement: Generic unknown-node fidelity
Generic nodes SHALL retain qualified names, namespace bindings, ordered attributes, ordered element/text children, and stable identity subject to bounded parse and trust rules.

#### Scenario: Unsupported content survives a paragraph edit
- **WHEN** supported text adjacent to a generic subtree is edited and saved
- **THEN** normalized output preserves the generic subtree's structural content and relative order

### Requirement: Derived semantic indexes
Paragraph, story, relationship, and style lookup structures SHALL be derived from a specific canonical-tree revision and SHALL NOT be mutation or serialization authority.

#### Scenario: Index is rebuilt
- **WHEN** a committed operation invalidates a paragraph index entry
- **THEN** rebuilding the index from the same tree revision yields the same semantic identity and content

### Requirement: Atomic semantic mutation
The `DocumentStore` SHALL accept authored changes only as validated `DocOp`s against stable semantic identities and SHALL atomically publish a new tree revision and `ModelChange`.

#### Scenario: Invalid operation has no effect
- **WHEN** a `DocOp` targets a missing paragraph or violates a tree invariant
- **THEN** the operation is rejected without changing the revision, tree, indexes, or notifications

### Requirement: Normalized OOXML serialization
Save SHALL serialize escaped, normalized OOXML from the committed canonical tree and SHALL NOT read ProseMirror, layout, DOM, or derived semantic indexes as authored state.

#### Scenario: Save and reopen paragraph
- **WHEN** a supported paragraph edit is saved and the produced package is reopened
- **THEN** both the namespace-aware canonical tree fingerprint and save/reopen semantic digest pass

### Requirement: Namespace-aware canonical tree fingerprint
The repository SHALL own a normalized XML oracle that fingerprints namespace URI plus local name, ordered significant element/text children, and attributes as an order-insensitive set keyed by namespace URI plus local name. It SHALL ignore prefix choice, attribute order, insignificant inter-element whitespace, quote style, and empty-element spelling.

#### Scenario: Lexically different normalized XML is equivalent
- **WHEN** two OOXML trees differ only in namespace prefixes, attribute ordering, insignificant inter-element whitespace, quote style, or empty-element spelling
- **THEN** their canonical tree fingerprints are equal

#### Scenario: Significant child order changes
- **WHEN** two OOXML trees contain the same significant children in a different order
- **THEN** their canonical tree fingerprints are different

### Requirement: Save-reopen semantic digest
Normalized serialization SHALL also pass a save/reopen digest over supported paragraph identities, content tokens, accepted run and paragraph properties, and preserved generic-node structure.

#### Scenario: One oracle detects semantic loss
- **WHEN** either canonical fingerprinting or the reopened semantic digest detects a mismatch
- **THEN** serialization conformance fails even if the other oracle passes

### Requirement: Bounded untrusted input
Tree parsing and serialization SHALL enforce finite package/XML limits, safe part and relationship paths, no external entity expansion, no implicit external fetch, and escaped attacker-controlled output.

#### Scenario: Malicious package is rejected
- **WHEN** a package exceeds a mandatory limit or contains an unsafe traversing part path
- **THEN** parsing fails before publishing any canonical model

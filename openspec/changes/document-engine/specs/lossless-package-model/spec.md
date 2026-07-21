## ADDED Requirements

### Requirement: Bounded OPC and XML trust boundary
The engine SHALL treat every package entry and XML value as untrusted. It MUST
reject absolute or traversing part paths, conflicting duplicate entries,
excessive compressed/decompressed size or ratio, unsafe recursion and element
counts, DTDs, external entities, and unbounded entity expansion before canonical
state is committed.

#### Scenario: Malicious package is rejected
- **WHEN** a package contains a traversing path, zip-bomb ratio, external entity, or resource limit violation
- **THEN** opening MUST fail with a typed trust-boundary error and MUST perform no file or network read outside the package

### Requirement: Fidelity-preserving XML ingestion
The XML reader SHALL preserve significant child order, namespaces, attributes,
whitespace, and lexical values without numeric or boolean coercion. Model
construction MUST occur only through registered capability parsers.

#### Scenario: Lexical authored values survive parsing
- **WHEN** an XML part contains preserved whitespace, zero-padded values, omitted properties, and extension elements
- **THEN** the authored model MUST retain enough information to reproduce those distinctions

### Requirement: Authored package state is canonical
Canonical state SHALL contain editable stories, authored properties including
explicit omission and raw values, stable part and relationship identities,
content types, media, and ordered preservation capsules. Resolved styles,
numbering, fields, and layout inputs MUST exist only in fingerprinted derived
caches carrying revision provenance.

#### Scenario: Inherited formatting is not materialized
- **WHEN** layout resolves an inherited style and the document is saved without changing that property
- **THEN** serialization MUST preserve the authored inheritance or omission and MUST NOT write the resolved value as direct formatting

### Requirement: Unsupported content is preserved
The model MUST retain unknown or unsupported elements, attributes, parts,
relationships, and significant ordering in ownership-scoped preservation
capsules. A semantic edit MUST invalidate only capsules whose owned region it
replaces.

#### Scenario: Unsupported capsule round-trips
- **WHEN** a supported paragraph is edited beside unsupported package content
- **THEN** export and reopen MUST preserve the unsupported content and its owned ordering while applying the paragraph edit

### Requirement: Stable package and content identities
The model MUST assign or preserve stable IDs for stories, blocks, paragraphs,
tables, rows, cells, required runs, parts, relationships, controls, bookmarks,
comments, revisions, and annotations. Split SHALL retain the first fragment ID,
join SHALL retain the first survivor ID, move SHALL retain identity, replacement
SHALL mint identity, and undo SHALL restore deleted identity.

#### Scenario: Split and undo preserve identity rules
- **WHEN** a paragraph is split and the split is undone
- **THEN** the first fragment MUST retain the original ID, the tail MUST receive a new ID, and undo MUST restore the original unsplit identity

### Requirement: Semantic coverage of package stories and relationships
The package model SHALL represent body, sections, headers, footers, notes,
comments, text boxes, tables, content controls and locking, tracked changes,
images, media, relationships, styles, numbering, themes, and fields sufficiently
for semantic editing and faithful serialization.

#### Scenario: Image insertion is package-complete
- **WHEN** an image is inserted into a header
- **THEN** one transaction MUST create the story node, media part, relationship, and content-type state required for a valid package

### Requirement: Safe relationships and inert executable content
Raw relationship and citation targets MUST remain authored. Validated XML
serialization is not a runtime sink and MAY XML-escape raw lexical targets back
into owned OOXML. Runtime DOM, CSS, navigation, preview, and fetch sinks SHALL
receive only a separate allowlist-sanitized projection. External
resources MUST NOT be fetched on open. Only allowlisted pure internal fields MAY
be evaluated; unsupported fields, macros, ActiveX, OLE, embedded objects, and
executable relationships MUST be preserved inertly by default with no semantic
exposure, execution, or fetch. An explicit scrub export MAY remove declared
classes but MUST identify itself as non-lossless and report removals. Parser
intermediates MUST use null-prototype records and reject
prototype-polluting keys recursively before capability dispatch or merge.

#### Scenario: External target does not auto-load
- **WHEN** a relationship targets a remote image, font, or document
- **THEN** parsing MUST retain a safe inert representation and MUST NOT issue a network request

### Requirement: Selective and complete serialization
Serialization SHALL escape attacker-controlled XML, validate part and
relationship targets, regenerate changed ownership regions deterministically,
and preserve eligible untouched parts byte-for-byte. The engine MUST support
full DOCX export and selective save from both opened and newly created models.

#### Scenario: Selective save changes only owned parts
- **WHEN** one body paragraph changes without affecting styles or relationships
- **THEN** selective save MUST regenerate the necessary document part and MUST preserve unrelated eligible package parts byte-for-byte

#### Scenario: Create from scratch
- **WHEN** a caller creates an empty document and inserts content
- **THEN** DOCX export MUST produce a valid minimal OPC package that reopens to an equivalent authored model

### Requirement: OPC and relationship references use explicit profiles
ZIP names, OPC part names, and internal relationship targets MUST use one
normalization algorithm that rejects NUL/control
characters, backslashes, drive/UNC forms, percent-encoded separators and dot
segments, absolute forms, and traversal. Allowed URI percent encoding and dot
segments SHALL then normalize canonically. Duplicate normalized names MUST be
rejected before inflation or model commit; internal targets MUST resolve relative
to the owner without escaping package root. External-mode targets MUST follow a
separate absolute-URI lexical profile, remain authored, and MUST NOT be
owner-resolved or fetched implicitly.

#### Scenario: Two entries normalize to one name
- **WHEN** two archive names differ lexically but collide after allowed normalization
- **THEN** the package MUST be rejected before either entry is inflated

### Requirement: Relationship and content-type records are authored
Each relationship record MUST retain owner part, authored relationship ID,
relationship type, raw target lexical form, target mode, and significant order.
Content types MUST retain ordered Default and Override records, extensions, part
names, MIME values, and lexical form. Extension matching MUST be ASCII
case-insensitive after removing the leading dot. Duplicate identical Defaults
or Overrides MAY be preserved when untouched; conflicting duplicates MUST make
semantic resolution ambiguous and block owned edits until explicit repair.
Overrides MUST take precedence over Defaults. Invalid MIME syntax, duplicate
normalized Override names, and conflicting applicable records MUST fail closed.
Orphan records MAY be preserved inertly when untouched but MUST NOT determine a
part type; owned create/delete MUST add/remove only its declared record unless an
explicit cleanup operation is requested.

#### Scenario: Relationship round-trips unchanged
- **WHEN** unrelated content is edited
- **THEN** unchanged relationship IDs, raw targets, target modes, types, owner association, order, and content-type records MUST remain identical

#### Scenario: Conflicting Defaults address one extension
- **WHEN** two Default records normalize to the same extension with different MIME values
- **THEN** semantic type resolution and owned edits MUST fail with an ambiguity diagnostic while untouched records remain preservable

### Requirement: Selective save preserves unowned bytes inside changed parts
Selective save MUST patch only byte ranges owned by changed semantic records and
MUST preserve unowned prefixes, whitespace, attribute order, unknown siblings,
namespace declarations, capsules, and lexical bytes within the same XML part.
Whole-region regeneration is lossless only when complete ownership and an exact
oracle were captured; otherwise the operation MUST fail safely or use an
explicit non-lossless fallback result.

#### Scenario: Paragraph changes beside unknown sibling
- **WHEN** one owned text range changes in a part containing an unowned sibling
- **THEN** the exact uncompressed XML-part comparator MUST allow changes only in the owned range while preserving the sibling byte-for-byte, and the semantic ZIP comparator MUST allow recompression metadata, CRC, sizes, offsets, and directory records to change without requiring compressed-byte identity

### Requirement: XML serialization separates names from values
Serializer-generated element and attribute names MUST be validated QNames with
controlled namespace bindings; they MUST NOT be escaped as values. Attribute and
text values MUST be XML-escaped, URIs validated, and capsule bytes reinserted
only with captured namespace context, ownership boundary, and sibling position.

#### Scenario: Capsule prefix depends on ancestor namespace
- **WHEN** a capsule uses an ancestor-declared prefix
- **THEN** reinsertion MUST preserve or safely recreate the binding without changing capsule bytes or introducing an unbound QName

### Requirement: DOM and CSS sinks are string-safe
File-derived content MUST NOT reach `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, or equivalent HTML-from-string sinks.
DOM output SHALL use element creation, attributes, and `textContent`.
CSS-bound strings MUST use CSS string escaping; CSS `url()` and imports MUST be
rejected unless an explicit authorized resource action supplies safe bytes.

#### Scenario: Malicious font family reaches output
- **WHEN** a font family contains quotes, escapes, markup, or a CSS URL token
- **THEN** DOM, print, and PDF preparation MUST preserve inert text without HTML execution or network access

### Requirement: Resource defaults are finite and hard ceilings cannot be disabled
Every package/XML limit MUST have typed units, a finite configurable default, a
non-disableable hard ceiling, overflow-safe accounting, enforcement phase, and
typed failure. Time and memory tests MUST use deterministic work/allocation
counters in addition to wall-clock observation. Cancellation MUST release
buffers and spill files.

#### Scenario: Limit N and N plus one
- **WHEN** a fixture consumes exactly N units and a paired fixture consumes N+1
- **THEN** N MUST follow configured policy, N+1 MUST fail before over-allocation, and integer overflow MUST fail closed

### Requirement: Security and fidelity are tested in one workflow
The corpus MUST include one import-edit-selective-export-reopen fixture combining
same-part capsules, authored omission/raw values, relationships/content types,
unsafe URLs, inert unsupported fields, macros, ActiveX, OLE, embedded objects,
executable relationships, CSS strings, XML injection, and no-fetch probes.

#### Scenario: Combined adversarial round-trip
- **WHEN** the fixture is opened, edited in an owned range, selectively exported, and reopened
- **THEN** semantic edits, exact uncompressed owned/unowned XML ranges, semantic ZIP contents, authored executable records, XML validity, sink safety, and zero filesystem/network access MUST all satisfy their comparators

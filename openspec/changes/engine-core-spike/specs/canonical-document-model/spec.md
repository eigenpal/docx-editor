## ADDED Requirements

### Requirement: Authored package state is canonical for the POC paragraph
The POC SHALL represent one body story with one editable paragraph, text, bold
and italic marks, stable paragraph identity, and one unsupported OOXML capsule in
an authored canonical projection. Resolved formatting values MUST remain derived
data used only for inspection and save projection; they MUST NOT replace authored
values on export.

#### Scenario: Derived values do not normalize authored state
- **WHEN** the POC resolves formatting for display or save projection
- **THEN** the canonical store and subsequent save retain authored intent for the
  owned paragraph rather than materializing unrelated resolved values into OOXML

### Requirement: Minimal DOCX adapter enforces a mandatory trust boundary
The POC minimal DOCX adapter SHALL treat loaded bytes as untrusted. It MUST cap
ZIP decompression ratio and part sizes, reject entry paths with `..` or a leading
`/`, use parser-neutral XML reads that do not resolve DTDs or external entities,
reject external relationship targets, and XML-escape every attacker-derived string
written back into `word/document.xml`.

#### Scenario: Traversal path is rejected
- **WHEN** a DOCX entry path contains `..` or begins with `/`
- **THEN** load fails before any XML is parsed or emitted

#### Scenario: External relationship is rejected
- **WHEN** a relationship target requires external fetch or traversal outside the
  bounded package
- **THEN** load fails closed

#### Scenario: DTD or oversized part is rejected
- **WHEN** a part exceeds configured bounds or declares a DTD/external entity
  surface
- **THEN** load fails closed with no partial model commit

### Requirement: Unsupported capsule bytes are preserved exactly
The POC fixture SHALL include one unsupported OOXML capsule with deterministic
bytes. Save SHALL patch only the owned editable paragraph range in
`word/document.xml` and MUST preserve the capsule and every unowned byte
byte-for-byte.

#### Scenario: Edited paragraph leaves capsule untouched
- **WHEN** text or formatting changes in the owned paragraph and save runs
- **THEN** capsule bytes and all bytes outside the owned paragraph range remain
  identical to the loaded source

#### Scenario: Reopen preserves capsule and semantics
- **WHEN** the saved DOCX is loaded again through the same adapter
- **THEN** reopened text, bold/italic coverage, stable paragraph identity, and
  capsule bytes match the saved intent

### Requirement: Stable paragraph identity follows POC edit rules
The POC model SHALL preserve one stable paragraph identity across load, edit,
format toggles, save, and reopen for the single editable paragraph.

#### Scenario: Save and reopen retain paragraph identity
- **WHEN** the POC saves and reopens the fixture
- **THEN** the editable paragraph retains the same stable identity established at
  initial load

### Requirement: Deterministic fixture generation
The POC SHALL generate one standards-minimal deterministic DOCX fixture in memory
with exactly one editable paragraph and one unsupported capsule so Playwright and
unit tests share the same bytes.

#### Scenario: Fixture bytes are reproducible
- **WHEN** `createPocDocxFixture()` is invoked twice in a clean process
- **THEN** both results produce identical byte sequences

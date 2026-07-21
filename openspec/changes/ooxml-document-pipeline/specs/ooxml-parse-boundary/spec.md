## ADDED Requirements

### Requirement: fast-xml-parser reads every XML part

The pipeline SHALL parse every XML OPC part with `fast-xml-parser`, and SHALL NOT
use any other XML or DOM parser on any runtime. This covers `document.xml`,
`styles.xml`, `numbering.xml`, `theme*.xml`, `header*.xml`, `footer*.xml`, and
`*.rels`.

#### Scenario: A document part is parsed

- **WHEN** the pipeline reads `word/document.xml`
- **THEN** it SHALL produce the parsed node tree through `fast-xml-parser`, and
  SHALL NOT call a browser `DOMParser` or a second XML library

#### Scenario: Headless runtime parses the same part

- **WHEN** the pipeline runs on a server or worker with no DOM
- **THEN** the same part SHALL parse through the same `fast-xml-parser`
  configuration and SHALL produce an equivalent node tree

### Requirement: Parser configured for OOXML fidelity

The parser SHALL be configured so no OOXML-significant information is lost between
bytes and node tree: element order preserved, attributes retained, text values
neither trimmed nor coerced.

#### Scenario: Order-significant children

- **WHEN** a `w:p` contains runs and other children in a specific order
- **THEN** the parsed tree SHALL preserve that order (`preserveOrder`)

#### Scenario: Preserved whitespace

- **WHEN** a `w:t` carries `xml:space="preserve"` with leading or trailing spaces
- **THEN** the parsed value SHALL retain those spaces (values are not trimmed)

#### Scenario: Zero-padded and numeric-looking attribute values

- **WHEN** an attribute value is `"0100"`, `"000000"`, or `"00"`
- **THEN** the parsed value SHALL remain the original string and SHALL NOT be
  coerced to a number

### Requirement: XML trust boundary is hardened

The parse boundary SHALL reject the malicious-input classes for XML before a node
tree is built.

#### Scenario: External entity / DTD

- **WHEN** a part declares a DOCTYPE, external entity, or external DTD reference
- **THEN** the parser SHALL NOT resolve it, so no file or network read occurs
  (no XXE)

#### Scenario: Entity expansion

- **WHEN** a part defines nested or recursive internal entities
- **THEN** entity expansion SHALL be bounded so it cannot exhaust memory or CPU
  (no billion-laughs)

#### Scenario: Zip and path safety before parse

- **WHEN** the OPC container exceeds a decompression-ratio or total-size cap, or
  a part path contains `..` or a leading `/`
- **THEN** the container SHALL be rejected before that part is parsed

### Requirement: Model construction only through capability parsers

Parsed XML nodes SHALL reach the document model only through
`NodeCapability.parse`. The parse boundary is the single place a file-derived
value is sanitized.

#### Scenario: A file-derived hyperlink target

- **WHEN** a capability parser reads a hyperlink or image relationship target
- **THEN** the target SHALL pass through `sanitizeHref`, and an external
  `TargetMode` relationship SHALL NOT be fetched during parse

#### Scenario: A field instruction

- **WHEN** a capability parser encounters a field code (for example `INCLUDE*`,
  DDE)
- **THEN** it SHALL be represented inertly and SHALL NOT be executed or resolved

#### Scenario: An unregistered content type

- **WHEN** a part contains an element whose type has no registered capability
- **THEN** the element SHALL be skipped and the rest of the part SHALL still
  parse, so core parses a file whose feature is not installed

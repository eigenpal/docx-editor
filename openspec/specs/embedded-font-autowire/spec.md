# embedded-font-autowire Specification

## Purpose
TBD - created by archiving change font-resolution-overhaul. Update Purpose after archive.
## Requirements
### Requirement: Embedded fonts reach shaped measurement automatically

The editor SHALL extract and deobfuscate fonts a loaded document's package embeds
(`word/fontTable.xml` embed relationships) and include them as shaping font
sources for that document without any host configuration. Extraction
SHALL assert nothing about validity; admission SHALL occur only through the existing
font-resource validation (HarfBuzz validator plus per-face, source-count, and
aggregate byte caps).

#### Scenario: Zero-config document with embedded fonts shapes accurately
- **WHEN** an editor is created without `config.fonts` and loads a DOCX that embeds a
  valid font family used by its body text
- **THEN** after fonts resolve, measurement for runs in that family uses the shaped
  (HarfBuzz) measurer backed by the embedded bytes, not the fixed measurer

#### Scenario: Malformed embedded face degrades that face only
- **WHEN** a document embeds one valid face and one face the validator rejects
- **THEN** the valid face is admitted, the rejected face is dropped, a typed
  `EditorFontError` is reported through `onFontError`, and runs requesting the
  rejected face measure via fallback

#### Scenario: Embedded bytes never bypass hard caps
- **WHEN** a document embeds a font part exceeding the per-face byte cap
- **THEN** that face is not admitted and the failure is reported as `overLimit`

### Requirement: Embedded style keys map to canonical face requests

Embedded style slots SHALL map to `FontFaceRequest` as: regular → weight 400/normal,
bold → 700/normal, italic → 400/italic, boldItalic → 700/italic. Each admitted
embedded source SHALL carry a `sha256:` content hash computed from its deobfuscated
bytes and `faceIndex` 0.

#### Scenario: Bold-italic embed resolves for bold-italic runs
- **WHEN** a document embeds only the boldItalic slot of family F and a run is styled
  F + bold + italic
- **THEN** the resolver returns the embedded face for that run's request

### Requirement: Explicit sources take precedence over embedded faces

The explicit source SHALL win when `config.fonts` supplies a source whose family,
weight, and style collide with an embedded face. Embedded faces SHALL fill only requests
no explicit source satisfies. Substitutions SHALL apply only when neither an explicit
nor an embedded direct match exists.

#### Scenario: App-supplied face overrides document embed
- **WHEN** `config.fonts` contains family F regular and the document also embeds
  family F regular with different bytes
- **THEN** shaping for F regular uses the explicit source's bytes (identified by its
  hash), and no duplicate-face error occurs

#### Scenario: Embedded face beats substitution
- **WHEN** a substitution F→G is configured and the document embeds family F
- **THEN** requests for F resolve to the embedded F face, not to G

### Requirement: Composition resolves in one remount per load

Per document load, the editor SHALL compose all font origins (explicit configuration
and embedded faces) into one immutable shaping configuration and SHALL swap from the
fixed measurer to the shaped measurer with at most one tree-preserving remount.
Edits made before fonts resolve SHALL survive the remount.

#### Scenario: Single remount with both origins present
- **WHEN** an editor with `config.fonts` loads a document that also embeds fonts
- **THEN** exactly one shaped remount occurs for that load, and the resulting
  measurer covers both origins

#### Scenario: Pre-resolution edits survive
- **WHEN** the user types while fonts are still resolving for a document with
  embedded fonts
- **THEN** after the shaped remount the typed content is present in the tree

### Requirement: Failure lands on the fixed measurer

The editor SHALL continue on the fixed measurer, remain fully editable, and report
the failure through `onFontError` if embedded-font extraction, validation, or
HarfBuzz initialization fails entirely; it SHALL NOT throw out of `load()` for font
reasons.

#### Scenario: Corrupt fontTable does not block opening
- **WHEN** a document's embedded font parts are all corrupt
- **THEN** the document opens and edits normally on the fixed measurer and each
  failure is reported as a typed error


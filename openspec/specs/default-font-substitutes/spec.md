# default-font-substitutes Specification

## Purpose
TBD - created by archiving change font-resolution-overhaul. Update Purpose after archive.
## Requirements
### Requirement: Package provides metric-compatible substitutes as a configuration fragment

The `@docx-editor.dev/fonts` package SHALL export `loadDefaultFonts(options?)`
returning a Promise of a configuration fragment `{ sources, substitutions }` covering
metric-compatible OFL substitutes for Word default families: Carlito (for Calibri),
Caladea (for Cambria), Liberation Serif (for Times New Roman), Liberation Sans (for
Arial), and Liberation Mono (for Courier New), each in regular, bold, italic, and
bold-italic faces. The substitution map SHALL target the substitute family from the
Word family name so documents naming Word defaults resolve without host mapping.

#### Scenario: Calibri document measures via Carlito
- **WHEN** an app composes `loadDefaultFonts()` output into its `FontConfiguration`
  and loads a document whose runs request Calibri
- **THEN** the resolver substitutes Carlito faces and those runs measure via the
  shaped measurer

#### Scenario: Family narrowing loads only requested assets
- **WHEN** `loadDefaultFonts({ families: ['Times New Roman'] })` is called
- **THEN** only Liberation Serif face assets are fetched and only its sources and
  substitution entries are returned

### Requirement: Assets are lazy, hashed, and license-complete

Font binaries SHALL ship as separate bundler-fingerprinted assets fetched only when
their family is requested; the package's JavaScript entry SHALL NOT inline font
bytes. Every returned source SHALL carry a build-time-computed `sha256:` hash that CI
verifies against the shipped bytes. The package SHALL include the OFL license texts
for all bundled fonts.

#### Scenario: Hash matches shipped bytes
- **WHEN** the CI hash check runs against the built package
- **THEN** every source's recorded hash equals `sha256FontBytes` of its shipped asset

#### Scenario: No fetch without opt-in
- **WHEN** an app imports the package but never calls `loadDefaultFonts`
- **THEN** no font asset request is made

### Requirement: Core takes no dependency on the fonts package

`@docx-editor.dev/core` SHALL NOT import from `@docx-editor.dev/fonts`. The fragment
SHALL compose through the public configuration surface (`composeFontConfiguration`)
like any other source of `FontSource`s, with explicit app-supplied sources taking
precedence over substitute sources.

#### Scenario: Explicit brand font beats substitute
- **WHEN** a composed configuration contains an explicit Calibri source and the
  substitute fragment
- **THEN** Calibri runs resolve to the explicit source and the Calibri→Carlito
  substitution is not applied


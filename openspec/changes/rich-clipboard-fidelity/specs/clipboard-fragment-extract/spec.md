## ADDED Requirements

### Requirement: Range extraction produces a minimal fragment package

The engine SHALL extract a covered selection into a self-contained, valid
WordprocessingML fragment package. The fragment SHALL contain the covered
block subtrees, with edge paragraphs trimmed to the range and runs split at
the range offsets, and SHALL record, per edge paragraph, whether the range
covers its paragraph mark. The dependency closure SHALL be computed over
every story that travels, including footnote and endnote bodies: used style
definitions including `basedOn`/`link`/`next` chains, used numbering
definitions resolved after the style cascade, media parts and rels for
covered drawings, hyperlink rels, referenced footnote and endnote bodies, and
bookmarks fully inside the range. The fragment SHALL NOT carry header or
footer parts, any `w:sectPr`, comments or comment markers, settings, or theme
parts. The fragment's styles part SHALL carry the source's theme-literalized
docDefaults solely as the materialization source; the merge SHALL never
install them as the target's defaults. Unbalanced bookmark markers SHALL be dropped;
hyperlinks and fields whose anchor targets are outside the range SHALL travel
unchanged.

#### Scenario: Select-all extraction of the sample document body

- **WHEN** the full body of the demo sample document is extracted
- **THEN** the fragment contains every body block subtree losslessly,
  including tables, list paragraphs, hyperlinks, drawings with their media
  bytes, and block SDTs
- **AND** the style and numbering closures cover every travelling story,
  including styles referenced only inside footnote and endnote bodies
- **AND** no header, footer, `w:sectPr`, comment, settings, or theme content
  is present

#### Scenario: Partial edge paragraphs are trimmed to the range

- **WHEN** the range starts mid-run in one paragraph and ends mid-run in a
  later paragraph
- **THEN** the first and last fragment paragraphs contain only the in-range
  text, with run properties preserved on the split runs, and neither edge
  paragraph is marked as having a covered paragraph mark

#### Scenario: Extraction round-trips through the bounded package reader

- **WHEN** an extracted fragment package is serialized and read back through
  the bounded OPC/XML reader
- **THEN** the reader accepts it and reproduces the same canonical block
  subtrees

### Requirement: Partial coverage keeps compound constructs balanced

The extractor SHALL keep compound constructs balanced. A complex field whose
`w:fldChar` begin and end are not both inside the range SHALL contribute
only its cached result runs; a fully covered field, including `w:fldSimple`,
SHALL travel intact. A partially covered inline SDT
SHALL contribute its covered runs without the SDT wrapper; a fully covered
inline SDT SHALL travel intact. Revision wrappers (`w:ins`, `w:del`) inside
the range SHALL travel lossless with author and date preserved, and edge
trimming SHALL split runs inside a revision wrapper without breaking the
wrapper.

#### Scenario: A range that cuts a complex field carries the cached result

- **WHEN** the range covers the middle of a complex field but not both its
  begin and end field characters
- **THEN** the fragment carries the field's cached result runs and no
  unbalanced `w:fldChar` or `w:instrText` content

#### Scenario: A partially covered inline content control unwraps

- **WHEN** the range ends inside an inline SDT
- **THEN** the fragment carries the covered runs without the SDT wrapper

#### Scenario: Tracked content travels with attribution

- **WHEN** the range covers runs inside a `w:ins` wrapper and starts mid-run
- **THEN** the fragment keeps the wrapper with its author and date, and the
  trimmed run stays inside it

### Requirement: Block coverage follows the caller-supplied coverage decision

The extractor SHALL take the coverage decision as data computed by the
editing surface with the same predicate the range-deletion planner uses:
ordered covered blocks, the set of fully covered tables and block SDTs, and
the edge offsets. A fully covered table or block SDT SHALL travel as a
lossless subtree. A partially covered table SHALL travel as a table of the
covered rows when the coverage is row-aligned, with a `w:vMerge` continuation
in the first extracted row promoted to a merge restart, and otherwise SHALL
flatten the covered cell paragraphs into plain paragraphs.

#### Scenario: Fully covered table travels as a subtree

- **WHEN** the coverage decision marks a table as fully covered
- **THEN** the fragment contains the table as one subtree with grid, row, and
  cell properties intact

#### Scenario: Row-aligned coverage restarts a vertical merge

- **WHEN** the covered rows start on a row whose cell continues a vertical
  merge from an uncovered row
- **THEN** the extracted first row carries a `w:vMerge` restart

#### Scenario: Non-aligned partial table coverage flattens

- **WHEN** the range covers part of a table that is not a whole run of rows
- **THEN** the fragment contains the covered cell paragraphs as plain
  paragraphs in document order

### Requirement: Source-resolved defaults materialize as direct formatting

The clipboard lane SHALL materialize source-resolved default formatting as
direct formatting. Where pasted content resolves a formatting value from
source docDefaults, the source default paragraph style, or a theme
reference, and neither the content nor its travelling style chain carries
that value, the source-resolved value SHALL be written as direct formatting
at merge time — theme references literalized at extraction, the
docDefaults/default-style delta stamped against the target's own resolved
defaults — so the pasted content keeps its appearance in a target whose
defaults and theme differ.
Content that carries the value explicitly SHALL NOT receive redundant direct
formatting.

#### Scenario: Unstyled text keeps its face in a different-default target

- **WHEN** an unstyled paragraph whose font resolves from source docDefaults
  is extracted and pasted into a target with different docDefaults
- **THEN** the pasted runs carry the source-resolved font and size as direct
  formatting and render unchanged

#### Scenario: Explicit formatting is not duplicated

- **WHEN** a run already carries an explicit font in its run properties
- **THEN** extraction adds no additional direct formatting for that value

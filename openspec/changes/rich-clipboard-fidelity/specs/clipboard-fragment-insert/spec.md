## ADDED Requirements

### Requirement: insertFragment applies a fragment atomically

The store SHALL provide an `insertFragment` tree op that inserts fragment
blocks at a paragraph position inside one transaction. The op payload SHALL
carry blocks only; the resource merge SHALL apply through the package-edit
path inside the same transaction, and the whole commit SHALL be promoted to a
package undo unit so undo reverts the tree and the imported resources
together. A merged edge paragraph SHALL take the properties of the paragraph
mark that ends it: the fragment's first paragraph mark for the leading merge,
and the host's original mark for the trailing merge. A single-paragraph
fragment whose source paragraph mark was not covered SHALL leave the host
paragraph properties unchanged. Whole tables and block SDTs SHALL insert as
sibling blocks. Inserted nodes SHALL receive fresh node ids. An invalid
fragment SHALL refuse the whole transaction with a typed rejection; the op
SHALL NOT partially apply.

#### Scenario: Mid-paragraph paste assigns paragraph marks like Word

- **WHEN** a two-paragraph fragment with covered paragraph marks is inserted
  at a mid-paragraph offset
- **THEN** the leading merged paragraph takes the fragment's first-paragraph
  properties, and the trailing merged paragraph keeps the host paragraph's
  properties

#### Scenario: Undo reverts the imported resources

- **WHEN** the user undoes a fragment paste that imported styles, numbering,
  and media
- **THEN** the document tree and the imported package parts both revert

#### Scenario: Invalid fragment refuses atomically

- **WHEN** a fragment contains a block deeper than the recursion cap
- **THEN** the transaction is refused with a typed rejection and the document
  is unchanged

### Requirement: Resource merge remaps identifiers without collision

Applying a fragment SHALL merge its resources into the target package. Style
definitions SHALL reuse an existing target style id when the definition
fingerprints match, and otherwise SHALL be imported under a fresh id with
references rewritten in fragment content and in other imported definitions;
an imported style whose `w:name` collides with a different target definition
SHALL receive a derived unique name. Numbering ids SHALL always be remapped
to fresh target ids, with definitions deduped by a fingerprint that includes
level and start overrides. Relationship ids SHALL be freshly allocated. Media
parts SHALL be deduped by content hash and named collision-free; a drawing
that references non-media parts the fragment does not carry SHALL be omitted
rather than shipped with a dangling relationship. Every
document-unique id namespace the fragment carries — bookmark ids, drawing
`docPr` ids, SDT ids, revision ids — SHALL be freshened, and a bookmark name
collision SHALL resolve in favor of the pasted bookmark.

#### Scenario: Sample body pastes into a blank document verbatim

- **WHEN** the extracted full body of the demo sample document is inserted
  into a blank document
- **THEN** the body, footnote, and endnote story canonical fingerprints of
  source and target match under the change's defined normalization
- **AND** a sampled set of paragraphs compares equal on resolved run and
  paragraph appearance, not only on authored markup

#### Scenario: Conflicting style imports under a fresh id and name

- **WHEN** the target defines a style whose id or name matches a fragment
  style with a different definition fingerprint
- **THEN** the fragment's style is imported under a fresh id with a derived
  unique name, and the pasted content references the fresh id

### Requirement: Note transfer provisions and renumbers target note parts

When a fragment carries footnote or endnote bodies, the merge SHALL provision
the target's footnotes or endnotes parts when they are absent, including the
separator and continuation-separator notes, content-type registration, and
part relationships, and SHALL remap note ids collision-free so pasted
references renumber in the target sequence.

#### Scenario: Footnotes paste into a document without a footnotes part

- **WHEN** a fragment carrying footnote bodies is inserted into a target with
  no footnotes part
- **THEN** the merge creates a valid footnotes part with separator notes, the
  pasted references resolve to the transferred bodies, and the note numbers
  follow the target sequence

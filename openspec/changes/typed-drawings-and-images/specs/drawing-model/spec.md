## ADDED Requirements

### Requirement: Drawings are typed canonical nodes in both anchoring forms

The canonical tree SHALL type `w:drawing` and its two children, `wp:inline` (`CT_Inline`) and `wp:anchor` (`CT_Anchor`), including `wp:extent`, `wp:effectExtent`, `wp:docPr`, `wp:cNvGraphicFramePr`, and the distance attributes. `CT_Anchor` SHALL additionally type `@simplePos`, `@relativeHeight`, `@behindDoc`, `@locked`, `@layoutInCell`, `@allowOverlap`, `wp:simplePos`, `wp:positionH`, `wp:positionV`, and the wrap element.

#### Scenario: Inline drawing types

- **WHEN** a `w:drawing` containing `wp:inline` is loaded
- **THEN** it is a typed inline drawing carrying its extent, effect extent, and `wp:docPr`

#### Scenario: Anchored drawing types

- **WHEN** a `w:drawing` containing `wp:anchor` is loaded, as the comprehensive fixture's one floating image
- **THEN** every anchor attribute above is typed, including `@relativeHeight="952500"`, `@behindDoc="0"`, `@allowOverlap="1"`, and `@layoutInCell="1"`

#### Scenario: Unedited round trip

- **WHEN** all eleven drawings in the comprehensive fixture are loaded and serialized without an edit
- **THEN** each matches its input by canonical tree fingerprint, including `wp:effectExtent` and the empty `a:srcRect`

### Requirement: The picture payload is typed, and non-picture graphics are not faked

`CT_Picture` SHALL be typed: `pic:nvPicPr`, `a:blip` with `r:embed` or `r:link`, `a:srcRect` (`CT_RelativeRect`), the fill mode, `a:xfrm` including rotation and `@flipH` / `@flipV`, and `a:prstGeom`. A `w:drawing` whose graphic data is not a picture SHALL remain a typed drawing with a `generic` graphic payload.

#### Scenario: Picture types

- **WHEN** a drawing's graphic data is a `pic:pic`
- **THEN** its blip, source rectangle, transform, and geometry are typed

#### Scenario: Empty source rectangle means no crop

- **WHEN** `a:srcRect` is present and empty, as it is on all eleven drawings in the comprehensive fixture
- **THEN** no crop is applied
- **AND** serializing re-emits the empty element rather than dropping it or filling in zeros

#### Scenario: Chart or diagram reserves its extent

- **WHEN** a drawing's graphic data is a chart, a diagram, a group, or a text box
- **THEN** it is a typed drawing with a generic graphic payload, it reserves its declared `wp:extent`, and it paints a placeholder
- **AND** it is NOT reported as a supported picture

#### Scenario: Placeholder is honest

- **WHEN** a placeholder is painted for an unsupported graphic
- **THEN** it is visually distinguishable from a rendered image and carries the reason

### Requirement: Alt text is preserved as authored

`wp:docPr/@descr` and `@name` SHALL be preserved exactly as authored and exposed for reading and writing. They SHALL NOT be normalised, trimmed to a length, or generated.

#### Scenario: Alt text round-trips

- **WHEN** a drawing declares `@name="banner"` and `@descr="Test banner"`
- **THEN** both survive an unedited round trip

#### Scenario: Missing alt text is not invented

- **WHEN** a drawing declares no `@descr`
- **THEN** saving does not add one

### Requirement: Embedded media is resolved, validated, and bounded

Media SHALL be resolved from the package part named by `r:embed` through the existing safe-target relationship rules. The decoded bytes SHALL be validated against the part's declared content type, and dimension and byte-size limits SHALL be enforced **before** any allocation sized by a file-supplied number.

#### Scenario: Embedded PNG resolves

- **WHEN** a drawing's `r:embed` names a PNG part in the package
- **THEN** the bytes are read from that part and painted

#### Scenario: Content type mismatch

- **WHEN** a part declared as PNG does not decode as one
- **THEN** the drawing reserves its extent and paints a placeholder, and the document still loads

#### Scenario: Oversized media is refused before allocation

- **WHEN** a media part declares dimensions or a decompressed size beyond the configured bound
- **THEN** it is refused before an allocation sized by that number is made, and a placeholder is painted

#### Scenario: Traversal in a relationship target

- **WHEN** a media relationship target contains `..` or a leading `/`
- **THEN** it is refused by the existing safe-target rules and no part outside the package is read

#### Scenario: One media part, several drawings

- **WHEN** three drawings reference `rId14`, as the comprehensive fixture's do
- **THEN** the part is decoded once and shared, and deleting one drawing does not remove the part while another still references it

### Requirement: No image causes a network or filesystem fetch

A `r:link` relationship, a `TargetMode="External"` image relationship, or any remote reference inside a drawing SHALL NOT be fetched at load, layout, paint, or save. The relationship SHALL be preserved, the drawing SHALL reserve its extent, and a placeholder SHALL be painted stating that the image is external.

#### Scenario: Linked image is not fetched

- **WHEN** a document containing a `r:link` image is loaded, laid out, painted, and saved
- **THEN** no network request and no filesystem read outside the package is made
- **AND** the relationship survives the round trip

#### Scenario: External-mode relationship is not fetched

- **WHEN** an image relationship declares `TargetMode="External"`
- **THEN** the same rule applies regardless of the URL's scheme or host

#### Scenario: Placeholder explains itself

- **WHEN** an external image's placeholder is painted
- **THEN** it states that the image is external and was not loaded, so the user is not left thinking the file is corrupt

#### Scenario: Loading an image later is an explicit action

- **WHEN** a user explicitly asks to load an external image
- **THEN** the fetch is gated on that gesture, the URL is validated against the allowlisted schemes, and it never happens automatically on open

### Requirement: Drawing hyperlinks are sanitized and require a gesture

`a:hlinkClick` on a drawing SHALL be preserved and its target sanitized. Activation SHALL require an explicit user gesture and an allowlisted scheme.

#### Scenario: Unsafe scheme is not navigable

- **WHEN** a drawing's `a:hlinkClick` names a `javascript:`, `data:`, `vbscript:`, or `file:` target
- **THEN** activation is refused
- **AND** the authored value is preserved, escaped, on save

#### Scenario: Safe target requires a click

- **WHEN** a drawing carries an `https:` hyperlink
- **THEN** nothing is opened on load, layout, or paint, and navigation happens only on an explicit activation

### Requirement: Image operations commit through the store

`TreeDocOp` SHALL include insert-image, replace-image, delete-image, resize-image, set-image-crop, set-image-alt-text, set-wrap-mode, and set-anchor-position. Each SHALL validate and commit atomically.

#### Scenario: Insert adds part, override, and relationship

- **WHEN** insert-image runs with image bytes
- **THEN** the media part, its `[Content_Types].xml` override, its relationship, and the drawing node are added in one transaction
- **AND** the part name does not collide with an existing part

#### Scenario: Insert validates before writing

- **WHEN** insert-image is given bytes that do not decode as a supported format
- **THEN** it is refused with `invalidArgs` and no part, override, or relationship is written

#### Scenario: Delete collects an orphaned part

- **WHEN** the last drawing referencing a media part is deleted
- **THEN** the part, its override, and its relationship are removed in the same transaction

#### Scenario: Delete keeps a shared part

- **WHEN** one of three drawings referencing the same part is deleted
- **THEN** the part is kept

#### Scenario: Resize and crop never re-encode

- **WHEN** resize-image or set-image-crop runs
- **THEN** only `wp:extent` and `a:srcRect` change, and the media part's bytes are byte-identical afterwards

#### Scenario: Impact class is honest

- **WHEN** an image operation changes an extent or a wrap mode
- **THEN** the published `ModelChange` carries an impact class no narrower than `flow-structural`

### Requirement: Drawings satisfy both D9 oracles

Parts containing drawings SHALL pass the canonical tree fingerprint on an unedited round trip and the save/reopen semantic digest after an image operation. Non-XML media parts SHALL be byte-identical unless the operation replaced them.

#### Scenario: Media parts are untouched by an unrelated edit

- **WHEN** a document is loaded, a body paragraph is edited, and the package is saved
- **THEN** all four PNG parts are byte-identical to the input

#### Scenario: Resized image reopens equivalent

- **WHEN** an image is resized, saved, and reopened
- **THEN** the digest reports the new extent, the unchanged crop, the unchanged alt text, and byte-identical media

### Requirement: Drawing identifiers are allocated unique, non-zero, and in range

Allocation SHALL seed from the maximum drawing id already present in the document, plus one, and SHALL NOT derive an id from a clock, timestamp, random source, or hash. It SHALL never allocate `0`.

`wp:docPr/@id` is `ST_DrawingElementId` — `xsd:unsignedInt`, so `0` to `4294967295` — and it is **required**. Word additionally expects it unique within the document and treats `0` as invalid; a package where every drawing carries `id="0"` renders only one image.

Relationship ids for new media SHALL likewise be allocated from the existing relationship ids of the target part, and SHALL NOT be a clock or random value.

#### Scenario: Seeded from the document

- **WHEN** an image is inserted into a document whose highest `wp:docPr/@id` is 11
- **THEN** the allocated id is 12, not a clock-derived value

#### Scenario: Never zero

- **WHEN** a drawing id is allocated
- **THEN** it is greater than zero

#### Scenario: Duplicate ids on load do not become duplicate ids on save

- **WHEN** a loaded package carries `id="0"` on every drawing — the template-engine case
- **THEN** every drawing still renders
- **AND** ids authored by this engine are unique, without silently rewriting the loaded ones on an unedited round trip

#### Scenario: Exported ids stay inside unsignedInt

- **WHEN** a package containing engine-authored drawings is saved and opened in Word
- **THEN** it opens without a repair prompt
- **AND** a conformance test asserts the bound directly

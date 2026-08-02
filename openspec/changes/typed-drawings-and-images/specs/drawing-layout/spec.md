## ADDED Requirements

### Requirement: An inline drawing occupies its extent in the line

An inline drawing SHALL occupy `wp:extent` in the line, participate in line breaking as an unbreakable item, and align on the text baseline as Word does. `@distL` and `@distR` SHALL apply as horizontal spacing.

#### Scenario: Inline image reserves space

- **WHEN** a paragraph contains an inline drawing of 381000×381000 EMU
- **THEN** the line reserves that width and height, and following text starts after it

#### Scenario: Image too wide for the remaining space

- **WHEN** an inline drawing does not fit in the space left on the line
- **THEN** it moves to the next line rather than overflowing the content box

#### Scenario: Image taller than the line

- **WHEN** an inline drawing is taller than its line's text
- **THEN** the line's height grows to contain it and following lines are pushed down

#### Scenario: Image wider than the content box

- **WHEN** an inline drawing's extent exceeds the available content width
- **THEN** it is laid out at the declared extent and the overflow behaviour is defined and consistent, not left to whichever clip happens to apply

#### Scenario: Distance insets apply

- **WHEN** a drawing declares `@distL` or `@distR`
- **THEN** that spacing separates it from adjacent inline content

### Requirement: An anchored drawing resolves against its declared frames

An anchored drawing SHALL resolve `wp:positionH` against its `ST_RelFromH` frame and `wp:positionV` against its `ST_RelFromV` frame, honouring both the `wp:align` and the `wp:posOffset` choice.

#### Scenario: Margin-relative right alignment

- **WHEN** an anchor declares `positionH relativeFrom="margin"` with `wp:align`=right, as the comprehensive fixture's floating image does
- **THEN** its right edge sits at the right margin

#### Scenario: Paragraph-relative vertical offset

- **WHEN** an anchor declares `positionV relativeFrom="paragraph"` with `wp:posOffset`=0
- **THEN** its top sits at the top of its anchoring paragraph

#### Scenario: Page-relative positioning is page-relative

- **WHEN** an anchor declares a page-relative frame
- **THEN** it is positioned against the page, not against the anchoring paragraph, on whichever page its anchor lands

#### Scenario: layoutInCell inside a table

- **WHEN** an anchor with `@layoutInCell="1"` is anchored inside a table cell
- **THEN** its frames resolve against the cell
- **AND** with `@layoutInCell="0"` they resolve against the page or margin as declared

#### Scenario: Unsupported frame falls back visibly

- **WHEN** a positioning frame is one layout does not resolve
- **THEN** the drawing is placed by a declared fallback and the fallback is reported as a layout reason, not applied silently

### Requirement: Wrap modes produce exclusion zones the text flows around

The wrap element SHALL determine how surrounding text flows. `wrapNone` produces no exclusion. `wrapSquare` excludes the drawing's bounding box plus its distance insets, on the side or sides `ST_WrapText` names. `wrapTight` and `wrapThrough` exclude their declared polygon. `wrapTopAndBottom` excludes the full content width for the drawing's vertical band.

#### Scenario: Square wrap on both sides

- **WHEN** a drawing declares `wrapSquare` with `ST_WrapText` of `bothSides`
- **THEN** text flows on both sides of its exclusion box

#### Scenario: Square wrap on one side

- **WHEN** `ST_WrapText` is `left` or `right`
- **THEN** text flows only on that side and the other side is left empty

#### Scenario: Distance insets widen the exclusion

- **WHEN** a wrapped drawing declares `@distL="114300"`
- **THEN** the exclusion zone is wider than the drawing by that inset

#### Scenario: Top and bottom wrap

- **WHEN** a drawing declares `wrapTopAndBottom`
- **THEN** no text sits beside it; the full content width is excluded for its vertical band

#### Scenario: wrapNone overlaps text

- **WHEN** a drawing declares `wrapNone`
- **THEN** text flows as if the drawing were absent and the drawing paints over or under it per `@behindDoc`

#### Scenario: Exclusion is a layout input, not a paint effect

- **WHEN** a wrapped drawing is present
- **THEN** line breaking accounts for the exclusion when measuring available width, so text is not painted under the drawing and then clipped

### Requirement: Paint order follows behindDoc and relativeHeight

`@behindDoc` SHALL place a drawing behind or in front of the text layer, and `@relativeHeight` SHALL order anchored drawings among themselves. `@allowOverlap` SHALL govern whether two anchored drawings may occupy the same space.

#### Scenario: Behind text

- **WHEN** a drawing declares `@behindDoc="1"`
- **THEN** it paints behind the text layer and the text is legible over it

#### Scenario: In front of text

- **WHEN** a drawing declares `@behindDoc="0"`, as the comprehensive fixture's floating image does
- **THEN** it paints in front of the text layer

#### Scenario: Two anchored drawings

- **WHEN** two anchored drawings would occupy the same space
- **THEN** the one with the greater `@relativeHeight` paints on top
- **AND** where `@allowOverlap="0"`, the later drawing is displaced instead of overlapping

#### Scenario: Paint order does not change layout

- **WHEN** paint order is resolved
- **THEN** no exclusion zone or line break changes as a result

### Requirement: An anchored object never sizes a header or footer box

A header or footer box SHALL be sized by its story's flow height. An anchored drawing's extent, position, or effect extent SHALL NOT enlarge it.

#### Scenario: Anchored letterhead in a header

- **WHEN** a header contains an anchored drawing positioned page-relative and extending well below the header's text
- **THEN** the header box is still sized by the story's flow height
- **AND** the body content area is not pushed down by the drawing's extent

#### Scenario: Drawing still paints

- **WHEN** such a drawing extends beyond the header box
- **THEN** it paints where its anchor places it, without the box growing to contain it

### Requirement: Drawings participate in semantic interaction

A drawing SHALL be selectable and hit-testable through semantic layout records, not through painted DOM geometry, and SHALL have a defined position in the caret space.

#### Scenario: Click selects the drawing

- **WHEN** a pointer event lands on a painted drawing
- **THEN** the hit test resolves to that drawing and selects it as a unit

#### Scenario: Caret steps over an inline drawing

- **WHEN** the caret moves across an inline drawing with an arrow key
- **THEN** it steps over it as one unit rather than landing inside it

#### Scenario: Anchored drawing is not in the text caret path

- **WHEN** the caret moves through the paragraph anchoring a floating drawing
- **THEN** it traverses only the text, and the drawing is reached by clicking or by an explicit selection command

#### Scenario: Selecting a range containing an inline drawing

- **WHEN** a selection spans text and an inline drawing
- **THEN** the drawing is included, and deleting the range removes the drawing with the text in one transaction

### Requirement: Unrenderable formats reserve space and say so

TIFF, EMF, WMF, and any format the runtime cannot decode SHALL reserve their declared extent and paint a placeholder carrying the reason. They SHALL NOT paint a broken-image indicator, collapse to zero size, or be omitted.

#### Scenario: EMF reserves its extent

- **WHEN** a document contains an EMF image
- **THEN** its declared extent is reserved so surrounding text lays out as it would in Word, and a placeholder is painted

#### Scenario: Placeholder does not claim support

- **WHEN** a placeholder is painted for an undecodable format
- **THEN** it names the format, so the state is diagnosable rather than looking like a rendering bug

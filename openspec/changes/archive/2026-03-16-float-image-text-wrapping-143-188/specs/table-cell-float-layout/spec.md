## ADDED Requirements

### Requirement: Floating images in table cells SHALL be positioned at their anchor offsets

Floating images (`wp:anchor`) inside table cells SHALL be rendered at their specified position offsets (`positionH`, `positionV`) relative to the cell's content area, instead of as centered block elements.

#### Scenario: Floating image with explicit offset in cell

- **WHEN** a table cell contains a floating image with `positionH posOffset=0` and `positionV posOffset=0` relative to column
- **THEN** the image SHALL be rendered at position (0, 0) within the cell's content area, not as a centered block

#### Scenario: Floating image with alignment in cell

- **WHEN** a table cell contains a floating image with `positionH align="right"` relative to column
- **THEN** the image SHALL be rendered at the right edge of the cell's content area

### Requirement: Table cells SHALL extract floating images into a cell-level floating layer

Floating images inside table cells SHALL be extracted from inline paragraph runs and rendered in a dedicated absolutely-positioned layer within the cell, mirroring the page-level floating image layer.

#### Scenario: Cell with floating image and text

- **WHEN** a table cell contains a paragraph with a `wrapSquare` floating image and surrounding text
- **THEN** the image SHALL be rendered in a cell-level floating layer (absolutely positioned within the cell)
- **AND** the image SHALL NOT be rendered as a block element in the paragraph flow

#### Scenario: Cell with inline image (no change)

- **WHEN** a table cell contains an inline image (`wp:inline`)
- **THEN** the image SHALL continue to render inline with text (no behavior change)

### Requirement: Text in table cells SHALL wrap around floating images

Paragraph text inside a table cell SHALL wrap around floating images within that cell, using the cell's content width as the container boundary.

#### Scenario: wrapSquare in table cell

- **WHEN** a table cell has content width 300px and contains a `wrapSquare` floating image of width 80px at x=0
- **THEN** text lines overlapping with the image SHALL have available width reduced to 300px - 80px - distRight
- **AND** text SHALL start at offsetX = 80px + distRight within the cell

#### Scenario: wrapTopAndBottom in table cell

- **WHEN** a table cell contains a `wrapTopAndBottom` floating image
- **THEN** text SHALL be pushed entirely below the image within the cell
- **AND** the cell height SHALL expand to accommodate the displaced text

#### Scenario: wrapText modes in table cell

- **WHEN** a table cell contains a floating image with `wrapText="left"`
- **THEN** text SHALL only flow on the left side of the image, matching page-level behavior

### Requirement: Cell-level FloatingObjectManager SHALL use cell content width as container

Each table cell with floating images SHALL create its own `FloatingObjectManager` instance, initialized with the cell's content width (after accounting for cell margins/padding).

#### Scenario: Cell floating object manager scoping

- **WHEN** a table cell has content width 250px and contains a floating image
- **THEN** the cell's `FloatingObjectManager` SHALL use contentWidth=250px for available width calculations
- **AND** the exclusion zone SHALL NOT extend beyond the cell boundary

#### Scenario: Multiple cells with floating images

- **WHEN** two cells in the same row each contain floating images
- **THEN** each cell SHALL have its own independent `FloatingObjectManager`
- **AND** floating images in cell A SHALL NOT affect text wrapping in cell B

### Requirement: Floating images in cells SHALL NOT escape the cell boundary

Floating images positioned inside table cells SHALL be clipped to or constrained within the cell's content area. Images SHALL NOT overlap adjacent cells or extend outside the table.

#### Scenario: Image positioned beyond cell width

- **WHEN** a floating image in a cell has posOffset that would place it beyond the cell's right edge
- **THEN** the image SHALL be clamped to remain within the cell's content area

#### Scenario: Cell overflow with overflow hidden

- **WHEN** a cell contains a floating image layer
- **THEN** the cell's floating layer SHALL have `overflow: hidden` to prevent visual bleed into adjacent cells

### Requirement: Cross-paragraph wrapping SHALL work within cells

A floating image anchored in one paragraph within a cell that extends past that paragraph SHALL affect subsequent paragraphs in the same cell.

#### Scenario: Tall image in multi-paragraph cell

- **WHEN** a cell contains 3 paragraphs and paragraph 1 has a floating image that extends into paragraphs 2 and 3
- **THEN** paragraphs 2 and 3 SHALL have their line widths reduced by the image's exclusion zone within the cell

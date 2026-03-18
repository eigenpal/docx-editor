## ADDED Requirements

### Requirement: Text lines SHALL reduce width where they vertically overlap with floating image exclusion zones

When a paragraph contains or is adjacent to a floating image with `wrapSquare`, `wrapTight`, or `wrapThrough` wrap type, the measurement phase SHALL query the `FloatingObjectManager` for each line's available width based on the line's Y position on the page. Lines SHALL be broken at the reduced width, not full paragraph width.

#### Scenario: wrapSquare image on left side with text wrapping on right

- **WHEN** a floating image with `wrapSquare wrapText="right"` is positioned at x=0, y=0 with width=150px, height=120px
- **THEN** text lines whose Y range overlaps [0, 120px] SHALL have their available width reduced by 150px + distRight, and lines SHALL start at offsetX = 150px + distRight
- **AND** text lines below y=120px + distBottom SHALL render at full paragraph width with offsetX = 0

#### Scenario: wrapSquare image on right side with text wrapping on left

- **WHEN** a floating image with `wrapSquare wrapText="left"` is positioned at x=300px with width=140px
- **THEN** text lines whose Y range overlaps the image SHALL have their right boundary reduced to 300px - distLeft
- **AND** lines SHALL start at offsetX = 0 (left-aligned as normal)

#### Scenario: wrapSquare with bothSides

- **WHEN** a floating image with `wrapSquare wrapText="bothSides"` is positioned in the middle of the content area
- **THEN** text lines SHALL render on both sides of the image where there is sufficient space
- **AND** if there is not enough space on one side (less than minimum wrappable width), text SHALL flow only on the wider side

#### Scenario: wrapSquare with largest mode

- **WHEN** a floating image with `wrapSquare wrapText="largest"` is positioned off-center
- **THEN** text SHALL flow only on the side with the larger available width

### Requirement: wrapTopAndBottom SHALL push text entirely below the image

When a floating image has `wrapTopAndBottom` wrap type, no text SHALL appear on either side of the image. Text SHALL resume below the image's bottom edge plus distBottom.

#### Scenario: wrapTopAndBottom basic behavior

- **WHEN** a floating image has `wrapTopAndBottom` and occupies y=[50, 150] on the page
- **THEN** all text lines that would overlap with y=[50 - distTop, 150 + distBottom] SHALL be displaced below y=150 + distBottom
- **AND** no text SHALL appear to the left or right of the image in the overlapping Y range

#### Scenario: wrapTopAndBottom with paragraph starting above image

- **WHEN** a paragraph starts above a `wrapTopAndBottom` image and extends past it
- **THEN** lines above the image render at full width, lines in the image's Y range are skipped, and lines resume below the image at full width

### Requirement: Wrap distances SHALL be applied to exclusion zones

The `distTop`, `distBottom`, `distLeft`, `distRight` attributes on floating images SHALL be added to the exclusion zone boundaries, creating padding between the image and surrounding text.

#### Scenario: Custom wrap distances

- **WHEN** a floating image has distLeft=20px, distRight=20px, distTop=10px, distBottom=10px
- **THEN** the exclusion zone SHALL be expanded by these distances: text must stay 20px from left/right edges and 10px from top/bottom edges of the image

### Requirement: Exclusion zones SHALL propagate across paragraphs on the same page

A floating image anchored in paragraph N that extends below paragraph N's content SHALL affect line widths in paragraphs N+1, N+2, etc. on the same page.

#### Scenario: Tall image spanning multiple paragraphs

- **WHEN** a floating image anchored to paragraph 1 has height=300px and the first paragraph is only 100px tall
- **THEN** paragraphs 2 and 3 (which overlap with the remaining 200px of the image) SHALL also have their line widths reduced by the image's exclusion zone

#### Scenario: No cross-page propagation

- **WHEN** a floating image is on page 1
- **THEN** paragraphs on page 2 SHALL NOT be affected by its exclusion zone

### Requirement: Multiple floating images SHALL create combined exclusion zones

When multiple floating images overlap vertically on the same page, the measurement phase SHALL account for all of them, potentially narrowing text from both left and right sides simultaneously.

#### Scenario: Two images on opposite sides

- **WHEN** image A is positioned on the left (x=0, width=100px) and image B on the right (x=400px, width=100px) at the same Y range
- **THEN** text lines in the overlapping Y range SHALL have available width = contentWidth - 100px - distA_right - 100px - distB_left, starting at offsetX = 100px + distA_right

#### Scenario: Stacked images on same side

- **WHEN** two images are positioned on the left side at different Y offsets (image A at y=0..80, image B at y=100..180)
- **THEN** text wraps around image A in its Y range and around image B in its Y range independently

### Requirement: Per-line rendering SHALL apply offsetX and constrained width

During the rendering phase, each measured line SHALL be rendered with its computed `offsetX` as a left margin and its `availableWidth` as the line container width.

#### Scenario: Line offset rendering

- **WHEN** a measured line has offsetX=160px and availableWidth=400px
- **THEN** the rendered line `<div>` SHALL have `marginLeft: 160px` (or equivalent positioning) and its content SHALL fit within 400px width

### Requirement: wrapTight and wrapThrough SHALL be treated as rectangular wrapping

The `wrapTight` and `wrapThrough` wrap types SHALL use the image's bounding rectangle as the exclusion zone, identical to `wrapSquare` behavior.

#### Scenario: wrapTight with polygon

- **WHEN** a floating image has `wrapTight` with a custom `wrapPolygon`
- **THEN** the exclusion zone SHALL be the image's bounding rectangle, not the polygon contour

### Requirement: wrapNone images SHALL NOT create exclusion zones

Floating images with `wrapNone` (both `behindDoc=0` inFront and `behindDoc=1` behind) SHALL NOT affect text line widths.

#### Scenario: Image in front of text

- **WHEN** a floating image has `wrapNone behindDoc=0`
- **THEN** text SHALL render at full paragraph width, and the image SHALL be rendered above the text layer

#### Scenario: Image behind text

- **WHEN** a floating image has `wrapNone behindDoc=1`
- **THEN** text SHALL render at full paragraph width, and the image SHALL be rendered below the text layer

### Requirement: FloatingObjectManager SHALL be initialized per page with layout context

Before measuring any paragraph on a page, a `FloatingObjectManager` instance SHALL be created and populated with all floating images for that page. The manager SHALL be initialized with the page's content width and left margin.

#### Scenario: Page with floating images

- **WHEN** a page contains 3 floating images across different paragraphs
- **THEN** all 3 images SHALL be registered as exclusion zones in the manager before any paragraph measurement begins

#### Scenario: Page without floating images

- **WHEN** a page contains no floating images
- **THEN** no `FloatingObjectManager` SHALL be created, and paragraph measurement SHALL proceed at full width (no performance impact on non-float pages)

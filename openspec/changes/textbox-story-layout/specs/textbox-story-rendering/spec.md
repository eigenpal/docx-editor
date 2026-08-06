# Textbox Story Rendering

## ADDED Requirements

### Requirement: A text-box drawing carries a textbox-story payload

A `wps:wsp` whose `wps:txbx` contains `w:txbxContent` SHALL project as a typed
drawing with a textbox-story payload capturing the story content root and the
`wps:bodyPr` reads: insets (defaulting to 91440 EMU left/right and 45720 EMU
top/bottom when absent), vertical anchor, and autofit mode. The projection SHALL
NOT walk the story content under the drawing-walk element budget; story blocks
are collected at layout time under layout's own caps.

#### Scenario: Anchored footer textbox projects a story

- **WHEN** a footer contains an anchored `wps:wsp` with a `wps:txbx` holding one
  paragraph
- **THEN** the drawing projects with a textbox-story payload, its extent,
  position, wrap, and anchor attributes read as for any other drawing
- **AND** it is not a placeholder and not reported as a picture

#### Scenario: MC-wrapped textbox is not invisible

- **WHEN** the text-box drawing is wrapped in `mc:AlternateContent` with a VML
  fallback, as Word emits it
- **THEN** the `wps` Choice branch projects the textbox story
- **AND** the VML fallback branch does not additionally render

#### Scenario: Zero insets are honoured

- **WHEN** `wps:bodyPr` declares `lIns="0" tIns="0" rIns="0" bIns="0"`
- **THEN** the story flows at the full extent width and height with no inset

### Requirement: Textbox stories lay out bounded inside the extent

A textbox story SHALL lay out its blocks at the drawing's extent width minus
horizontal insets, clipped at the extent height minus vertical insets, honouring
the story's paragraph and run formatting through the same style cascade as any
story. Vertical anchor `t`/`ctr`/`b` SHALL position the flowed content inside
the box. Layout SHALL be bounded: a textbox-story nesting cap, a per-story
fragment cap, and truncation at the height bound recording a named fallback
reason. Content that does not fit SHALL clip, never grow the extent.

#### Scenario: Story flows at extent width

- **WHEN** a textbox story's paragraph is wider than the extent
- **THEN** lines break at the extent width minus insets, like Word's
  `wrap="square"` body

#### Scenario: Overflow clips with a recorded reason

- **WHEN** the flowed story is taller than the extent
- **THEN** fragments beyond the height bound are not produced
- **AND** the layout records a named truncation fallback reason

#### Scenario: Nested textbox depth is capped

- **WHEN** a file nests text boxes inside text boxes beyond the nesting cap
- **THEN** layout stops descending at the cap and the inner box renders nothing
- **AND** layout terminates without unbounded recursion

### Requirement: Page fields inside textbox stories evaluate per page

The layout SHALL detect `PAGE`, `NUMPAGES`, and `SECTIONPAGES` field
instructions inside a textbox story via the story page-field scan and substitute their
evaluated per-page values at layout time. Cached field result text in the file
SHALL NOT be displayed for live fields. A host story whose only page fields live
inside a textbox SHALL still be classified as needing per-page layout. A textbox
story with no page fields SHALL NOT attach a page-field projector to its host
story, and its content SHALL be identical under every page context; per-page
relayout stays bounded by the existing anchored-drawing context cache.

#### Scenario: Footer textbox PAGE and NUMPAGES render per page

- **WHEN** a footer's only content is an anchored textbox whose paragraph is a
  `PAGE` field, a literal `/`, and a `NUMPAGES` field, and the file's cached
  results are stale
- **THEN** page 3 of a 47-page document paints `3 / 47` inside the textbox
- **AND** the cached result text is not painted

#### Scenario: Field-free textbox content is page-independent

- **WHEN** a header textbox contains only literal text
- **THEN** the host story's page-field needs stay empty, so no page-field
  projector is attached
- **AND** layouts under two different page contexts carry identical story text

### Requirement: Textbox stories paint clipped at the resolved anchor position

A laid-out textbox story SHALL paint as an absolutely positioned, clipped
container at the drawing's resolved position — including page-relative anchors
in headers and footers, which paint on the page sheet — with the shape's solid
fill and outline painted behind the text, using the engine's fragment painter.
The container SHALL be non-editable page furniture excluded from selection
mapping, and text SHALL be painted via safe DOM construction, never HTML from
file-derived strings.

#### Scenario: Page-relative footer textbox paints on the page sheet

- **WHEN** a footer textbox anchors page-relative near the bottom-right corner
- **THEN** its story paints at that page position even though the footer story
  box is elsewhere
- **AND** behind-document anchoring paints it behind body text

#### Scenario: Textbox content is furniture

- **WHEN** the user drags a selection across a painted textbox
- **THEN** the selection maps through the surrounding story only
- **AND** the textbox container is `contenteditable=false`

#### Scenario: Body textbox renders in the flow page

- **WHEN** the body contains an anchored text box with literal text
- **THEN** the story paints inside the drawing's bounds on the anchor page
- **AND** wrap behaviour for surrounding text derives from the drawing's extent
  exactly as before this change

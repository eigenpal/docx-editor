# Drawing Model — delta

Delta on the `drawing-model` capability introduced by the
`typed-drawings-and-images` change: text boxes leave the placeholder bucket.

## MODIFIED Requirements

### Requirement: The picture payload is typed, and non-picture graphics are not faked

`CT_Picture` SHALL be typed: `pic:nvPicPr`, `a:blip` with `r:embed` or `r:link`,
`a:srcRect` (`CT_RelativeRect`), the fill mode, `a:xfrm` including rotation and
`@flipH` / `@flipV`, and `a:prstGeom`. A `w:drawing` whose graphic data is not a
picture SHALL remain a typed drawing with a `generic` graphic payload. A
`wps:wsp` carrying a `wps:txbx` SHALL project a textbox-story payload rather
than a placeholder (see the `textbox-story-rendering` capability).

#### Scenario: Picture types

- **WHEN** a drawing's graphic data is a `pic:pic`
- **THEN** its blip, source rectangle, transform, and geometry are typed

#### Scenario: Empty source rectangle means no crop

- **WHEN** `a:srcRect` is present and empty, as it is on all eleven drawings in the comprehensive fixture
- **THEN** no crop is applied
- **AND** serializing re-emits the empty element rather than dropping it or filling in zeros

#### Scenario: Chart or diagram reserves its extent

- **WHEN** a drawing's graphic data is a chart, a diagram, or a group
- **THEN** it is a typed drawing with a generic graphic payload, it reserves its declared `wp:extent`, and it paints a placeholder
- **AND** it is NOT reported as a supported picture

#### Scenario: Text box renders its story

- **WHEN** a drawing's graphic data is a `wps:wsp` with a `wps:txbx`
- **THEN** it is a typed drawing with a textbox-story payload and renders its
  content instead of a placeholder
- **AND** it is NOT reported as a supported picture

#### Scenario: Placeholder is honest

- **WHEN** a placeholder is painted for an unsupported graphic
- **THEN** it is visually distinguishable from a rendered image and carries the reason

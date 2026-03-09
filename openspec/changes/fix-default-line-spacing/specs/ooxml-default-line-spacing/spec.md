## ADDED Requirements

### Requirement: Default line spacing is single (1.0×) when unspecified

When a DOCX paragraph has no explicit `w:line` attribute — neither in direct formatting, applied style, nor docDefaults — the layout engine SHALL use a line spacing multiplier of 1.0 (single spacing, equivalent to `w:line="240"` with `w:lineRule="auto"`).

The line height for a single-spaced line SHALL be calculated as:
`lineHeight = fontSizePx × singleLineRatio`

Where `singleLineRatio` is the font's OS/2 metric ratio `(usWinAscent + usWinDescent + externalLeading) / unitsPerEm`.

#### Scenario: Paragraph with no line spacing in DOCX

- **WHEN** a paragraph has `w:spacing` with only `w:after="360"` and no `w:line` attribute
- **AND** no style or docDefaults specifies `w:line`
- **THEN** the layout engine SHALL calculate line height as `fontSizePx × singleLineRatio × 1.0`

#### Scenario: Paragraph with explicit line spacing 276

- **WHEN** a paragraph or its style specifies `w:line="276"` with `w:lineRule="auto"`
- **THEN** the layout engine SHALL calculate line height as `fontSizePx × singleLineRatio × 1.15`
- **AND** the result SHALL be identical to before this change

#### Scenario: 11pt Arial with no line spacing

- **WHEN** rendering 11pt Arial text with no `w:line` specified
- **THEN** the line height SHALL be approximately 16.87px (14.667px × 1.1499)
- **AND** NOT 19.40px (the previous incorrect 1.15× result)

### Requirement: All rendering paths use consistent default

The default line spacing multiplier SHALL be consistent across the layout engine measurement, the visible page rendering (layout-painter), and the ProseMirror hidden view.

#### Scenario: Layout measurement matches visible rendering

- **WHEN** a paragraph has no explicit line spacing
- **THEN** the line height used by `measureParagraph.ts` for line breaking
- **AND** the line height used by `renderParagraph.ts` for visible rendering
- **AND** the line height used by ProseMirror CSS for the hidden view
- **SHALL** all use the same 1.0× default multiplier

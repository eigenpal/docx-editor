## ADDED Requirements

### Requirement: RGB text color round-trip

The system SHALL correctly parse `<w:color w:val="RRGGBB"/>` from OOXML into a `ColorValue` with `rgb` field, and serialize it back to identical XML.

#### Scenario: Parse and serialize RGB text color

- **WHEN** a run contains `<w:color w:val="FF0000"/>`
- **THEN** the parsed `ColorValue` has `rgb: "FF0000"` and no theme fields
- **AND** serializing this value produces `<w:color w:val="FF0000"/>`

#### Scenario: Parse auto color

- **WHEN** a run contains `<w:color w:val="auto"/>`
- **THEN** the parsed `ColorValue` has `auto: true`
- **AND** serializing this value produces `<w:color w:val="auto"/>`

### Requirement: Theme text color round-trip

The system SHALL correctly parse `<w:color w:themeColor="..." w:val="..."/>` into a `ColorValue` with `themeColor` field, and serialize it back preserving the theme reference.

#### Scenario: Parse and serialize theme color without modifier

- **WHEN** a run contains `<w:color w:val="4472C4" w:themeColor="accent1"/>`
- **THEN** the parsed `ColorValue` has `themeColor: "accent1"` and `rgb: "4472C4"`
- **AND** serializing produces XML with both `w:val` and `w:themeColor` attributes

#### Scenario: Parse and serialize theme color with tint

- **WHEN** a run contains `<w:color w:val="B4C6E7" w:themeColor="accent1" w:themeTint="66"/>`
- **THEN** the parsed `ColorValue` has `themeColor: "accent1"` and `themeTint: "66"`
- **AND** serializing produces XML with `w:themeColor="accent1"` and `w:themeTint="66"`

#### Scenario: Parse and serialize theme color with shade

- **WHEN** a run contains `<w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/>`
- **THEN** the parsed `ColorValue` has `themeColor: "accent1"` and `themeShade: "BF"`
- **AND** serializing produces XML with `w:themeColor="accent1"` and `w:themeShade="BF"`

### Requirement: Named highlight color round-trip

The system SHALL correctly parse `<w:highlight w:val="..."/>` into a highlight name string, and serialize it back to identical XML.

#### Scenario: Parse and serialize yellow highlight

- **WHEN** a run contains `<w:highlight w:val="yellow"/>`
- **THEN** the parsed highlight value is `"yellow"`
- **AND** serializing produces `<w:highlight w:val="yellow"/>`

#### Scenario: Parse and serialize all 16 highlight colors

- **WHEN** runs contain each of the 16 OOXML highlight values (yellow, green, cyan, magenta, blue, red, darkBlue, teal, darkGreen, darkMagenta, darkRed, darkYellow, lightGray, darkGray, black, white)
- **THEN** each parses to its named value and serializes back identically

### Requirement: Character shading round-trip

The system SHALL correctly parse `<w:shd>` elements with fill, pattern, theme fill, and theme fill tint/shade attributes, and serialize them back.

#### Scenario: Parse and serialize simple fill shading

- **WHEN** a run contains `<w:shd w:val="clear" w:fill="FFFF00"/>`
- **THEN** the parsed `ShadingProperties` has `pattern: "clear"` and `fill.rgb: "FFFF00"`
- **AND** serializing produces identical XML

#### Scenario: Parse and serialize theme fill shading

- **WHEN** a run contains `<w:shd w:val="clear" w:fill="B4C6E7" w:themeFill="accent1" w:themeFillTint="66"/>`
- **THEN** the parsed `ShadingProperties` has `fill.themeColor: "accent1"` and `fill.themeTint: "66"`
- **AND** serializing preserves `w:themeFill` and `w:themeFillTint` attributes

#### Scenario: Parse and serialize pattern with color

- **WHEN** a run contains `<w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF"/>`
- **THEN** the parsed `ShadingProperties` has `pattern: "pct25"`, `color.rgb: "FF0000"`, and `fill.rgb: "FFFFFF"`
- **AND** serializing produces identical XML

### Requirement: Border color round-trip

The system SHALL correctly parse border elements with color and theme color attributes, and serialize them back.

#### Scenario: Parse and serialize RGB border color

- **WHEN** a table cell border contains `w:color="FF0000"`
- **THEN** the parsed `BorderSpec` has `color.rgb: "FF0000"`
- **AND** serializing produces `w:color="FF0000"` on the border element

#### Scenario: Parse and serialize theme border color

- **WHEN** a table cell border contains `w:color="4472C4" w:themeColor="accent1"`
- **THEN** the parsed `BorderSpec` has `color.themeColor: "accent1"`
- **AND** serializing preserves both `w:color` and `w:themeColor` attributes

#### Scenario: Parse and serialize paragraph border color

- **WHEN** a paragraph border element contains `w:color="auto"`
- **THEN** the parsed `BorderSpec` has `color.auto: true`
- **AND** serializing produces `w:color="auto"`

### Requirement: Underline color round-trip

The system SHALL correctly parse underline color from `<w:u>` elements and serialize them back.

#### Scenario: Parse and serialize underline with explicit color

- **WHEN** a run contains `<w:u w:val="single" w:color="FF0000"/>`
- **THEN** the parsed underline formatting includes `color.rgb: "FF0000"`
- **AND** serializing produces the color attribute on the `<w:u>` element

#### Scenario: Parse and serialize underline with theme color

- **WHEN** a run contains `<w:u w:val="single" w:color="4472C4" w:themeColor="accent1"/>`
- **THEN** the parsed underline formatting includes `color.themeColor: "accent1"`
- **AND** serializing preserves both `w:color` and `w:themeColor` on `<w:u>`

### Requirement: Color values survive full document round-trip

When a DOCX file is loaded and saved without edits, all color values (text, highlight, shading, border, underline) SHALL be preserved exactly as they were in the original file.

#### Scenario: Open and save preserves theme colors

- **WHEN** a DOCX file with theme-colored text is opened and saved without modifications
- **THEN** the saved file contains identical color XML attributes as the original

#### Scenario: Open and save preserves highlight colors

- **WHEN** a DOCX file with highlighted text is opened and saved without modifications
- **THEN** the saved file contains identical highlight XML attributes as the original

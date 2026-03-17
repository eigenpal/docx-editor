## ADDED Requirements

### Requirement: Theme color matrix display

The advanced color picker SHALL display the document's theme colors (dk1, lt1, dk2, lt2, accent1-6) as a top row of 10 color cells. Below the top row, it SHALL display 5 additional rows of tint/shade variations computed from those theme colors using OOXML tint percentages (80%, 60%, 40%) and shade percentages (25%, 50%), forming a 10x6 grid.

#### Scenario: Theme colors loaded from document

- **WHEN** the color picker opens and a theme is available
- **THEN** the top row displays 10 theme color cells matching the document's theme color scheme
- **AND** 5 rows below show tint/shade variations of each theme color

#### Scenario: No theme available (fallback)

- **WHEN** the color picker opens and no theme is loaded
- **THEN** the top row displays 10 colors from the Office 2016 default theme
- **AND** tint/shade rows use the same defaults

#### Scenario: Theme color cell tooltip

- **WHEN** the user hovers over a theme color cell
- **THEN** a tooltip displays the theme color name and variant (e.g., "Accent 1, Lighter 60%")

### Requirement: Standard colors row

The advanced color picker SHALL display a row of 10 standard colors below the theme matrix: Dark Red, Red, Orange, Yellow, Light Green, Green, Light Blue, Blue, Dark Blue, Purple.

#### Scenario: Standard colors are always visible

- **WHEN** the color picker dropdown opens
- **THEN** a labeled "Standard Colors" row of 10 fixed colors is displayed below the theme matrix

### Requirement: Custom color input

The advanced color picker in text and border modes SHALL provide a "Custom Color..." section with a hex input field where users can type a 6-character hex color code and apply it.

#### Scenario: Valid hex color applied

- **WHEN** the user types "FF5733" in the hex input and presses Enter or clicks Apply
- **THEN** the color #FF5733 is applied to the selection
- **AND** the dropdown closes

#### Scenario: Invalid hex color rejected

- **WHEN** the user types "ZZZZZZ" in the hex input
- **THEN** the Apply button is disabled
- **AND** no color change occurs

### Requirement: No Color / Automatic option

The advanced color picker SHALL provide a "No Color" (highlight mode) or "Automatic" (text mode) option that removes the color formatting from the selection.

#### Scenario: Automatic in text mode

- **WHEN** the user clicks "Automatic" in text color mode
- **THEN** the text color mark is removed from the selection
- **AND** text reverts to the default document color

#### Scenario: No Color in highlight mode

- **WHEN** the user clicks "No Color" in highlight mode
- **THEN** the highlight mark is removed from the selection

### Requirement: Color selection emits ColorValue with theme information

When a user selects a theme color or theme color variant from the picker, the component SHALL emit a `ColorValue` object containing `themeColor`, `themeTint`, and/or `themeShade` fields — not just a resolved hex string.

#### Scenario: Theme color selection preserves theme reference

- **WHEN** the user clicks on the "Accent 1" theme color cell
- **THEN** the onChange callback receives `{ themeColor: "accent1", rgb: "<resolved hex>" }`

#### Scenario: Theme tint selection preserves tint value

- **WHEN** the user clicks on the "Accent 1, Lighter 60%" cell
- **THEN** the onChange callback receives `{ themeColor: "accent1", themeTint: "66", rgb: "<resolved hex>" }`

#### Scenario: Standard color selection emits RGB only

- **WHEN** the user clicks on a standard color (e.g., Red)
- **THEN** the onChange callback receives `{ rgb: "FF0000" }` without theme fields

### Requirement: Current selection color indicator

The picker button SHALL display a color bar beneath the icon showing the current color of the selection.

#### Scenario: Text color indicator reflects selection

- **WHEN** the user places the cursor in text colored red
- **THEN** the text color button shows a red bar beneath the icon

#### Scenario: No color shows default indicator

- **WHEN** the user places the cursor in uncolored text
- **THEN** the text color button shows a black bar (default text color)

### Requirement: Highlight mode shows OOXML named colors

In highlight mode, the picker SHALL display the 16 OOXML-named highlight colors (yellow, green, cyan, magenta, blue, red, darkBlue, teal, darkGreen, violet, darkRed, darkYellow, gray50, gray25, black, white) and emit the OOXML name on selection.

#### Scenario: Highlight color emits OOXML name

- **WHEN** the user selects "Yellow" from the highlight picker
- **THEN** the onChange callback receives the string "yellow"
- **AND** this maps to `<w:highlight w:val="yellow"/>` in OOXML

### Requirement: Border color mode

The advanced color picker in border mode SHALL display the same theme matrix and standard colors as text mode, and emit a `ColorValue` for use in table border formatting.

#### Scenario: Border color applies to table borders

- **WHEN** the user selects a color from the border color picker
- **THEN** the selected color is applied to the targeted table borders
- **AND** the color is preserved as a `ColorValue` with theme information if applicable

### Requirement: Dropdown positioning handles viewport overflow

The color picker dropdown SHALL use viewport-aware positioning so it does not overflow the screen edges.

#### Scenario: Dropdown near bottom of viewport

- **WHEN** the color picker button is near the bottom of the viewport
- **THEN** the dropdown opens above the button instead of below

### Requirement: Prevent editor focus stealing

All interactive elements in the color picker dropdown (buttons, inputs, cells) SHALL prevent `mousedown` from propagating to the ProseMirror editor to avoid stealing focus.

#### Scenario: Clicking color cell does not move editor cursor

- **WHEN** the user clicks a color cell in the dropdown
- **THEN** the editor selection/cursor position does not change
- **AND** the color is applied to the previously selected text

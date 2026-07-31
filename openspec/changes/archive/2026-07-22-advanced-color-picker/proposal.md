## Why

The current color pickers (text color, highlight, table border) are basic grids of preset colors. Users need a full-featured color picker with theme color support, tint/shade variations, custom hex input, and a visual gradient/hue selector — similar to what Microsoft Word and Google Docs provide. Additionally, while the OOXML parsing/serialization handles theme colors, tints, and shading, there are gaps in round-trip fidelity that need test coverage to ensure correctness.

## What Changes

- **Replace text color picker** with an advanced picker featuring: theme color row with tint/shade matrix (10x6 grid like Word), standard colors row, custom color dialog with gradient picker and hex/RGB input, "No Color" option, recently used colors
- **Replace highlight color picker** with an advanced picker featuring: named highlight colors grid matching OOXML's 16 highlight values, "No Highlight" option, visual consistency with the new text color picker
- **Replace table border color picker** with an advanced picker matching the new text color picker style (theme colors + standard colors + custom), integrated into the existing table options dropdown
- **Add comprehensive tests** for OOXML color round-trips: theme colors with tint/shade, RGB colors, highlight colors, border colors, character shading — verifying parse → model → serialize produces correct XML
- **Ensure proper OOXML read/write** for all color types: verify `w:color`, `w:highlight`, `w:shd`, and border color attributes are correctly parsed and serialized with theme references, tints, and shades

## Capabilities

### New Capabilities

- `advanced-color-picker-ui`: Advanced color picker component with theme color matrix, standard colors, custom color input (gradient + hex/RGB), recently used colors, and "No Color" option
- `color-ooxml-roundtrip`: Comprehensive OOXML color read/write fidelity — ensuring theme colors, tints, shades, highlights, character shading, and border colors survive parse/serialize round-trips

### Modified Capabilities

## Impact

- **UI Components**: `ColorPicker.tsx`, `TableBorderColorPicker.tsx`, `CellBackgroundPicker.tsx` — major rewrites or replacements
- **Toolbar**: `Toolbar.tsx` — update color action handling to pass full ColorValue (theme + RGB) instead of just hex strings
- **Extensions**: `TextColorExtension.ts`, `HighlightExtension.ts` — may need expanded attrs for theme color propagation through the editing pipeline
- **Commands**: `setTextColor`, `setHighlight` — ensure they accept and preserve theme color information
- **Parser/Serializer**: `runParser.ts`, `runSerializer.ts` — verify and fix any gaps in color attribute handling
- **Tests**: New test files for OOXML color round-trips; expanded E2E tests for the new picker UI
- **CSS**: New styles for the advanced color picker (gradient canvas, slider, color matrix grid)

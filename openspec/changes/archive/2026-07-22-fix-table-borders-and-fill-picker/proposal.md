## Why

Table border presets (Left border, Top border, etc.) don't work correctly — clicking them after applying "All borders" with a color does nothing. Additionally, the cell fill color picker uses an old hardcoded 36-color grid instead of the new AdvancedColorPicker (theme-aware, with tints/shades and custom hex input) added in PR #100.

## What Changes

- **Fix individual border presets**: `setCellBorder('left', spec)` doesn't properly apply when borders already exist. The `borderSpecRef.current` in DocxEditor may not reflect the intended border spec, causing individual side presets to silently fail or apply incorrect values.
- **Replace cell fill color picker**: Swap `CellBackgroundPicker` (old 36-color grid) and `ColorPickerRow` in `TableOptionsDropdown` with `AdvancedColorPicker` in a new wrapper, matching how `TableBorderColorPicker` already wraps `AdvancedColorPicker` for border colors.
- **Remove old picker**: Delete `CellBackgroundPicker.tsx` and the inline `ColorPickerRow` from `TableOptionsDropdown` after migration.

## Capabilities

### New Capabilities

- `table-cell-fill-picker`: Theme-aware cell fill color picker using AdvancedColorPicker with "No fill" option

### Modified Capabilities

_(none — no existing spec-level requirements are changing)_

## Impact

- **Core**: `TableExtension.ts` — fix `setCellBorder` to correctly apply single-side borders when other borders exist
- **React**: `CellBackgroundPicker.tsx` — delete after replacement
- **React**: `TableOptionsDropdown.tsx` — remove inline `ColorPickerRow`, use AdvancedColorPicker wrappers
- **React**: New `TableCellFillPicker.tsx` wrapper (similar to existing `TableBorderColorPicker.tsx`)
- **React**: `Toolbar.tsx` — update to use new fill picker component

## 1. Fix Individual Border Presets

- [x] 1.1 Update `setCellBorder` in `TableExtension.ts` to clear all borders before applying the requested side (clear-then-apply pattern for individual sides)
- [x] 1.2 Update border preset handlers in `DocxEditor.tsx` to pass the current `borderSpecRef` correctly to `setCellBorder` for individual side actions (`borderLeft`, `borderTop`, `borderBottom`, `borderRight`)
- [x] 1.3 Verify adjacent cell border sync works correctly after clear-then-apply (e.g., clearing right border should also clear left border of adjacent cell)

## 2. Create TableCellFillPicker

- [x] 2.1 Create `TableCellFillPicker.tsx` wrapping `AdvancedColorPicker` (similar to `TableBorderColorPicker.tsx`), emitting `{ type: 'cellFillColor', color: string | null }` actions, with "No fill" option
- [x] 2.2 Update `Toolbar.tsx` to replace old `TableCellFillPicker` import/usage with the new component, passing `theme` prop

## 3. Remove Old Pickers

- [x] 3.1 Delete `CellBackgroundPicker.tsx` and remove all imports/references
- [x] 3.2 Remove `ColorPickerRow` subcomponent and `QUICK_COLORS` array from `TableOptionsDropdown.tsx`, replace border color and cell fill sections with `AdvancedColorPicker`-based pickers

## 4. Test & Verify

- [x] 4.1 Run typecheck and fix any type errors
- [x] 4.2 Run relevant Playwright tests (table-related) to verify no regressions (pre-existing failures on main, not caused by our changes)
- [x] 4.3 Visual verification in browser: border presets work correctly, fill picker shows theme matrix

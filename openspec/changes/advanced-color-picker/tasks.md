## 1. Theme Color Matrix Utilities

- [x] 1.1 Add `generateThemeTintShadeMatrix()` function to `colorResolver.ts` that takes a `ThemeColorScheme` and returns a 10x6 grid of `{ hex, themeSlot, tint?, shade? }` objects using OOXML tint percentages (80%, 60%, 40%) and shade percentages (25%, 50%)
- [x] 1.2 Add `getThemeTintShadeHex()` helper that computes a single tinted/shaded hex from a base color + percentage using existing `applyTint()`/`applyShade()`
- [x] 1.3 Add unit tests for the matrix generation — verify output dimensions, known color values for Office 2016 defaults, and edge cases (e.g., white/black themes)

## 2. AdvancedColorPicker Component

- [x] 2.1 Create `AdvancedColorPicker.tsx` in `packages/react/src/components/ui/` with `mode` prop (`'text' | 'highlight' | 'border'`), `theme` prop, `value` prop (ColorValue | string), and `onChange` callback emitting `ColorValue`
- [x] 2.2 Implement theme color matrix section — 10x6 grid rendered from `generateThemeTintShadeMatrix()`, with tooltips showing "Accent 1, Lighter 60%" style labels
- [x] 2.3 Implement standard colors row — 10 fixed colors (Dark Red, Red, Orange, Yellow, Light Green, Green, Light Blue, Blue, Dark Blue, Purple)
- [x] 2.4 Implement "Automatic" / "No Color" button at the top of the dropdown (text mode: "Automatic" removes color; highlight mode: "No Color" removes highlight)
- [x] 2.5 Implement custom hex input section for text and border modes — hex input field + Apply button, disabled for invalid input
- [x] 2.6 Implement highlight mode layout — 16 OOXML-named highlight colors in a grid, emitting the OOXML name string on selection
- [x] 2.7 Style the dropdown: section labels ("Theme Colors", "Standard Colors", "Custom Color"), dividers, `useFixedDropdown` for positioning, `mousedown` prevention on all interactive elements
- [x] 2.8 Implement current color indicator bar on the button (same as existing behavior)

## 3. Integrate Into Toolbar

- [x] 3.1 Update `Toolbar.tsx` to use `AdvancedColorPicker` for text color — pass document theme, wire `onChange` to emit `ColorValue` to `DocxEditor`
- [x] 3.2 Update `Toolbar.tsx` to use `AdvancedColorPicker` for highlight color — mode="highlight", wire to emit highlight name
- [x] 3.3 Update `DocxEditor.tsx` color action handlers to accept `ColorValue` objects from the new picker — call `setTextColor(colorValue)` with full theme attrs instead of just `{ rgb }`
- [x] 3.4 Update `TableBorderColorPicker.tsx` (or replace) to use `AdvancedColorPicker` mode="border" — wire to table border commands with `ColorValue`

## 4. ProseMirror Pipeline Updates

- [x] 4.1 Verify `TextColorExtension` `setTextColor` command correctly handles `ColorValue` with `themeColor`, `themeTint`, `themeShade` attrs (already has these attrs — confirm they propagate through mark creation)
- [x] 4.2 Verify `fromProseDoc.ts` correctly maps textColor mark attrs back to `ColorValue` in the `TextFormatting` model — fix if any theme fields are dropped
- [x] 4.3 Verify `toProseDoc.ts` correctly maps `ColorValue` from parsed model to textColor mark attrs — fix if any theme fields are dropped

## 5. OOXML Round-Trip Verification & Fixes

- [x] 5.1 Review `runParser.ts` color parsing — ensure `w:color` with `w:themeColor`, `w:themeTint`, `w:themeShade` all populate the `ColorValue` correctly
- [x] 5.2 Review `runSerializer.ts` color serialization — ensure `serializeColorElement()` outputs `w:themeColor`, `w:themeTint`, `w:themeShade` when present
- [x] 5.3 Review shading parse/serialize — ensure `w:shd` with `w:themeFill`, `w:themeFillTint`, `w:themeFillShade` round-trip correctly
- [x] 5.4 Review border color parse/serialize — ensure table and paragraph border `w:color` + `w:themeColor` round-trip correctly
- [x] 5.5 Review underline color parse/serialize — fixed missing themeTint/themeShade in underline serialization

## 6. Unit Tests — OOXML Color Round-Trip

- [x] 6.1 Create `tests/unit/color-roundtrip.spec.ts` — test RGB text color parse → model → serialize
- [x] 6.2 Add tests for theme text color with tint/shade parse → model → serialize
- [x] 6.3 Add tests for auto color parse → model → serialize
- [x] 6.4 Add tests for all 16 named highlight colors parse → model → serialize
- [x] 6.5 Add tests for character shading (simple fill, theme fill with tint, pattern with color) parse → model → serialize
- [x] 6.6 Add tests for border color (RGB, theme, auto) parse → model → serialize
- [x] 6.7 Add tests for underline color (RGB, theme) parse → model → serialize
- [x] 6.8 Add integration test: open a DOCX with various color types, save without edits, compare color XML attributes

## 7. E2E Tests — Color Picker UI

- [x] 7.1 Add E2E tests for text color picker: open dropdown, verify theme matrix visible, click a theme color, verify it applies
- [x] 7.2 Add E2E tests for highlight picker: open dropdown, verify 16 named colors, click yellow, verify highlight applies
- [x] 7.3 Add E2E tests for custom hex color: type hex, apply, verify text color changes
- [x] 7.4 Add E2E tests for "Automatic" / "No Color" options removing formatting
- [x] 7.5 Add E2E test for border color picker in table context

## 8. Visual Verification — Manual Testing

- [x] 8.1 Start dev server (`bun run dev`) and open `http://localhost:5173/` in Chrome using Claude-in-Chrome tools
- [x] 8.2 Load a sample DOCX with existing colored text, highlights, and table borders — screenshot the initial render and save to `screenshots/color-picker-initial.png`
- [x] 8.3 Open text color picker dropdown — verify theme color 10x6 matrix is displayed, standard colors row is visible, custom hex section is present. Screenshot to `screenshots/color-picker-text-dropdown.png`
- [x] 8.4 Select a theme color (e.g., Accent 1) on some text — verify the text color changes in the editor and the color bar on the button updates. Screenshot to `screenshots/color-picker-text-applied.png`
- [x] 8.5 Select a tint variant (e.g., Accent 1, Lighter 60%) — verify the lighter shade applies correctly. Screenshot to `screenshots/color-picker-tint-applied.png`
- [x] 8.6 Type a custom hex color (e.g., FF5733) in the hex input, apply — verify it applies to text. Screenshot to `screenshots/color-picker-custom-hex.png`
- [x] 8.7 Click "Automatic" in text color mode — verify color formatting is removed and text reverts to default
- [x] 8.8 Open highlight picker dropdown — verify 16 OOXML named colors are shown, no theme matrix. Screenshot to `screenshots/color-picker-highlight-dropdown.png`
- [x] 8.9 Apply yellow highlight to text — verify background color changes. Click "No Color" — verify highlight is removed
- [x] 8.10 Insert/select a table, open border color picker — verify theme matrix and standard colors appear. Apply a border color and verify table borders update. Screenshot to `screenshots/color-picker-border.png`
- [x] 8.11 Save the document as DOCX, re-open it — verify all applied colors (text, highlight, border) are preserved after round-trip
- [x] 8.12 Compare the picker visually against Word's color picker — verify the layout (theme matrix rows, standard row, custom section) matches Word's structure. Record a GIF of the full workflow using `gif_creator` and save to `screenshots/color-picker-walkthrough.gif`

## 9. Cleanup & Deprecation

- [x] 9.1 Deprecate old `ColorPicker` exports (mark as `@deprecated` with migration note) — keep for backwards compatibility but route internal usage to `AdvancedColorPicker`
- [x] 9.2 Remove or simplify `CellBackgroundPicker.tsx` if it can be replaced by `AdvancedColorPicker` mode="border" or a thin wrapper
- [x] 9.3 Run `bun run typecheck` and fix any type errors from the onChange signature change
- [x] 9.4 Run `bun run format` for Prettier compliance
- [x] 9.5 Run full targeted test suite: `npx playwright test tests/colors.spec.ts tests/formatting.spec.ts --timeout=30000 --workers=4`

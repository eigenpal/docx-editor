## Context

The table toolbar provides border presets (All borders, Left border, etc.) and color pickers for border color and cell fill. Two bugs exist:

1. **Border preset bug**: After applying "All borders" with a color, clicking individual presets like "Left border" does nothing. Root cause: `DocxEditor.tsx` dispatches `setCellBorder('left', borderSpecRef.current)`, but `borderSpecRef.current` defaults to `{ style: 'single', size: 4, color: { rgb: '000000' } }` and only updates when the border color picker is used explicitly. The individual border presets in the dropdown (`borderLeft`, `borderTop`, etc.) call `setCellBorder` but need to **remove all borders first, then apply only the requested side** — matching Google Docs behavior where "Left border" means "only left border, remove the rest."

2. **Cell fill picker**: `CellBackgroundPicker.tsx` uses a hardcoded 36-color grid. The new `AdvancedColorPicker` (PR #100) provides theme-aware colors with tint/shade matrix, standard colors, and custom hex input — already used for border color via `TableBorderColorPicker.tsx`.

## Goals / Non-Goals

**Goals:**

- Individual border presets (Left/Right/Top/Bottom) correctly apply only that side's border and remove others
- Cell fill picker uses `AdvancedColorPicker` with theme support, matching border color picker UX
- Remove old `CellBackgroundPicker.tsx` and inline `ColorPickerRow` from `TableOptionsDropdown`

**Non-Goals:**

- Changing border color or width picker behavior (already working with AdvancedColorPicker)
- Modifying how `setTableBorders('all'|'outside'|'inside'|'none')` presets work
- Adding theme color support to the border spec itself (borders use RGB only in OOXML)

## Decisions

### 1. Individual border presets: clear-then-apply pattern

**Decision**: When user clicks "Left border", clear all borders on selected cells first, then apply only the left border with the current border spec.

**Rationale**: This matches Google Docs / Word behavior. "Left border" means "show only left border" — it's a preset, not an additive toggle. The current implementation tries to set a single side without clearing others, and the border spec may not reflect user intent.

**Alternative considered**: Toggle individual sides (add/remove). Rejected because the UI uses preset icons (similar to alignment presets) which imply exclusive selection, not toggles.

### 2. Cell fill picker: new wrapper component `TableCellFillPicker.tsx`

**Decision**: Create `TableCellFillPicker.tsx` wrapping `AdvancedColorPicker` in `highlight` mode (for "No fill" label) or a new `fill` mode, emitting `{ type: 'cellFillColor', color }` actions. Pattern matches existing `TableBorderColorPicker.tsx`.

**Rationale**: Consistent wrapper pattern. The `AdvancedColorPicker` already supports theme colors, tint/shade, standard colors, and custom hex — everything needed.

**Alternative considered**: Modify `CellBackgroundPicker.tsx` in-place. Rejected because the old component's architecture (inline grid, no theme support) would require a full rewrite anyway.

### 3. Remove old pickers, not deprecate

**Decision**: Delete `CellBackgroundPicker.tsx` entirely. Remove `ColorPickerRow` from `TableOptionsDropdown.tsx`.

**Rationale**: The old components have no external consumers. Clean removal avoids dead code.

## Risks / Trade-offs

- **[Risk] Border preset behavior change** → Users accustomed to additive border behavior may be surprised. Mitigation: This matches Word/Docs behavior, so it's the expected UX.
- **[Risk] Theme color data loss in fill** → Cell fill currently stores only RGB hex. If we emit `ColorValue` with theme info, we need `setCellFillColor` to accept and store it. Mitigation: Start with RGB-only (matching current behavior), theme persistence can be a follow-up.

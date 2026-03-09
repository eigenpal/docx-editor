## Context

The editor currently has three color picker components:

1. **ColorPicker.tsx** (719 lines) — flat grid of ~30 preset text colors + 16 highlight colors, custom hex input for text mode only
2. **TableBorderColorPicker.tsx** (152 lines) — compact 10-swatch grid for table borders
3. **CellBackgroundPicker.tsx** (530 lines) — 36-color grid for cell backgrounds with custom HTML color input

These pickers lack the theme color matrix (10 columns x 6 rows with tint/shade variations) that Word provides. The text color picker doesn't pass theme color information through to the command — it only emits hex strings, losing theme references. The OOXML round-trip for colors (theme refs, tints, shades, named highlights, border colors) works but lacks dedicated test coverage.

Key constraint: the editor is client-side only, renders within `.ep-root`, and uses inline styles (no Tailwind in layout-painter output).

## Goals / Non-Goals

**Goals:**

- Build a Word-like advanced color picker with theme color matrix, standard colors row, custom color dialog, and "No Color"/"Automatic" option
- Reuse the same picker component across text color, highlight, and border color contexts
- Preserve theme color references (themeColor + tint/shade) through the entire pipeline: UI → ProseMirror marks → fromProseDoc → OOXML serialization
- Add unit tests for OOXML color parsing and serialization round-trips
- Add E2E tests for the new picker UI interactions

**Non-Goals:**

- Full HSL/HSV gradient picker canvas (phase 2 — for now, hex input is sufficient for custom colors)
- Eyedropper / color sampling tool
- Changes to how colors render in layout-painter (rendering is already correct)
- Refactoring colorResolver.ts internals

## Decisions

### 1. Single `AdvancedColorPicker` component with mode prop

**Decision:** Create one `AdvancedColorPicker` component that handles text, highlight, and border modes via a `mode` prop, replacing the three separate pickers.

**Rationale:** The current codebase has three separate components with duplicated grid logic, hover states, and dropdown mechanics. A single component with mode-specific sections reduces code and ensures visual consistency.

**Alternatives considered:**

- Keep three separate components and add theme support to each → more code duplication, harder to keep consistent
- Extract a shared `ColorGridBase` and compose → still 3 components, more indirection for minimal benefit

### 2. Theme color matrix: 10 columns x 5 tint/shade rows

**Decision:** Display the document's theme colors (dk1, lt1, dk2, lt2, accent1-6) as a top row of 10 colors, with 5 rows below showing tint/shade variations computed using the existing `applyTint()`/`applyShade()` functions from `colorResolver.ts`.

Tint/shade percentages match Word: 80%, 60%, 40% tints and 25%, 50% shades.

**Rationale:** This matches Word's color picker exactly. The tint/shade math already exists in `colorResolver.ts`.

**Alternatives considered:**

- Hardcode tint colors → breaks when theme changes, doesn't match Word behavior
- Use CSS opacity → doesn't match OOXML model, colors wouldn't round-trip correctly

### 3. Color selection emits `ColorValue` instead of hex string

**Decision:** Change the `onChange` callback to emit a `ColorValue` object (from `types/colors.ts`) that includes theme information: `{ rgb, themeColor, themeTint, themeShade }`.

**Rationale:** Currently `onChange` emits a plain hex string, so theme references are lost at the UI boundary. Emitting `ColorValue` preserves theme semantics all the way to OOXML serialization. The `setTextColor` command already accepts `TextColorAttrs` which maps directly to `ColorValue`.

**Alternatives considered:**

- Keep emitting hex and resolve theme references at serialization → impossible to know which theme slot a hex came from after resolution
- Add a separate `onThemeColorChange` callback → splits a single selection event into two paths, error-prone

### 4. Highlight mode uses named OOXML highlight values

**Decision:** In highlight mode, the picker shows the 16 OOXML-named highlight colors and emits the OOXML name (e.g., "yellow", "cyan") rather than a hex value, since `w:highlight` uses named values.

**Rationale:** OOXML's `<w:highlight w:val="yellow"/>` is distinct from `<w:shd w:fill="FFFF00"/>`. The `HighlightExtension` already works with named values. Keeping this separation ensures correct serialization.

### 5. OOXML round-trip tests as unit tests (not E2E)

**Decision:** Test color parsing/serialization with unit tests that directly call `parseRunProperties()` → check model → call `serializeRunProperties()` → verify XML output.

**Rationale:** Unit tests are fast, deterministic, and test the exact boundary. E2E tests through the editor would be slow and conflate rendering/editing concerns with serialization correctness.

**Test categories:**

- Theme color with tint: parse `<w:color w:themeColor="accent1" w:themeTint="80"/>` → verify `ColorValue` → serialize back → verify XML matches
- RGB color: parse `<w:color w:val="FF0000"/>` → round-trip
- Named highlight: parse `<w:highlight w:val="yellow"/>` → round-trip
- Character shading: parse `<w:shd w:val="clear" w:fill="FFFF00" w:themeFill="accent2" w:themeFillTint="60"/>` → round-trip
- Border color: parse border with theme color → round-trip
- Auto color: parse `<w:color w:val="auto"/>` → round-trip

## Risks / Trade-offs

- **[Breaking change to `onChange` signature]** → Existing toolbar code passes hex strings. Mitigation: update `Toolbar.tsx` and `DocxEditor.tsx` simultaneously; the old `ColorPicker` exports remain available during transition but are deprecated.
- **[Theme unavailable at picker time]** → If no theme is loaded, the theme row falls back to Office 2016 defaults (already in `colorResolver.ts`). Mitigation: `getDefaultThemeColors()` already provides fallback values.
- **[Tint/shade visual mismatch with Word]** → The tint/shade math in `colorResolver.ts` follows OOXML spec but rounding differences could produce slightly different colors. Mitigation: test against known Word output values.
- **[Dropdown size increase]** → The advanced picker is taller (theme matrix + standard + custom). Mitigation: use `useFixedDropdown` positioning which already handles viewport overflow.

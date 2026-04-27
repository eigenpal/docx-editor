---
'@eigenpal/docx-js-editor': minor
---

# Word-style split button for text + highlight color (issue #130)

Closes [#130](https://github.com/eigenpal/docx-editor/issues/130).

The font-color and highlight-color toolbar buttons are now Word-style split buttons. Two halves:

- **Apply half (icon + swatch):** click to re-apply the last color you picked. No dropdown.
- **Arrow half (▾):** click to open the full color picker (theme grid, standard colors, custom hex, "no color").

Pick a color once, then for every subsequent occurrence just click the swatch — one click instead of three.

## API surface (consolidated)

The package previously shipped two color pickers — a simple `ColorPicker` and a fuller `AdvancedColorPicker`. The two have been merged into a single `ColorPicker` with two new props:

- `splitButton?: boolean` — default `true`. Set `false` to render a legacy single-button shape.
- `defaultColor?: ColorValue | string` — initial "last picked" color used by the apply half before the user picks anything. Defaults: text → red, highlight → yellow, border → black.

The "last picked" memory is independent of the current selection's color (matches Word). Picking "Automatic" / "No color" does NOT update it.

## Breaking changes

- The legacy `ColorPicker` (the simpler grid picker that ran inline, not via dropdown) has been **removed**. Its types `ColorOption` and the old `ColorPickerProps` shape are no longer exported.
- `AdvancedColorPicker` has been **renamed to `ColorPicker`**. Update imports:

  ```diff
  - import { AdvancedColorPicker } from '@eigenpal/docx-js-editor';
  + import { ColorPicker } from '@eigenpal/docx-js-editor';
  ```

  The exported `ColorPickerProps` and `ColorPickerMode` types now correspond to the renamed component (formerly `AdvancedColorPickerProps` / `AdvancedColorPickerMode`).

- CSS class names changed from `docx-advanced-color-picker-*` → `docx-color-picker-*`. If you targeted these in user CSS overrides, update the selectors.

## Migration

No changes needed inside the library — text-color, highlight-color, table-cell-fill, and table-border-color buttons all use the new `ColorPicker` automatically. If you import `AdvancedColorPicker` directly, switch to `ColorPicker`. If you used the legacy simpler `ColorPicker`, the new `ColorPicker` is a drop-in for any case that benefits from the fuller picker; otherwise build a small custom picker — the legacy one was thin enough to inline.

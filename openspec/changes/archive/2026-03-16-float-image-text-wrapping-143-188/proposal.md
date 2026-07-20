## Why

Floating images in DOCX files specify text wrapping behavior (square, tight, through, topAndBottom) that controls how paragraph text flows around them. Currently, the editor parses and stores all wrapping metadata correctly, and positions floating images at the correct absolute coordinates on the page — but text lines are always measured at full paragraph width, so they render underneath the images instead of wrapping around them. This is one of the most visible WYSIWYG fidelity gaps, as virtually every Word document with images uses text wrapping. Issue #143 tracks page-level wrapping; issue #188 tracks the table-cell variant where floating images additionally render as centered blocks instead of at their anchor offsets.

## What Changes

- **Integrate FloatingObjectManager into paragraph measurement**: The existing `FloatingObjectManager.computeAvailableWidth()` (already implemented in `wrapZones.ts`) will be called during line measurement so each line's width is reduced where it overlaps with a floating image's exclusion zone.
- **Per-line X offset and width in rendering**: Lines that are shifted by left-side floats will receive an X offset so text starts after the image. Lines narrowed by right-side floats will have reduced width.
- **Cross-paragraph exclusion zone propagation**: Floating images anchored to one paragraph can span multiple paragraphs vertically. The exclusion zones will be accumulated across paragraphs within the same page/column so subsequent paragraphs also wrap.
- **wrapTopAndBottom support**: Lines that vertically overlap with a `wrapTopAndBottom` image will be pushed below it entirely (available width = 0 forces a vertical skip).
- **Table cell floating image layer**: Create a cell-level floating image extraction and positioning system (mirroring page-level logic) so floating images inside table cells render at their anchor offsets with text wrapping, using the cell's content width as the container boundary.
- **wrapText mode enforcement**: Respect `bothSides`, `left`, `right`, and `largest` modes to control which side(s) of a floating image text is allowed to flow on.

## Capabilities

### New Capabilities

- `float-text-wrapping`: Per-line text wrapping around floating images at page level — integrates FloatingObjectManager into the measurement phase, handles all wrap types (square, tight, through, topAndBottom) and wrapText modes (bothSides, left, right, largest), with cross-paragraph exclusion zone propagation.
- `table-cell-float-layout`: Floating image positioning and text wrapping inside table cells — extracts floating images from cell paragraphs, positions them within the cell container, and applies the same wrapping measurement logic scoped to cell content width.

### Modified Capabilities

<!-- No existing specs to modify — these are new capabilities -->

## Impact

- **Layout engine**: `wrapZones.ts` (minor API additions), `types.ts` (MeasuredLine gets offsetX field)
- **Layout painter**: `renderParagraph.ts` (major — measurement phase integration, per-line offset rendering), `paintPage.ts` (pass exclusion zones to paragraph rendering), `renderTable.ts` (cell-level floating image extraction and layer rendering), `renderImage.ts` (minor — cell-level image rendering)
- **Layout bridge**: `buildBoxTree.ts` (ensure floating image runs are properly extracted for cell-level processing)
- **No API changes**: Parsing, ProseMirror schema, and serialization are unaffected — all data is already correctly parsed and stored
- **No dependencies**: No new packages needed; this is purely a layout/rendering change
- **Test document**: `examples/vite/public/float-wrap-comprehensive-test.docx` created with all wrap types, position modes, table cells, and edge cases

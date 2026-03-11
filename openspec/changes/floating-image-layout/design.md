# Design: Floating Image Layout

## Current state

Images are rendered by `layout-painter/renderImage.ts`. Floating images are positioned absolutely, but the paragraph text layout in `renderParagraph.ts` doesn't account for the image's bounding box when flowing text.

## Architecture

### Text wrapping calculation

During paragraph measurement, the layout engine needs to:

1. Collect all floating images that affect the current paragraph's vertical range
2. For each line of text, calculate available width by subtracting image bounding boxes
3. For `square` wrapping: use the image's rectangular bounds
4. For `tight`/`through` wrapping: use the image's wrap polygon (`wrapPolygon` in DrawingML)
5. For `topAndBottom`: push text entirely above/below the image

### Image position in tables

Images inside table cells should be constrained to the cell's content area. The positioning should respect:

- Cell padding
- Cell width
- Row height expansion to accommodate images

### Z-index layering

- `behindDoc=true`: image z-index below text (z-index: -1 relative to text layer)
- `behindDoc=false` (default): image z-index above text

## Key files

| File                                    | Change                                       |
| --------------------------------------- | -------------------------------------------- |
| `src/layout-painter/renderParagraph.ts` | Text flow around floating images             |
| `src/layout-painter/renderImage.ts`     | Image positioning, z-index                   |
| `src/layout-painter/renderTable.ts`     | Image containment within cells               |
| `src/layout-painter/measurement.ts`     | Line width calculation with image exclusions |

# Tasks: OOXML Feature Gaps

## Image hyperlinks

- [ ] Check if `a:hlinkClick` is parsed from DrawingML in `drawingParser.ts`
- [ ] If not, add parsing of `a:hlinkClick` relationship ID
- [ ] Resolve relationship ID to URL from .rels
- [ ] Wrap image in `<a>` tag in layout-painter
- [ ] Test with DOCX containing clickable image in footer

## TIFF images

- [ ] Check if TIFF images currently render or show broken icon
- [ ] Add TIFF-to-PNG/JPEG client-side conversion (utif.js or similar)
- [ ] Convert during image data loading, before rendering
- [ ] Test with DOCX containing TIFF image

## SVG images

- [ ] Check if `image/svg+xml` MIME type is handled in image rendering
- [ ] If not, add MIME type mapping
- [ ] Test with DOCX containing SVG image

## Font size decimal

- [ ] Find font size input component (likely `FontSizePicker` or similar)
- [ ] Change validation to allow decimal point
- [ ] Change parsing from `parseInt` to `parseFloat`
- [ ] Ensure internal storage uses half-points (OOXML format)
- [ ] Test: type "10.5" → verify correct font size applied

## Null lvlText guard

- [ ] Find list numbering generation code that calls `.replace()` on lvlText
- [ ] Add null check: if lvlText is null, return empty string
- [ ] Test with DOCX containing incomplete numbering definition

## Column separator line

- [ ] Check if `w:sep` is parsed from `w:cols` in section properties
- [ ] If not, add parsing
- [ ] Render vertical line between columns in layout-painter
- [ ] Position at midpoint between columns, full column height
- [ ] Test with DOCX using "Line between" columns option

## Testing

- [ ] E2E test: click image with hyperlink → link opens
- [ ] E2E test: TIFF image renders
- [ ] E2E test: font size "10.5" applies correctly
- [ ] E2E test: document with null lvlText loads without crash
- [ ] E2E test: column separator line renders
- [ ] Run `bun run typecheck`

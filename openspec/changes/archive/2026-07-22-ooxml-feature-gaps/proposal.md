# OOXML Feature Gaps

## Problem

Several OOXML features are either not implemented or have edge cases that cause crashes:

1. **Hyperlink click on DrawingML images** — images with `a:hlinkClick` in DrawingML should open their hyperlink when clicked. Currently the image renders but clicking does nothing.

2. **TIFF image rendering** — TIFF format images in DOCX render as broken image icons. Browsers don't natively support TIFF, so client-side conversion is needed.

3. **SVG image rendering** — SVG images embedded in DOCX media may not render.

4. **Font size decimal input** — typing "10.5" in the font size toolbar input becomes "105". The decimal point is stripped, making half-point sizes (common in Word: 10.5, 12.5) impossible to enter.

5. **Null `lvlText` crash in list numbering** — documents with incomplete numbering definitions where `lvlText` is null cause a crash when `.replace()` is called on null. Need null guard.

6. **Column separator line** — `w:sectPr/w:cols` with `w:sep` or `w:lineBetween` attribute should render a vertical line between columns. Currently multi-column layouts work but the separator is missing.

## Scope

- Add clickable hyperlinks on DrawingML images
- Add TIFF-to-displayable-format conversion
- Verify SVG image support
- Fix font size decimal input handling
- Add null guard for `lvlText` in list numbering
- Render vertical separator line between columns

## Out of scope

- Image editing features
- New font UI features beyond decimal support

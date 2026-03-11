# Design: OOXML Feature Gaps

## Image hyperlinks (a:hlinkClick)

DrawingML images can have hyperlinks via `<a:hlinkClick r:id="rId5"/>` inside `<pic:cNvPr>`. The relationship ID points to a URL in the .rels file.

**Parser:** Extract `a:hlinkClick` relationship ID during drawing parsing, resolve to URL.
**Rendering:** Wrap the image element in an `<a>` tag with the resolved URL in layout-painter.

## TIFF images

Browsers don't support TIFF natively. Options:

1. Use a JS TIFF decoder library (e.g., `utif.js`, `tiff.js`) to convert to PNG/JPEG data URL
2. Check if the DOCX includes an alternative image format (WMF/EMF fallback in `<a:extLst>`)

Recommend option 1 for reliability. Convert during image loading, before rendering.

## SVG images

Modern browsers support SVG natively via `<img src="data:image/svg+xml;base64,...">`. Check if our image renderer handles `image/svg+xml` content type from DOCX media. If not, add the MIME type mapping.

## Font size decimal

The font size input likely uses `parseInt()` or strips non-digit characters. Change to `parseFloat()` and allow `.` in the input validation regex.

Store internally as half-points (OOXML uses half-points: 21 = 10.5pt). Display as points with one decimal.

## Null lvlText guard

Add null check before `.replace()` calls on `lvlText` in list numbering generation. If `lvlText` is null, return an empty string or fallback indicator.

## Column separator line

When `w:cols` has `w:sep="true"` or child `<w:sep/>`, render a vertical line between column regions.

**Rendering:** In the column layout renderer, add a 1px solid line at the midpoint between columns, spanning the full column height.

## Key files

| File                                                   | Change                              |
| ------------------------------------------------------ | ----------------------------------- |
| `src/docx/drawingParser.ts`                            | Parse a:hlinkClick                  |
| `src/layout-painter/renderImage.ts`                    | Wrap image in link, TIFF conversion |
| `src/components/ui/FontSizePicker.tsx`                 | Decimal input handling              |
| `src/prosemirror/extensions/features/ListExtension.ts` | lvlText null guard                  |
| `src/layout-painter/renderPage.ts`                     | Column separator line               |
| `src/docx/sectionParser.ts`                            | Parse w:sep from w:cols             |

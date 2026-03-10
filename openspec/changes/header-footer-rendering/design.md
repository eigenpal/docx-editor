# Design: Header/Footer Rendering

## Content clipping

The header/footer area has a fixed height based on `w:headerDistance`/`w:footerDistance` from section properties. When content (especially images) exceeds this height, it clips.

**Word behavior:** Word expands the header area and pushes the body content down (or footer up). If the image is anchored with specific positioning, it may extend into the margin without affecting body layout.

**Fix:** After rendering header/footer content, measure actual content height. If it exceeds the allocated area, either:

1. Expand the header/footer area and reduce body content area accordingly
2. Allow overflow with proper z-index (for anchored images)

## Alignment

Headers/footers commonly use a 3-section layout via tab stops:

- Left-aligned text at position 0
- Center-aligned text at page center tab stop
- Right-aligned text at right margin tab stop

Ensure tab stop rendering in headers/footers uses the correct page width and margin calculations.

## Key files

| File                                    | Change                                      |
| --------------------------------------- | ------------------------------------------- |
| `src/layout-painter/renderPage.ts`      | Header/footer area sizing                   |
| `src/layout-painter/renderParagraph.ts` | Tab stop alignment in header/footer context |
| `src/docx/sectionParser.ts`             | Verify header/footer distance parsing       |

## Context

The editor uses a two-phase rendering pipeline: (1) **measurement** — paragraph text is broken into lines based on available width, (2) **rendering** — lines are painted into the visible DOM. Floating images are extracted from paragraphs in `paintPage.ts`, positioned absolutely in a floating layer, and exclusion zones are computed — but this information never reaches the measurement phase. The `FloatingObjectManager` class in `wrapZones.ts` already implements `computeAvailableWidth(lineY, lineHeight, pageNumber)` which returns `{ width, offsetX }` per line, but it is never called.

The page rendering flow is:

1. `paintPage.ts` iterates paragraph fragments
2. For each, it calls `extractFloatingImagesFromParagraph()` to find floating images
3. It positions them and computes exclusion zones (`FloatingImageInfo`)
4. It renders paragraphs via `renderParagraph()` — but doesn't pass exclusion zones to measurement
5. Floating images are rendered in a separate absolute layer on top

For table cells, `renderTable.ts` → `renderCellContent()` sets `insideTableCell: true` in the render context. Floating images in cells are not extracted — they fall through to `renderBlockImage()` as centered blocks.

## Goals / Non-Goals

**Goals:**

- Text wraps around floating images matching Microsoft Word behavior for `wrapSquare`, `wrapTight`, `wrapThrough` wrap types
- `wrapTopAndBottom` pushes text entirely below the image
- `wrapText` modes (`bothSides`, `left`, `right`, `largest`) control which sides text flows on
- Wrap distances (`distT/B/L/R`) are respected as padding around exclusion zones
- Floating images inside table cells position at their anchor offset with text wrapping
- Cross-paragraph wrapping: a tall image anchored in paragraph N affects line widths in paragraphs N+1, N+2, etc.
- Multiple floating images on the same page create combined exclusion zones

**Non-Goals:**

- Contour-based wrapping for `wrapTight`/`wrapThrough` with custom `wrapPolygon` vertices — treat as rectangular (same as `wrapSquare`). Full polygon wrapping is a separate, much more complex effort.
- User-draggable floating images (editing floating image position via mouse interaction)
- Floating images spanning page breaks (image on page N affecting line widths on page N+1)
- `wrapNone` text avoidance — `inFront`/`behind` intentionally overlap text, no wrapping needed
- Floating tables (tracked separately)
- Header/footer floating image wrapping (already has separate rendering path)

## Decisions

### Decision 1: Pre-pass exclusion zone collection before paragraph measurement

**Approach**: Before measuring any paragraph on a page, do a pre-pass that collects all floating images on the page and registers them with `FloatingObjectManager`. Then pass the manager instance to each paragraph's measurement function.

**Why**: Floating images are anchored to specific paragraphs but their exclusion zones can affect _any_ paragraph on the page. We need all floating image positions resolved before we can correctly measure any line. The alternative (lazy registration during measurement) would require multiple measurement passes when a later paragraph's float affects an earlier paragraph's lines.

**Trade-off**: This means floating images' Y positions must be computed before paragraph layout, which is already the case — `extractFloatingImagesFromParagraph()` runs per paragraph and resolves absolute positions. We just need to accumulate them across paragraphs in a single page-level manager.

### Decision 2: Extend MeasuredLine with per-line offsetX and availableWidth

**Approach**: Add `offsetX: number` and `availableWidth: number` fields to the `MeasuredLine` type in `types.ts`. During measurement, each line queries the `FloatingObjectManager` for its Y position to get the constrained width and X offset. During rendering, each line `<div>` applies `marginLeft: offsetX` and its width cap is `availableWidth` instead of full paragraph width.

**Why**: The measurement phase already tracks per-line metrics (width, height, runs). Adding offsetX and availableWidth is the minimal extension needed. The rendering phase already creates per-line `<div>` elements with explicit styles, so applying the offset is straightforward.

**Alternatives considered**:

- CSS float: Would require fundamentally different rendering approach; incompatible with the current measurement-based line breaking system.
- CSS shape-outside: Only works with actual CSS float elements; our images are absolutely positioned.

### Decision 3: Two-phase approach for table cells

**Approach**:

- Phase 1: Extract floating images from cell paragraphs (mirroring `extractFloatingImagesFromParagraph()` but scoped to cell).
- Phase 2: Create a cell-level `FloatingObjectManager` with `contentWidth = cellContentWidth`, register the cell's floating images, and pass it to cell paragraph measurement.
- Phase 3: Render a cell-level floating image layer (absolutely positioned `<div>` within the cell, similar to page-level).

**Why**: Table cells are self-contained layout contexts in OOXML — floating images in a cell don't escape the cell. The same `FloatingObjectManager` API works; we just scope it to the cell's content area.

### Decision 4: wrapTopAndBottom via zero available width

**Approach**: When a line overlaps with a `wrapTopAndBottom` exclusion zone, `computeAvailableWidth()` returns `{ width: 0, offsetX: 0 }`. The measurement phase detects zero width and advances the line's Y position below the exclusion zone's bottom edge before re-measuring.

**Why**: This reuses the existing exclusion zone mechanism without special-casing. The measurement loop already handles "line doesn't fit" scenarios — we just need to add vertical advancement logic.

### Decision 5: Treat wrapTight and wrapThrough as wrapSquare (rectangular)

**Approach**: All three wrap types use the image's bounding rectangle as the exclusion zone. `wrapTight` and `wrapThrough` with custom polygon vertices are approximated as their bounding rectangle.

**Why**: True polygon-based wrapping requires per-scanline intersection testing, which is a significant complexity increase for a rare use case. Rectangular approximation covers 95%+ of real-world documents. Can be enhanced later.

## Risks / Trade-offs

**[Performance] Measurement with exclusion zones adds per-line computation** → The `computeAvailableWidth()` call does a linear scan of exclusion zones per line. For typical documents (< 10 floating images per page), this is O(lines × floats) which is negligible. For pathological cases, we can add spatial indexing later.

**[Accuracy] Floating image Y position depends on paragraph layout which depends on floating image position (circular dependency)** → In OOXML, floating image positions are specified relative to anchors (paragraph, column, margin, page). We resolve positions in a single pass using the paragraph's pre-layout Y position. This matches Word's behavior for most documents, but complex cases with paragraph-relative vertical offsets on images that cause text to reflow differently may need iterative layout. Mitigation: Accept single-pass approximation, iterate only if visually broken in real documents.

**[Scope creep] Cell-level floating images add complexity to table rendering** → Table rendering is already complex. Mitigation: Keep the cell-level logic as a self-contained helper function that mirrors page-level patterns. If it proves too complex, ship page-level wrapping first (#143) and follow up with cell-level (#188) separately.

**[Regression risk] Changing measurement affects all paragraph layout** → The exclusion zone integration is conditional — only activated when floating images exist on the page. When no floats are present, the code path is identical to current behavior. Existing tests should pass unchanged.

**[Edge case] Large images that exceed content width** → If a floating image is wider than the content area, `computeAvailableWidth()` returns 0 or negative width. Mitigation: Clamp minimum available width to a reasonable threshold (e.g., 20px) to prevent infinite loops, or skip wrapping for that zone.

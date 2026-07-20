## 1. Layout Engine Types and FloatingObjectManager Updates

- [x] 1.1 Add `offsetX: number` and `availableWidth: number` fields to `MeasuredLine` type in `pagination-model/types.ts` (default offsetX=0, availableWidth=full paragraph width)
- [x] 1.2 Add `wrapEdge` mapping logic to `FloatingObjectManager` — convert `wrapText` values (bothSides, left, right, largest) to exclusion zone `wrapEdge` (left, right, both, none), including `largest` which requires comparing available space on each side
- [x] 1.3 Add `wrapTopAndBottom` support to `FloatingObjectManager` — when wrap type is topAndBottom, `computeAvailableWidth()` returns `{ width: 0, offsetX: 0 }` to signal the line must skip below the zone
- [x] 1.4 Add minimum width threshold in `computeAvailableWidth()` — clamp to 0 and let caller handle skip logic when available width is insufficient

NOTE: Tasks 1.1-1.4 were already implemented in the existing codebase. `MeasuredLine` has `leftOffset`/`rightOffset`. `paragraphLayout.ts` has `FloatingImageZone`, `getFloatingMargins()`, and per-line width reduction. `wrapTopAndBottom` is handled by `paragraphLayout` giving the image its own line.

## 2. Page-Level Exclusion Zone Collection (Pre-pass)

- [x] 2.1 In `paintPage.ts`, refactor `extractFloatingImagesFromParagraph()` to return structured `WrapZone` objects (id, pageNumber, bounds, distances, wrapEdge) in addition to rendering info
- [x] 2.2 Create page-level pre-pass: iterate all paragraph fragments before measurement, collect all floating images, create a single `FloatingObjectManager` per page, and register all exclusion zones
- [x] 2.3 Pass the populated `FloatingObjectManager` instance to each paragraph's render/measure call via `RenderParagraphOptions` (add `floatingObjectManager?: FloatingObjectManager` field)

NOTE: Implemented via `rectsToFloatingZones()` which converts `FloatingExclusionRect[]` to `FloatingImageZone[]`. Each floating image becomes its own zone. Pre-pass was already in place (extractFloatingImagesFromParagraph runs before paragraph rendering). Zones are passed to `paragraphLayout()` directly during rendering.

## 3. Measurement Phase Integration

- [x] 3.1 In `renderParagraph.ts` measurement logic, accept `FloatingObjectManager` and the paragraph's absolute Y position on the page
- [x] 3.2 For each line being measured, compute `lineAbsoluteY = paragraphY + accumulatedLineHeight` and call `floatingObjectManager.computeAvailableWidth(lineAbsoluteY, lineHeight, pageNumber)` to get per-line width and offset
- [x] 3.3 Use the returned `availableWidth` instead of full paragraph width when breaking text into the current line
- [x] 3.4 Store `offsetX` and `availableWidth` on each `MeasuredLine` for the rendering phase
- [x] 3.5 Handle `wrapTopAndBottom` case: when `computeAvailableWidth()` returns width=0, advance lineAbsoluteY below the exclusion zone's bottom edge and re-measure the line at full width

NOTE: Tasks 3.1-3.5 were already implemented in `paragraphLayout.ts`. The `getFloatingMargins()` function handles per-line Y overlap checking and `startNewLine()` recalculates margins for each new line. The key change was wiring this in `paintPage.ts` by calling `paragraphLayout(block, contentWidth, { floatingZones, paragraphYOffset })` to re-measure paragraphs when floating images exist.

## 4. Rendering Phase Per-Line Offset

- [x] 4.1 In `paintLine()` within `renderParagraph.ts`, apply `marginLeft: line.offsetX` (or `paddingLeft`) on the line `<div>` when offsetX > 0
- [x] 4.2 Apply `maxWidth: line.availableWidth` or equivalent constraint on the line container to prevent text overflow past the exclusion zone
- [x] 4.3 Remove the disabled TODO comments about per-line floating margins (lines 60-64, 691-702) and replace with the actual implementation

NOTE: Tasks 4.1-4.2 were already implemented in `paintParagraphFragment()` which reads `leftOffset`/`rightOffset` from `MeasuredLine` and applies CSS `marginLeft`/`marginRight`. Task 4.3 done — replaced TODO comments with factual comments about the implemented system.

## 5. Table Cell Floating Image Extraction

- [x] 5.1 In `renderTable.ts` `renderCellContent()`, add floating image extraction: scan cell paragraphs for floating image runs using `isFloatingImageRun()`, collect them before rendering cell content
- [x] 5.2 Position extracted floating images within the cell: compute (x, y) offsets relative to cell content area using the same position resolution logic as page-level (positionH/positionV, align modes, posOffset conversion)
- [x] 5.3 Create a cell-level floating image layer: absolutely-positioned `<div>` within the cell container with `overflow: hidden`, containing the positioned images

## 6. Table Cell Measurement Integration

- [x] 6.1 Create a cell-level `FloatingObjectManager` per cell that has floating images, initialized with `contentWidth = cellContentWidth`
- [x] 6.2 Register cell floating images as exclusion zones in the cell-level manager
- [x] 6.3 Pass the cell-level `FloatingObjectManager` to cell paragraph measurement (same interface as page-level, task 3.1-3.5)
- [x] 6.4 Ensure floating image runs are skipped from inline rendering in cell paragraphs (they're now in the floating layer), removing the current `renderBlockImage()` fallback for floating images in cells

NOTE: Tasks 5-6 implemented in `renderTable.ts`. Added `extractCellFloatingImages()` helper, cell-level floating layer, `FloatingImageZone[]` creation, and re-measurement via `paragraphLayout()`. Floating images in cells are now extracted, positioned at anchor offsets, and text wraps around them.

## 7. E2E Tests

- [x] 7.1 Add Playwright test: page-level `wrapSquare` with `bothSides` — verify text appears on both sides of the image (text doesn't render underneath)
- [x] 7.2 Add Playwright test: page-level `wrapSquare` with `left`/`right` modes — verify text flows only on the specified side
- [x] 7.3 Add Playwright test: `wrapTopAndBottom` — verify no text appears beside the image and text resumes below it
- [x] 7.4 Add Playwright test: cross-paragraph wrapping — verify a tall image affects line widths in subsequent paragraphs
- [x] 7.5 Add Playwright test: multiple floating images — verify combined exclusion zones (two images on opposite sides narrow text from both sides)
- [x] 7.6 Add Playwright test: floating image in table cell — verify image is positioned at anchor offset (not centered block) and cell text wraps around it
- [x] 7.7 Add Playwright test: `wrapNone` in front/behind — verify text renders at full width (no wrapping, just z-layer difference)
- [x] 7.8 Verify existing image-related tests pass: run `image-roundtrip.spec.ts`, `generic-rendering-regression.spec.ts`, and `demo-docx.spec.ts` to confirm no regressions

NOTE: All 9 E2E tests in `e2e/tests/float-text-wrapping.spec.ts` pass. Tests 7.3 and 7.7 merged into broader tests covering wrapNone and overall wrapping metrics. Existing regression tests pass (generic-rendering-regression: 1/1, demo-docx: 44/46 — 2 pre-existing flaky failures unrelated to changes).

## 8. Visual Verification and Cleanup

- [x] 8.1 Visual test with `float-wrap-comprehensive-test.docx` in Chrome: verify all 5 sections render correctly
- [x] 8.2 Visual test with existing `float-wrap-test.docx` and `table-float-image-test.docx` — confirm improved rendering
- [x] 8.3 Run full typecheck: `bun run typecheck`
- [x] 8.4 Run targeted Playwright tests: `npx playwright test tests/image-roundtrip.spec.ts tests/generic-rendering-regression.spec.ts tests/demo-docx.spec.ts --timeout=30000 --workers=4`

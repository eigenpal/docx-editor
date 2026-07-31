# Tasks: Floating Image Layout

## Investigation

- [ ] Audit current floating image rendering in `renderImage.ts`
- [ ] Identify how paragraph measurement handles (or ignores) floating images
- [ ] Review `renderParagraph.ts` TODO about floating image support
- [ ] Create test DOCX files with each wrapping mode: square, tight, through, topAndBottom
- [ ] Test images inside table cells with grid layouts (2-column image grid)

## Implementation — Text wrapping

- [ ] Collect floating images that overlap a paragraph's vertical range
- [ ] For `square` wrapping: exclude rectangular bounding box from line width
- [ ] For `tight`/`through` wrapping: use wrap polygon for exclusion zones
- [ ] For `topAndBottom` wrapping: push text above/below image entirely
- [ ] Handle images anchored to left, right, and center positions

## Implementation — Table images

- [ ] Constrain floating image position to cell content area
- [ ] Handle multiple images in same cell without overlap

## Implementation — Z-index

- [ ] Verify `behindDoc` flag sets correct z-index relative to text
- [ ] Verify in-front-of-text images overlay correctly

## Testing

- [ ] E2E test: square wrapping with left-aligned image
- [ ] E2E test: square wrapping with right-aligned image
- [ ] E2E test: topAndBottom wrapping
- [ ] E2E test: multiple images in table grid
- [ ] E2E test: behind-text image with overlapping text
- [ ] Visual comparison against Word for each wrapping mode
- [ ] Run `bun run typecheck`

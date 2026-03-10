# Tasks: Tab Leader Rendering

## Investigation

- [ ] Find tab leader rendering code in layout-painter
- [ ] Create/find test DOCX with TOC using dotted tab leaders
- [ ] Compare current rendering against Word — identify overlap areas
- [ ] Check how tab span width is calculated

## Implementation

- [ ] Ensure leader element is clipped to tab span boundaries
- [ ] Add left/right padding to prevent text overlap
- [ ] Verify all leader types render correctly: dot, hyphen, underscore, heavy, middleDot
- [ ] Test with varying text widths (short title vs long title)

## Testing

- [ ] E2E test: TOC with dotted leaders — no overlap with titles or page numbers
- [ ] E2E test: TOC with dashed leaders
- [ ] E2E test: long section title with short leader space
- [ ] Visual comparison against Word
- [ ] Run `bun run typecheck`

# Tasks: Paragraph Border Rendering

## Investigation

- [ ] Verify parser stores `between` and `bar` in paragraph border properties
- [ ] Check if border types include `between` and `bar` in `src/types/formatting.ts`
- [ ] Check current border rendering in `renderParagraph.ts` — confirm only 4 sides handled
- [ ] Create/find test DOCX with `w:pBdr/w:between` and `w:pBdr/w:bar`

## Implementation

- [ ] Add `bar` border rendering in `renderParagraph.ts` — vertical line on left edge
- [ ] Add `between` border rendering in `renderParagraph.ts`:
  - [ ] Detect if next sibling paragraph shares same border group
  - [ ] Render horizontal separator at bottom of paragraph (except last in group)
- [ ] Handle border style/width/color conversion for both types

## Testing

- [ ] Add E2E test with `between` borders between grouped paragraphs
- [ ] Add E2E test with `bar` borders on paragraphs
- [ ] Visual comparison against Word rendering
- [ ] Run `bun run typecheck`

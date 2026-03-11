# Tasks: Header/Footer Rendering

## Investigation

- [ ] Check how header/footer area height is calculated in `renderPage.ts`
- [ ] Test with DOCX containing oversized header image
- [ ] Test with DOCX using 3-section tab-stop header layout
- [ ] Compare rendering against Word for both cases

## Content clipping

- [ ] Measure actual header/footer content height after rendering
- [ ] If content exceeds allocated area, expand area and adjust body offset
- [ ] Handle anchored images that intentionally extend into margins

## Alignment

- [ ] Verify tab stop positions in header/footer use correct page width
- [ ] Fix center and right tab stop calculations for header/footer paragraphs
- [ ] Test with logo + company name + page number layout

## Testing

- [ ] E2E test: header with large image — no clipping
- [ ] E2E test: footer with 3-section tab-stop layout
- [ ] E2E test: different header on first page
- [ ] Visual comparison against Word
- [ ] Run `bun run typecheck`

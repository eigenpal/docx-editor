## 0. Prerequisite

- [ ] 0.1 Confirm `typed-drawings-and-images` records DrawingML image watermark ownership and does not type VML

## 1. VML typing

- [ ] 1.1 Type `w:pict` and the VML shape/image subset required for watermark detection and round-trip
- [ ] 1.2 Preserve unknown VML children as generic nodes under typed parents

## 2. Detection and read surface

- [ ] 2.1 Detect VML text and image watermarks in header/footer stories with explicit rules
- [ ] 2.2 Implement `Editor.getWatermark()` for detected VML watermarks; honest empty otherwise

## 3. Paint

- [ ] 3.1 Paint VML image watermarks behind body text without inflating header flow height
- [ ] 3.2 Match Word washed-out appearance where VML attributes map cleanly

## 4. Verification

- [ ] 4.1 D9 canonical fingerprint on unedited VML watermark fixtures
- [ ] 4.2 `watermark-confidential.docx` or dedicated VML fixture coverage
- [ ] 4.3 `openspec validate typed-vml-watermarks --strict`

## 5. Explicitly out of scope

- [ ] 5.1 DrawingML pictures and DrawingML image watermarks — `typed-drawings-and-images`
- [ ] 5.2 Header/footer editing scope — `scoped-header-footer-editing`

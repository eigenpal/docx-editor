## 0. Prerequisite

- [ ] 0.1 Confirm `typed-drawings-and-images` records DrawingML image watermark ownership and does not type VML

## 1. VML typing

- [ ] 1.1 Type `w:pict` and the VML shape/image subset required for watermark detection and round-trip (the watermark subset projects from generic VML: floating `#_x0000_t136` text art and `v:imagedata` colour adjustments)
- [x] 1.2 Preserve unknown VML children as generic nodes under typed parents

## 2. Detection and read surface

- [x] 2.1 Detect VML text and image watermarks in header/footer stories with explicit rules (shape id prefixes `PowerPlusWaterMarkObject` and `WordPictureWatermark`)
- [x] 2.2 Implement `Editor.getWatermark()` for detected VML watermarks; honest empty otherwise

## 3. Paint

- [x] 3.1 Paint VML image watermarks behind body text without inflating header flow height
- [x] 3.2 Match the washed-out appearance where VML attributes map cleanly (`gain` and `blacklevel` read as picture contrast and brightness)
- [x] 3.3 Paint VML text watermarks: rotation, fill opacity and an ink box fitted inside the VML text inset, from shaped glyph outlines
- [x] 3.4 Paint both watermark kinds in PDF export (text as outline paths, washout through the image `Decode` array)

## 4. Authoring

- [x] 4.1 `setWatermark` writes or removes the watermark in every header a section shows as one package-level operation and one undo step
- [x] 4.2 React and Vue Watermark dialog in the Insert menu
- [x] 4.3 Collaboration: two-peer convergence, concurrent header edit, undo, remount, picture media content type

## 5. Verification

- [ ] 5.1 D9 canonical fingerprint on unedited VML watermark fixtures
- [x] 5.2 `watermark-confidential.docx` or dedicated VML fixture coverage
- [x] 5.3 `openspec validate typed-vml-watermarks --strict`

## 6. Explicitly out of scope

- [ ] 6.1 DrawingML pictures and DrawingML image watermarks — `typed-drawings-and-images`
- [ ] 6.2 Header/footer editing scope — `scoped-header-footer-editing`

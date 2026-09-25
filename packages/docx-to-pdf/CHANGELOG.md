# @docx-editor.dev/docx-to-pdf

## 2.23.0

### Patch Changes

- e608e2d: PDF export now draws Hebrew text in a run whose font has no Hebrew glyphs in Times New Roman, or in Liberation Serif where Times New Roman is not installed, instead of dropping it.
- e608e2d: PDF export now refuses a font glyph whose composite parts nest too deeply or refer to themselves, instead of hanging or failing the whole export.
- e608e2d: PDF export no longer draws wrong glyph shapes when a large Arabic document fills the embedded font past its short offset limit.
- e608e2d: PDF export now draws synthetic bold and italic text when the font has no bold or italic face, such as bold Arabic in Noto Sans Arabic.
- e608e2d: Text copied or extracted from exported PDFs now reads Arabic, Persian, Urdu and Hebrew lines in logical order as whole words, in MuPDF, Poppler and pdf.js.
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [b981ea6]
- Updated dependencies [0e42c85]
- Updated dependencies [d04902a]
- Updated dependencies [e608e2d]
- Updated dependencies [a2951cf]
- Updated dependencies [ab460dc]
- Updated dependencies [e633def]
- Updated dependencies [cee5764]
- Updated dependencies [390c177]
- Updated dependencies [ae1afe0]
- Updated dependencies [bf776f2]
- Updated dependencies [d6c75d2]
- Updated dependencies [2eea4de]
- Updated dependencies [e040ff8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [9afb832]
- Updated dependencies [6794f4d]
  - @docx-editor.dev/core@2.23.0
  - @docx-editor.dev/fonts@2.23.0

## 2.22.0

### Minor Changes

- 648f13c: Add DOCX to PDF conversion for Node.js under the EigenPal Pro License.

### Patch Changes

- ac84ccf: Convert long documents to PDF about twice as fast, and shape text faster in the editor and in headless exports. Page content is unchanged, but compressed PDF stream bytes can differ.
- Updated dependencies [139688b]
- Updated dependencies [d98b6d8]
- Updated dependencies [abc656b]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9912e81]
- Updated dependencies [7ff2004]
- Updated dependencies [fe66ece]
- Updated dependencies [ac84ccf]
- Updated dependencies [cde01d8]
- Updated dependencies [648f13c]
- Updated dependencies [95c792f]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [23093e9]
- Updated dependencies [edfb06d]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [e6616fe]
- Updated dependencies [1bb2434]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [139688b]
- Updated dependencies [a893c05]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9db7eb3]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
  - @docx-editor.dev/core@2.22.0
  - @docx-editor.dev/fonts@2.22.0

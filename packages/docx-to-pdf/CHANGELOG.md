# @docx-editor.dev/docx-to-pdf

## 2.26.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.26.0, @docx-editor.dev/fonts-cjk@2.26.0, @docx-editor.dev/fonts@2.26.0

## 2.25.0

### Patch Changes

- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [e151687]
- Updated dependencies [5d02def]
- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [7ac4f41]
- Updated dependencies [f098ae6]
- Updated dependencies [a13f6a7]
- Updated dependencies [5d02def]
  - @docx-editor.dev/core@2.25.0
  - @docx-editor.dev/fonts@2.25.0
  - @docx-editor.dev/fonts-cjk@2.25.0

## 2.24.0

### Patch Changes

- 79d8bc1: Reduce repeated font metric reads and number formatting during PDF export.
- 79d8bc1: Reduce the time needed to compare PDF page colors.
- Updated dependencies [3a8853f]
- Updated dependencies [de3aac8]
- Updated dependencies [79d8bc1]
- Updated dependencies [997814e]
- Updated dependencies [de3aac8]
  - @docx-editor.dev/core@2.24.0
  - @docx-editor.dev/fonts@2.24.0
  - @docx-editor.dev/fonts-cjk@2.24.0

## 2.23.0

### Minor Changes

- dbed488: The Noto Sans CJK JP fallback font moves to the optional `@docx-editor.dev/fonts-cjk` package, which reduces the PDF converter download by about 13 MB. Install `@docx-editor.dev/fonts-cjk` to keep CJK text rendering on hosts without CJK fonts.

### Patch Changes

- 30bd2a8: Add evaluation tools for page layout, source text locations, and cached page-word screening.
- e608e2d: PDF export now draws Hebrew text in a run whose font has no Hebrew glyphs in Times New Roman, or in Liberation Serif where Times New Roman is not installed, instead of dropping it.
- e608e2d: PDF export now refuses a font glyph whose composite parts nest too deeply or refer to themselves, instead of hanging or failing the whole export.
- e608e2d: PDF export no longer draws wrong glyph shapes when a large Arabic document fills the embedded font past its short offset limit.
- e608e2d: PDF export now draws synthetic bold and italic text when the font has no bold or italic face, such as bold Arabic in Noto Sans Arabic.
- e608e2d: Text copied or extracted from exported PDFs now reads Arabic, Persian, Urdu and Hebrew lines in logical order as whole words, in MuPDF, Poppler and pdf.js.
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [b981ea6]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [0e42c85]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [d04902a]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [a2951cf]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [ab460dc]
- Updated dependencies [30bd2a8]
- Updated dependencies [e633def]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [cee5764]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [390c177]
- Updated dependencies [30bd2a8]
- Updated dependencies [ae1afe0]
- Updated dependencies [30bd2a8]
- Updated dependencies [bf776f2]
- Updated dependencies [30bd2a8]
- Updated dependencies [d6c75d2]
- Updated dependencies [2eea4de]
- Updated dependencies [30bd2a8]
- Updated dependencies [e040ff8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [aab4053]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [9afb832]
- Updated dependencies [6794f4d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
  - @docx-editor.dev/core@2.23.0
  - @docx-editor.dev/fonts@2.23.0
  - @docx-editor.dev/fonts-cjk@2.23.0

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
